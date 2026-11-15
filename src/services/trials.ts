import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL
} from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  entities,
  memberships,
  organisations,
  trialRequests,
  trials,
  trialSignups,
  users,
  type TrialRequestKind
} from '@/db/schema';
import { appUrl } from '@/lib/app-url';
import { appendAuditEvent } from '@/lib/audit';
import { sha256Hex } from '@/lib/canonical';
import { isEmailAddress } from '@/lib/email-address';
import { alertPlatformAdmins } from '@/lib/email/platform-alerts';
import {
  sendEmail,
  transportConfig,
  type Email,
  type SendOutcome
} from '@/lib/email/resend';
import {
  trialGoneEmail,
  trialHasAccountEmail,
  trialLinkEmail,
  trialRequestEmail
} from '@/lib/email/trial';
import { log } from '@/lib/log';
import type { AppRole } from '@/lib/rbac';
import {
  canonicalEmail,
  FICTIONAL_ONLY,
  inRequestWindow,
  LIMITS,
  LINK_MINUTES,
  MAX_EXTENSION_DAYS,
  MIN_FILL_SECONDS,
  REQUEST_WINDOW_HOURS,
  RETENTION_DAYS,
  TRIAL_MS
} from '@/lib/trial';

import { eraseEntityForPlatform } from './entity-erasure';
import { setUpOrganisation } from './organisation-requests';
import type { Actor } from './templates';
import { addSimulatedColleagues, DEMO, seedTrialDemo } from './trial-demo';

/**
 * Self-service trials: asking for one, proving the address, the time limit,
 * asking the platform administrators for more, and what happens after.
 *
 * Sign-up belongs to no organisation and reads as the owner, as organisation
 * requests do. Everything about a trial once it exists is done inside its own
 * organisation, under its row-level security, with its audit event in the
 * same transaction.
 */

export class TrialRefused extends Error {}

type Send = (email: Email) => Promise<SendOutcome>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_OPEN_HOURS = 24;
const EMAIL_LIMIT = 254;
const MESSAGE_LIMIT = 2000;
const NAME_LIMIT = 120;

const SIGN_UP: Actor = {
  actorKind: 'system',
  actorUserId: null,
  actorLabel: 'Trial sign-up'
};
const SWEEP: Actor = {
  actorKind: 'system',
  actorUserId: null,
  actorLabel: 'Trial sweep'
};
const operatorActor = (email: string): Actor => ({
  actorKind: 'user',
  actorUserId: null,
  actorLabel: `Waivern: ${email.trim().toLowerCase()}`
});

/** What the sign-up form says once it is sent, whatever the address. */
export const SIGN_UP_SENT = `Check your email. If that address can receive mail, a link to start your trial is on its way. It works once, for ${LINK_MINUTES} minutes.`;

export const SIGN_UP_TOO_MANY =
  'Too many trials have been asked for from here, or for that address, recently. Try again in an hour.';

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value) return value;
  // Without a secret the address hashes could be reversed by trying every
  // IPv4 address, so production refuses to run sign-up at all.
  if (process.env.NODE_ENV === 'production')
    throw new Error('AUTH_SECRET is required for trial sign-up');
  return 'govern-development-only';
}

/** A visitor's address, made unreadable, for rate limiting alone. */
function hashVisitor(address: string): string {
  return createHmac('sha256', secret())
    .update(`trial-sign-up:${address}`)
    .digest('hex');
}

/**
 * A signed note of when the sign-up form was opened, so a submission can be
 * judged too quick to be a person without storing anything between requests.
 */
export function signUpStarted(at = new Date()): string {
  const issued = String(at.getTime());
  const mac = createHmac('sha256', secret())
    .update(`trial-sign-up.${issued}`)
    .digest('base64url');
  return `${issued}.${mac}`;
}

