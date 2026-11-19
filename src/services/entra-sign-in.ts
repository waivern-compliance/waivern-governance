import { and, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  auditEvents,
  memberships,
  organisationDomains,
  organisationEntraTenants,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { domainOf } from '@/lib/auth/domains';
import {
  domainOwnerVerified,
  ENTRA_PROVIDER,
  entraSubject,
  forLog,
  legacySubject,
  type EntraClaims
} from '@/lib/auth/entra';

import { joinByVerifiedDomain } from './domains';
import { joinByTrustedTenant, tenantVouchesFor } from './entra-tenants';

/**
 * Who a Microsoft sign-in is, under a multi-tenant registration.
 *
 * Anybody can create a Microsoft directory and give its users any address, so
 * the address alone never decides who somebody is. A person is bound to one
 * Microsoft account, by tenant and object id, the first time they sign in, and
 * matched by that binding ever after. The first sign-in may match an address
 * only when the address is proved: Microsoft says the directory owns its domain
 * (`xms_edov`), or the domain is one an organisation has verified and trusts
 * this tenant through. A Microsoft account that was signing in here before the
 * registration became multi-tenant is recognised by its old subject.
 *
 * Runs on the owner's connection, as sign-in does: nobody is acting for an
 * organisation yet.
 */

export type EntraRefusal =
  | 'no_email'
  | 'address_not_proved'
  | 'bound_elsewhere'
  | 'not_a_person'
  | 'no_account';

export type EntraSignIn =
  | {
      outcome: 'signed_in';
      userId: string;
      member: boolean;
      /** Whether the address is proved, so they may ask for an organisation. */
      addressProved: boolean;
    }
  | { outcome: 'refused'; reason: EntraRefusal };

const REFUSAL_TEXT: Record<EntraRefusal, string> = {
  no_email: 'the token carries no email address',
  address_not_proved:
    'neither Microsoft nor a trusted tenant vouches for the address, so it cannot be matched to an invitation',
  bound_elsewhere: 'the address belongs to a different Microsoft account',
  not_a_person: 'the address is a simulated colleague',
  no_account: 'nobody has that address and nothing lets them in'
};

export const describeRefusal = (reason: EntraRefusal) => REFUSAL_TEXT[reason];

export async function userForEntraSubject(subject: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.entraSubject, subject));
  return row ?? null;
}

async function userByEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row ?? null;
}

async function isMember(userId: string) {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true)))
    .limit(1);
  return Boolean(row);
}

/** How many refusals a day are recorded for one person, in each organisation. */
export const REFUSALS_RECORDED_PER_DAY = 10;

/**
 * Tell each organisation the person belongs to that somebody tried to sign in
 * as them. Somebody else's directory claiming a member's address is exactly
 * what an owner needs to see; but anybody with a directory can try as often
 * as they like, and the audit log keeps everything, so each Microsoft account
 * is recorded once a day per person, and no more than
 * `REFUSALS_RECORDED_PER_DAY` in all. The rest are logged only.
 */
async function recordRefusal(
  user: { id: string; email: string },
  claims: EntraClaims,
  reason: EntraRefusal
) {
  const rows = await db
    .select({ organisationId: memberships.organisationId })
    .from(memberships)
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.isActive, true))
    );
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const { organisationId } of rows) {
    await withOrganisation(organisationId, () =>
      db.transaction(async (tx) => {
        const recent = await tx
          .select({ objectId: sql<string>`${auditEvents.after}->>'objectId'` })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organisationId, organisationId),
              eq(auditEvents.action, 'user.sign_in_refused'),
              eq(auditEvents.subjectId, user.id),
              gt(auditEvents.at, since)
            )
          );
        if (
          recent.length >= REFUSALS_RECORDED_PER_DAY ||
          recent.some((r) => r.objectId === claims.oid)
        )
          return;
        await appendAuditEvent(tx, {
          actorKind: 'system',
          actorUserId: null,
          actorLabel: 'sign-in',
          organisationId,
          action: 'user.sign_in_refused',
          subjectType: 'user',
          subjectId: user.id,
          after: {
            email: user.email,
            provider: ENTRA_PROVIDER,
            tenantId: claims.tid,
            objectId: claims.oid,
            reason
          }
        });
      })
    );
  }
}

/**
 * Let a person bind a new Microsoft account, after theirs was replaced. The
 * deployment operator's to do, never an organisation owner's: people are
 * shared between organisations, so one owner releasing a binding would expose
 * the person's other organisations. Recorded in each organisation they belong
 * to. Returns the binding released, or null if there was none.
 */
export async function releaseEntraBinding(
  email: string,
  operator: string
): Promise<string | null> {
  const address = email.trim().toLowerCase();
  const person = await userByEmail(address);
  if (!person?.entraSubject) return null;
  const released = person.entraSubject;
  await db
    .update(users)
    .set({ entraSubject: null })
    .where(eq(users.id, person.id));
  const rows = await db
    .select({ organisationId: memberships.organisationId })
    .from(memberships)
    .where(
      and(eq(memberships.userId, person.id), eq(memberships.isActive, true))
    );
  for (const { organisationId } of rows) {
    await withOrganisation(organisationId, () =>
      db.transaction((tx) =>
        appendAuditEvent(tx, {
          actorKind: 'system',
          actorUserId: null,
          actorLabel: operator,
          organisationId,
          action: 'user.entra_binding_released',
          subjectType: 'user',
          subjectId: person.id,
          before: { email: address, entraSubject: released }
        })
      )
    );
  }
  return released;
}