function startedAt(token: string): Date | null {
  const [issued, mac] = token.split('.');
  if (!issued || !mac) return null;
  const expected = createHmac('sha256', secret())
    .update(`trial-sign-up.${issued}`)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const at = new Date(Number(issued));
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Whether the link can be shown in the server log instead of being sent. */
function devLinks(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** The deployment's address for links in email, else the request's own. */
function linkBase(origin: string): string {
  return appUrl() || origin.replace(/\/+$/, '');
}

export function trialLinkPath(token: string): string {
  // After `#`, which browsers never send to a server, so the token stays out
  // of request logs; the page hands it to a server action in a POST body.
  return `/trial/start#${token}`;
}

/**
 * Ask for a trial: check the form, count the attempt, and send the one email
 * this address should get. The answer is the same whether or not the address
 * is known here, so the form cannot be used to find out.
 */
export async function requestTrialLink(input: {
  email: string;
  /** The visitor's IP address, as the proxy reported it. */
  address: string;
  started: string;
  /** The hidden field people never see. Anything in it, and it was not a person. */
  trap?: string;
  /** Ticked: the trial is for fictional data only. Required. */
  fictionalOnly: boolean;
  /** Their own organisation, if they gave it. Optional, never checked. */
  organisationName?: string;
  origin: string;
  now?: Date;
  send?: Send;
}): Promise<{ ok: boolean; message: string }> {
  const now = input.now ?? new Date();
  if (input.trap) {
    // Told it worked, so a script has nothing to learn from.
    log('info', 'trial.sign_up_trapped', {});
    return { ok: true, message: SIGN_UP_SENT };
  }
  const opened = startedAt(input.started);
  if (!opened || now.getTime() - opened.getTime() > MAX_OPEN_HOURS * HOUR)
    return {
      ok: false,
      message: 'This page has been open too long. Reload it and try again.'
    };
  if (now.getTime() - opened.getTime() < MIN_FILL_SECONDS * 1000)
    return {
      ok: false,
      message:
        'That was sent very quickly. Check the address and send it again.'
    };
  const email = input.email.trim().toLowerCase();
  if (!isEmailAddress(email) || email.length > EMAIL_LIMIT)
    return { ok: false, message: 'Give an email address you can read.' };
  if (!input.fictionalOnly)
    return {
      ok: false,
      message:
        'Tick the box to accept that the trial is for fictional data only. Nothing starts without it.'
    };
  const organisationName =
    input.organisationName?.trim().replace(/\s+/g, ' ').slice(0, NAME_LIMIT) ||
    null;

  const canonical = canonicalEmail(email);
  const ipHash = hashVisitor(input.address);
  const hourAgo = new Date(now.getTime() - HOUR);
  const dayAgo = new Date(now.getTime() - DAY);
  const tally = (where: SQL | undefined) =>
    db
      .select({ n: count() })
      .from(trialSignups)
      .where(where)
      .then(([row]) => Number(row.n));
  const [forEmail, fromHere, fromHereToday, overall] = await Promise.all([
    tally(
      and(
        eq(trialSignups.canonicalEmail, canonical),
        gte(trialSignups.createdAt, hourAgo)
      )
    ),
    tally(
      and(eq(trialSignups.ipHash, ipHash), gte(trialSignups.createdAt, hourAgo))
    ),
    tally(
      and(eq(trialSignups.ipHash, ipHash), gte(trialSignups.createdAt, dayAgo))
    ),
    tally(gte(trialSignups.createdAt, hourAgo))
  ]);
  if (
    forEmail >= LIMITS.perEmail ||
    fromHere >= LIMITS.perAddress ||
    fromHereToday >= LIMITS.perAddressPerDay ||
    overall >= LIMITS.overall
  ) {
    log('warn', 'trial.sign_up_limited', {
      forEmail,
      fromHere,
      fromHereToday,
      overall
    });
    return { ok: false, message: SIGN_UP_TOO_MANY };
  }

  // Which one email this address gets.
  const [trial] = await db
    .select({ status: trials.status })
    .from(trials)
    .where(eq(trials.canonicalEmail, canonical));
  let outcome: 'link' | 'has_account' | 'gone' = 'link';
  if (trial?.status === 'purged') outcome = 'gone';
  else if (!trial && (await hasFullAccount(email))) outcome = 'has_account';

  const token = randomBytes(32).toString('base64url');
  await db.insert(trialSignups).values({
    email,
    canonicalEmail: canonical,
    tokenHash: await sha256Hex(token),
    ipHash,
    organisationName,
    fictionalDataAcceptedAt: now,
    expiresAt: new Date(now.getTime() + LINK_MINUTES * 60_000),
    // Counted against the limits, but there is no link to use.
    usedAt: outcome === 'link' ? null : now
  });

  const link = `${linkBase(input.origin)}${trialLinkPath(token)}`;
  const message =
    outcome === 'link'
      ? trialLinkEmail(link)
      : outcome === 'gone'
        ? trialGoneEmail()
        : trialHasAccountEmail();
  const send: Send =
    input.send ?? ((mail) => sendEmail(mail, { config: transportConfig() }));
  const sent = await send({ ...message, to: [email] });
  if (!sent.sent && !input.send && devLinks()) {
    // Development has no mail: the link goes to the server's own log, and
    // nowhere else.
    console.info(
      `[trial] ${outcome === 'link' ? `sign-up link for ${email}: ${link}` : `${outcome} notice for ${email}`}`
    );
  } else if (!sent.sent) {
    log('warn', 'trial.link_not_sent', { reason: sent.reason });
  }
  return { ok: true, message: SIGN_UP_SENT };
}

/** Whether the address belongs to somebody with a full account here. */
async function hasFullAccount(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(users.email, email), eq(memberships.isActive, true)))
    .limit(1);
  return Boolean(row);
}

export type TrialLinkState = 'valid' | 'expired' | 'used' | 'not_found';

/** What a sign-up link is, without using it: for the page it opens. */
export async function trialLinkState(
  token: string,
  now = new Date()
): Promise<TrialLinkState> {
  if (!token) return 'not_found';
  const [row] = await db
    .select()
    .from(trialSignups)
    .where(eq(trialSignups.tokenHash, await sha256Hex(token)));
  if (!row) return 'not_found';
  if (row.usedAt) return 'used';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

/**
 * Use a sign-up link: once, before it expires. Starts the address's trial if
 * it has none, and returns who to sign in as: the trial's person, whether
 * the trial is new, running, ended or converted. Null when the link cannot
 * be used, or the address has a full account of its own.
 *
 * This is what the `trial` sign-in provider calls (`src/auth.ts`).
 */
export async function redeemTrialLink(
  token: string,
  now = new Date()
): Promise<{ id: string; email: string } | null> {
  if (!token) return null;
  const [signup] = await db
    .update(trialSignups)
    .set({ usedAt: now })
    .where(
      and(
        eq(trialSignups.tokenHash, await sha256Hex(token)),
        isNull(trialSignups.usedAt),
        gt(trialSignups.expiresAt, now)
      )
    )
    .returning();
  if (!signup) return null;

  const existing = await trialPerson(signup.canonicalEmail);
  if (existing !== undefined) return existing;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, signup.email));
  if (user && (await hasFullAccount(signup.email))) return null;

  try {
    await startTrial({
      email: signup.email,
      canonical: signup.canonicalEmail,
      userId: user?.id,
      organisationName: signup.organisationName,
      fictionalDataAcceptedAt: signup.fictionalDataAcceptedAt,
      now
    });
  } catch (error) {
    // Two links for one mailbox used at once: the other started it.
    const raced = await trialPerson(signup.canonicalEmail);
    if (raced !== undefined) return raced;
    throw error;
  }
  return (await trialPerson(signup.canonicalEmail)) ?? null;
}

/** The person of the trial for a mailbox: undefined if it has none, null once purged. */
async function trialPerson(
  canonical: string
): Promise<{ id: string; email: string } | null | undefined> {
  const [row] = await db
    .select({ status: trials.status, id: users.id, email: users.email })
    .from(trials)
    .innerJoin(users, eq(users.id, trials.userId))
    .where(eq(trials.canonicalEmail, canonical));
  if (!row) return undefined;
  if (row.status === 'purged') return null;
  return { id: row.id, email: row.email };
}

/**
 * A trial organisation: the shipped templates and workflows, one entity, the
 * person as its owner, and the trial's own record, all at once. No sample
 * records: the point is to try it with your own (made-up) work.
 */