async function tenantTrusted(tenantId: string) {
  const [row] = await db
    .select({ id: organisationEntraTenants.id })
    .from(organisationEntraTenants)
    .where(eq(organisationEntraTenants.tenantId, tenantId))
    .limit(1);
  return Boolean(row);
}

async function domainVerified(email: string) {
  const domain = domainOf(email);
  if (!domain) return false;
  const [row] = await db
    .select({ id: organisationDomains.id })
    .from(organisationDomains)
    .where(
      and(
        eq(organisationDomains.domain, domain),
        isNotNull(organisationDomains.verifiedAt)
      )
    )
    .limit(1);
  return Boolean(row);
}

/** Joining is a convenience: a failure is logged and sign-in carries on. */
async function joinWhereLetIn(
  userId: string,
  email: string,
  claims: EntraClaims,
  name: string | null
) {
  for (const [how, join] of [
    ['verified domain', () => joinByVerifiedDomain(email, name)],
    ['trusted tenant', () => joinByTrustedTenant(userId, claims.tid, email)]
  ] as const) {
    try {
      const joined = await join();
      if (joined)
        console.info(
          `[auth] ${forLog(email)} joined organisation ${joined} through its ${how}`
        );
    } catch (cause) {
      console.error(`[auth] could not join ${forLog(email)} by ${how}:`, cause);
    }
  }
}

type Person = typeof users.$inferSelect;

/**
 * The first Microsoft sign-in for this account: match the address if it may
 * be matched, and bind it; or make somebody new, already bound. Each binding is
 * one statement, conditional on nobody having bound first.
 */
async function bindOnFirstSignIn(input: {
  claims: EntraClaims;
  subject: string;
  email: string | null;
  name: string | null;
  requestsOpen: boolean;
  addressProved: () => Promise<boolean>;
}): Promise<Person | EntraRefusal> {
  const { claims, subject, email } = input;
  if (!email) return 'no_email';

  const existing = await userByEmail(email);
  if (existing) {
    if (existing.simulated) return 'not_a_person';
    const reason: EntraRefusal | null = existing.entraSubject
      ? 'bound_elsewhere'
      : existing.ssoSubject === legacySubject(claims) ||
          (await input.addressProved())
        ? null
        : 'address_not_proved';
    if (reason) {
      await recordRefusal(existing, claims, reason);
      return reason;
    }
    const [bound] = await db
      .update(users)
      .set({ entraSubject: subject })
      .where(and(eq(users.id, existing.id), isNull(users.entraSubject)))
      .returning();
    // Somebody else's sign-in bound the address first.
    return bound ?? 'bound_elsewhere';
  }

  if (!(await input.addressProved())) return 'address_not_proved';
  // Only somebody something lets in gets an account: a domain or tenant they
  // may join through, or the chance to ask for an organisation.
  const letIn =
    input.requestsOpen ||
    (await tenantTrusted(claims.tid)) ||
    (await domainVerified(email));
  if (!letIn) return 'no_account';
  const [created] = await db
    .insert(users)
    .values({ email, name: input.name, entraSubject: subject })
    .onConflictDoNothing()
    .returning();
  // An invitation or another sign-in made them in the meantime.
  return created ?? 'bound_elsewhere';
}

export async function resolveEntraSignIn(input: {
  claims: EntraClaims;
  name: string | null;
  /** Whether somebody who belongs nowhere may sign in to ask for an organisation. */
  requestsOpen: boolean;
}): Promise<EntraSignIn> {
  const { claims } = input;
  const subject = entraSubject(claims);
  const email = claims.email?.trim().toLowerCase() || null;

  // Asked only when something turns on it: most sign-ins are by somebody
  // already bound, who needs it only to join.
  let proof: Promise<boolean> | undefined;
  const addressProved = () =>
    (proof ??=
      email && !domainOwnerVerified(claims)
        ? tenantVouchesFor(email, claims.tid)
        : Promise.resolve(Boolean(email)));

  const user =
    (await userForEntraSubject(subject)) ??
    (await bindOnFirstSignIn({
      claims,
      subject,
      email,
      name: input.name,
      requestsOpen: input.requestsOpen,
      addressProved
    }));
  if (typeof user === 'string') return { outcome: 'refused', reason: user };
  if (user.simulated) return { outcome: 'refused', reason: 'not_a_person' };

  // The subject column is unique. If this account last signed in as somebody
  // else (their address moved), that record no longer speaks for it.
  const sso = legacySubject(claims);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ ssoSubject: null })
      .where(and(eq(users.ssoSubject, sso), ne(users.id, user.id)));
    await tx
      .update(users)
      .set({
        ssoSubject: sso,
        lastSeenAt: new Date(),
        name: user.name ?? input.name
      })
      .where(eq(users.id, user.id));
  });

  // Joining matches the address, so only while the token still carries the
  // person's own, proved.
  const proved = email === user.email && (await addressProved());
  if (proved) await joinWhereLetIn(user.id, user.email, claims, input.name);

  return {
    outcome: 'signed_in',
    userId: user.id,
    member: await isMember(user.id),
    addressProved: proved
  };
}