async function startTrial(input: {
  email: string;
  canonical: string;
  userId?: string;
  organisationName: string | null;
  fictionalDataAcceptedAt: Date;
  now: Date;
}) {
  const endsAt = new Date(input.now.getTime() + TRIAL_MS);
  let colleagues = new Map<AppRole, string>();
  let ownerOf = '';
  const { org } = await setUpOrganisation({
    organisationName: DEMO.organisationName,
    entityName: DEMO.entityName,
    slug: `trial-${randomBytes(6).toString('hex')}`,
    owner: input.userId
      ? { id: input.userId, email: input.email }
      : { email: input.email },
    actor: SIGN_UP,
    origin: { trial: true },
    also: async (tx, { organisationId, ownerId }) => {
      ownerOf = ownerId;
      const [trial] = await tx
        .insert(trials)
        .values({
          organisationId,
          userId: ownerId,
          canonicalEmail: input.canonical,
          organisationName: input.organisationName,
          fictionalDataAcceptedAt: input.fictionalDataAcceptedAt,
          startedAt: input.now,
          endsAt
        })
        .returning();
      await appendAuditEvent(tx, {
        ...SIGN_UP,
        organisationId,
        action: 'trial.started',
        subjectType: 'trial',
        subjectId: trial.id,
        after: {
          email: input.email,
          organisationName: input.organisationName,
          endsAt: endsAt.toISOString()
        }
      });
      // What they accepted to get in, on the record as theirs.
      await appendAuditEvent(tx, {
        actorKind: 'user',
        actorUserId: ownerId,
        actorLabel: input.email,
        organisationId,
        action: 'trial.fictional_data_accepted',
        subjectType: 'trial',
        subjectId: trial.id,
        after: {
          acceptedAt: input.fictionalDataAcceptedAt.toISOString(),
          statement: FICTIONAL_ONLY
        }
      });
      colleagues = await addSimulatedColleagues(tx, organisationId);
    }
  });
  const [entity] = await withOrganisation(org.id, () =>
    db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.organisationId, org.id))
  );
  await seedTrialDemo({
    organisationId: org.id,
    entityId: entity.id,
    ownerId: ownerOf,
    colleagues
  });
  log('info', 'trial.started', {});
  return org;
}

/** A person's trial, its open request and its last decided one: for their own pages. */
export async function trialOfUser(userId: string) {
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.userId, userId));
  if (!trial) return null;
  return withOrganisation(trial.organisationId, async () => {
    const requests = await db
      .select()
      .from(trialRequests)
      .where(eq(trialRequests.organisationId, trial.organisationId))
      .orderBy(desc(trialRequests.createdAt))
      .limit(5);
    return {
      trial,
      pending: requests.find((r) => r.status === 'pending') ?? null,
      lastDecided: requests.find((r) => r.status !== 'pending') ?? null
    };
  });
}

/**
 * Ask the platform administrators to extend the trial or convert it to a
 * full account. Only in the last day of the trial, or once it has ended and
 * before its records go; one request open at a time. The trial is whichever
 * this person has: nothing in the request names it.
 */
export async function requestTrialChange(input: {
  userId: string;
  email: string;
  kind: TrialRequestKind;
  organisationName: string;
  message: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (input.kind !== 'extend' && input.kind !== 'convert')
    throw new TrialRefused('Say whether you want more time or a full account.');
  const organisationName = input.organisationName.trim().replace(/\s+/g, ' ');
  if (!organisationName)
    throw new TrialRefused('Give the name of your organisation.');
  if (organisationName.length > NAME_LIMIT)
    throw new TrialRefused("The organisation's name is too long.");
  const message = input.message.trim();
  if (!message)
    throw new TrialRefused(
      'Say what you would use Govern for, so an administrator can decide.'
    );
  if (message.length > MESSAGE_LIMIT)
    throw new TrialRefused(
      `Keep the message under ${MESSAGE_LIMIT} characters.`
    );

  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.userId, input.userId));
  if (!trial || trial.status === 'purged')
    throw new TrialRefused('There is no trial to ask about.');
  if (trial.status === 'converted')
    throw new TrialRefused('Your trial is already a full account.');
  if (!inRequestWindow(trial.endsAt, now)) {
    const opens = new Date(
      trial.endsAt.getTime() - REQUEST_WINDOW_HOURS * HOUR
    );
    throw new TrialRefused(
      `You can ask in the last ${REQUEST_WINDOW_HOURS} hours of your trial, from ${opens.toUTCString()}.`
    );
  }

  const request = await withOrganisation(trial.organisationId, () =>
    db.transaction(async (tx) => {
      const [pending] = await tx
        .select({ id: trialRequests.id })
        .from(trialRequests)
        .where(
          and(
            eq(trialRequests.organisationId, trial.organisationId),
            eq(trialRequests.status, 'pending')
          )
        );
      if (pending)
        throw new TrialRefused(
          'You have already asked. An administrator will decide soon, and you will see the answer here.'
        );
      const [row] = await tx
        .insert(trialRequests)
        .values({
          organisationId: trial.organisationId,
          trialId: trial.id,
          kind: input.kind,
          organisationName,
          message
        })
        .returning();
      await appendAuditEvent(tx, {
        actorKind: 'user',
        actorUserId: input.userId,
        actorLabel: input.email,
        organisationId: trial.organisationId,
        action: 'trial.change_requested',
        subjectType: 'trial_request',
        subjectId: row.id,
        after: { kind: input.kind, organisationName }
      });
      return row;
    })
  );

  // After the commit, and never fatal: the request is on the platform page
  // whatever the mail does.
  await alertPlatformAdmins(
    trialRequestEmail({
      email: input.email,
      kind: input.kind,
      organisationName,
      message,
      endsAt: trial.endsAt
    })
  );
  return request;
}

/** For the platform administrators: what is waiting, and every trial still running or in its grace period. */
export async function trialQueue(now = new Date()) {
  const graceFrom = new Date(now.getTime() - RETENTION_DAYS * DAY);
  const [pending, running] = await Promise.all([
    db
      .select({
        request: trialRequests,
        email: users.email,
        endsAt: trials.endsAt
      })
      .from(trialRequests)
      .innerJoin(trials, eq(trials.id, trialRequests.trialId))
      .innerJoin(users, eq(users.id, trials.userId))
      .where(eq(trialRequests.status, 'pending'))
      .orderBy(trialRequests.createdAt),
    db
      .select({
        id: trials.id,
        email: users.email,
        organisationName: trials.organisationName,
        startedAt: trials.startedAt,
        endsAt: trials.endsAt
      })
      .from(trials)
      .innerJoin(users, eq(users.id, trials.userId))
      .where(and(eq(trials.status, 'active'), gt(trials.endsAt, graceFrom)))
      .orderBy(trials.endsAt)
      .limit(200)
  ]);
  return { pending, running };
}

export type TrialDecision =
  | { decision: 'extend'; days: number }
  | { decision: 'convert' }
  | { decision: 'decline'; note: string };

/**
 * A platform administrator's answer to a trial's request. Extending adds
 * days from now or from the end, whichever is later; converting lifts every
 * trial restriction at once; declining says why.
 */
export async function decideTrialRequest(
  input: {
    requestId: string;
    decidedByEmail: string;
    now?: Date;
  } & TrialDecision
) {
  const now = input.now ?? new Date();
  const [found] = await db
    .select()
    .from(trialRequests)
    .where(eq(trialRequests.id, input.requestId));
  if (!found) throw new TrialRefused('No such request.');
  if (found.status !== 'pending')
    throw new TrialRefused(`That request has already been ${found.status}.`);
  if (input.decision === 'extend') {
    if (
      !Number.isInteger(input.days) ||
      input.days < 1 ||
      input.days > MAX_EXTENSION_DAYS
    )
      throw new TrialRefused(
        `Extend by a whole number of days, from 1 to ${MAX_EXTENSION_DAYS}.`
      );
  }
  const note =
    input.decision === 'decline'
      ? input.note.trim().slice(0, MESSAGE_LIMIT)
      : '';
  if (input.decision === 'decline' && !note)
    throw new TrialRefused(
      'Say why, so the person asking knows what to do next.'
    );
  const actor = operatorActor(input.decidedByEmail);

  return withOrganisation(found.organisationId, () =>
    db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(trialRequests)
        .where(eq(trialRequests.id, input.requestId))
        .for('update');
      if (request.status !== 'pending')
        throw new TrialRefused(
          `That request has already been ${request.status}.`
        );
      const [trial] = await tx
        .select()
        .from(trials)
        .where(eq(trials.id, request.trialId))
        .for('update');
      if (trial.status !== 'active')
        throw new TrialRefused(
          trial.status === 'converted'
            ? 'That trial is already a full account.'
            : "That trial's records have been deleted."
        );

      const decided = {
        decidedByEmail: input.decidedByEmail.trim().toLowerCase(),
        decidedAt: now
      };
      if (input.decision === 'extend') {
        const from = Math.max(now.getTime(), trial.endsAt.getTime());
        const endsAt = new Date(from + input.days * DAY);
        await tx.update(trials).set({ endsAt }).where(eq(trials.id, trial.id));
        await tx
          .update(trialRequests)
          .set({ ...decided, status: 'approved', extendedDays: input.days })
          .where(eq(trialRequests.id, request.id));
        await appendAuditEvent(tx, {
          ...actor,
          organisationId: trial.organisationId,
          action: 'trial.extended',
          subjectType: 'trial',
          subjectId: trial.id,
          before: { endsAt: trial.endsAt.toISOString() },
          after: { endsAt: endsAt.toISOString(), days: input.days }
        });
      } else if (input.decision === 'convert') {
        await tx
          .update(trials)
          .set({ status: 'converted', convertedAt: now })
          .where(eq(trials.id, trial.id));
        await tx
          .update(trialRequests)
          .set({ ...decided, status: 'approved' })
          .where(eq(trialRequests.id, request.id));
        await appendAuditEvent(tx, {
          ...actor,
          organisationId: trial.organisationId,
          action: 'trial.converted',
          subjectType: 'trial',
          subjectId: trial.id,
          before: { status: 'active' },
          after: { status: 'converted' }
        });
      } else {
        await tx
          .update(trialRequests)
          .set({ ...decided, status: 'declined', decisionNote: note })
          .where(eq(trialRequests.id, request.id));
        await appendAuditEvent(tx, {
          ...actor,
          organisationId: trial.organisationId,
          action: 'trial.request_declined',
          subjectType: 'trial_request',
          subjectId: request.id,
          after: { note }
        });
      }
      return { organisationId: trial.organisationId };
    })
  );
}

/**
 * Delete what ended trials held, once their grace period is over, and forget
 * sign-up attempts nobody needs for rate limiting any more.
 *
 * Each trial's legal entities go through the same deletion an owner uses
 * (`eraseEntityForPlatform`), which keeps the audit chain whole with the
 * events' contents erased. That deletion never takes an organisation's last
 * or default entity, so an empty one is made the default first. Then the
 * membership ends, the requests and their messages go, and the trial is
 * marked purged, which is what sign-up reads to tell the address its trial
 * has gone. One failure is logged and left for the next sweep.
 */
export async function purgeEndedTrials(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY);
  await db
    .delete(trialSignups)
    .where(lt(trialSignups.createdAt, new Date(now.getTime() - 2 * DAY)));
  const due = await db
    .select({
      id: trials.id,
      organisationId: trials.organisationId,
      userId: trials.userId,
      canonicalEmail: trials.canonicalEmail,
      email: users.email
    })
    .from(trials)
    .innerJoin(users, eq(users.id, trials.userId))
    .where(and(eq(trials.status, 'active'), lt(trials.endsAt, cutoff)));

  let purged = 0;
  for (const trial of due) {
    try {
      await purgeTrial(trial);
      purged++;
    } catch (error) {
      log('warn', 'trial.purge_failed', {
        error: error instanceof Error ? error.name : 'unknown'
      });
    }
  }
  return { due: due.length, purged };
}

async function purgeTrial(trial: {
  id: string;
  organisationId: string;
  userId: string;
  canonicalEmail: string;
  email: string;
}) {
  const { organisationId } = trial;
  const keep = await withOrganisation(organisationId, () =>
    db.transaction(async (tx) => {
      await tx
        .update(entities)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(entities.organisationId, organisationId),
            eq(entities.isDefault, true)
          )
        );
      const [placeholder] = await tx
        .insert(entities)
        .values({ organisationId, name: 'Ended trial', isDefault: true })
        .returning();
      await appendAuditEvent(tx, {
        ...SWEEP,
        organisationId,
        action: 'entity.created',
        subjectType: 'entity',
        subjectId: placeholder.id,
        entityId: placeholder.id,
        after: { name: placeholder.name, reason: 'trial ended' }
      });
      return placeholder.id;
    })
  );

  const others = await withOrganisation(organisationId, () =>
    db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(eq(entities.organisationId, organisationId), ne(entities.id, keep))
      )
  );
  for (const entity of others)
    await eraseEntityForPlatform({
      organisationId,
      entityId: entity.id,
      requestedBy: trial.userId,
      requestedByEmail: trial.email,
      actor: SWEEP
    });

  await withOrganisation(organisationId, () =>
    db.transaction(async (tx) => {
      await tx
        .update(memberships)
        .set({ isActive: false })
        .where(eq(memberships.organisationId, organisationId));
      await tx
        .delete(trialRequests)
        .where(eq(trialRequests.organisationId, organisationId));
      await tx
        .update(trials)
        .set({ status: 'purged', purgedAt: new Date() })
        .where(eq(trials.id, trial.id));
      await appendAuditEvent(tx, {
        ...SWEEP,
        organisationId,
        action: 'trial.purged',
        subjectType: 'trial',
        subjectId: trial.id,
        after: { entitiesDeleted: others.length }
      });
    })
  );
  await db
    .delete(trialSignups)
    .where(
      or(
        eq(trialSignups.canonicalEmail, trial.canonicalEmail),
        inArray(trialSignups.email, [trial.email])
      )
    );
  // The organisation's name is the only thing left that a person typed.
  await withOrganisation(organisationId, () =>
    db
      .update(organisations)
      .set({ name: 'Ended trial' })
      .where(eq(organisations.id, organisationId))
  );
}
