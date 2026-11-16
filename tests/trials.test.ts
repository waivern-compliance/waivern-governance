/**
 * Self-service trials: signing up, the time limit, what a trial is refused,
 * asking for more, and what happens after.
 *
 * Every refusal a trial meets is tested here against the service that would
 * do the work, as a trial organisation, expecting `TrialRestricted`. That
 * each action asks for the capability as well, before it calls the service,
 * is checked by `trial-gates.test.ts`.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { loadMemberships } from '@/auth';
import { db, sql as pg, withOrganisation } from '@/db/client';
import {
  aiUseCases,
  approvals,
  assessments,
  auditEvents,
  breaches,
  dataProtectionComplaints,
  dataSubjectRequests,
  dpas,
  entities,
  memberships,
  notifications,
  organisations,
  processingActivities,
  risks,
  roleAssignments,
  suppliers,
  templates,
  templateVersions,
  trialRequests,
  trials,
  trialSignups,
  users
} from '@/db/schema';
import { sendEmail, type Email } from '@/lib/email/resend';
import { authenticate } from '@/lib/integration/auth';
import { signRequest } from '@/lib/integration/crypto';
import { can, mayImport, withheldByTrial, type Grant } from '@/lib/rbac';
import {
  canonicalEmail,
  FICTIONAL_ONLY,
  inRequestWindow,
  isUndeliverable,
  LIMITS,
  REQUEST_WINDOW_HOURS,
  RETENTION_DAYS,
  SIMULATED_DOMAIN,
  timeLeft,
  TRIAL_MS,
  TRIAL_WITHHELD
} from '@/lib/trial';
import { SAMPLE_FILES } from '@/lib/trial-samples';
import { inviteMember } from '@/services/access';
import { createAssessment, saveAnswers } from '@/services/assessments';
import { saveProvider, testProvider } from '@/services/assistant';
import { createConnection, rotateSecret } from '@/services/connections';
import {
  checkPropertyScan,
  setAnalyserSettings,
  startPropertyScan
} from '@/services/consent-analyser';
import { issueContributorLink } from '@/services/contributor-links';
import {
  attachDocument,
  attachSampleDocument,
  readDocument
} from '@/services/documents';
import { claimDomain, verifyDomain } from '@/services/domains';
import { issueIntakeLink } from '@/services/dsr-intake';
import { followLink } from '@/services/extraction';
import { setFormAppearance } from '@/services/form-appearance';
import { handOver } from '@/services/handover';
import { addImportFiles, uploadImport } from '@/services/imports';
import { deliverNotifications } from '@/services/member-email';
import { ingestAnalyserReport } from '@/services/storage-inventory';
import { COLLEAGUES, DEMO_HIGHLIGHTS } from '@/services/trial-demo';
import { isTrial, TrialRestricted } from '@/services/trial-guard';
import {
  decideTrialRequest,
  purgeEndedTrials,
  redeemTrialLink,
  requestTrialChange,
  requestTrialLink,
  SIGN_UP_SENT,
  SIGN_UP_TOO_MANY,
  signUpStarted,
  trialLinkState,
  trialOfUser,
  TrialRefused
} from '@/services/trials';
import { decideApproval, submitForApproval } from '@/services/workflow';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ORIGIN = 'http://localhost:3000';
const PDF = Buffer.from('%PDF-1.7\ntrial test\n');

const tag = () => crypto.randomUUID().slice(0, 8);
const address = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** Every email sign-up would have sent, and to whom. */
function mailbox() {
  const sent: Email[] = [];
  return {
    sent,
    send: async (email: Email) => {
      sent.push(email);
      return { sent: true as const, messageId: 'test' };
    }
  };
}

/** The token in a link email: after `#`, as the page reads it. */
function tokenFrom(email: Email): string {
  const match = /\/trial\/start#([A-Za-z0-9_-]+)/.exec(email.text);
  assert.ok(match, 'the email carries a link');
  return match[1];
}

/** A sign-up as a person would make it: opened a while ago, ticked, from somewhere. */
async function signUp(
  email: string,
  over: Partial<Parameters<typeof requestTrialLink>[0]> = {}
) {
  const box = mailbox();
  const result = await requestTrialLink({
    email,
    address: address(),
    started: signUpStarted(new Date(Date.now() - 60_000)),
    fictionalOnly: true,
    origin: ORIGIN,
    send: box.send,
    ...over
  });
  return { result, sent: box.sent };
}

/** A trial, started the way a person starts one. */
async function startTrial(email = `trial-${tag()}@gmail.com`) {
  const { sent } = await signUp(email);
  const person = await redeemTrialLink(tokenFrom(sent[0]));
  assert.ok(person, 'the link signs somebody in');
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.userId, person.id));
  const [entity] = await db
    .select()
    .from(entities)
    .where(eq(entities.organisationId, trial.organisationId));
  return { person, trial, entity, organisationId: trial.organisationId };
}

/** A full account: an organisation that is not a trial, with an owner. */
async function fullOrganisation() {
  const [org] = await db
    .insert(organisations)
    .values({ name: 'Full', slug: `full-${tag()}` })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Full Ltd', isDefault: true })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ email: `owner-${tag()}@example.test` })
    .returning();
  const [membership] = await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: user.id })
    .returning();
  await db.insert(roleAssignments).values({
    membershipId: membership.id,
    role: 'owner',
    scope: 'organisation'
  });
  return { org, entity, user };
}

const actorOf = (person: { id: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: person.id,
  actorLabel: person.email
});

/** Move a trial's end, as if time had passed. */
async function endsIn(trialId: string, ms: number) {
  await db
    .update(trials)
    .set({ endsAt: new Date(Date.now() + ms) })
    .where(eq(trials.id, trialId));
}

before(async () => {
  // Sign-up attempts are counted across the whole service for an hour, and
  // belong to no organisation: earlier runs' would count against this one.
  await db.delete(trialSignups);
});

after(async () => {
  await pg.end();
});

describe('the trial clock and address', () => {
  it('counts one mailbox however it is spelt', () => {
    assert.equal(
      canonicalEmail('Jo.Bloggs+govern@GoogleMail.com'),
      'jobloggs@gmail.com'
    );
    assert.equal(
      canonicalEmail('jo.bloggs+x@example.org'),
      'jo.bloggs@example.org'
    );
  });

  it('says how long is left without false precision', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    assert.equal(
      timeLeft(new Date(now.getTime() + 2 * DAY + 4 * HOUR), now),
      '2 days 4 hours'
    );
    assert.equal(
      timeLeft(new Date(now.getTime() + 3 * HOUR + 12 * 60_000), now),
      '3 hours 12 minutes'
    );
    assert.equal(timeLeft(new Date(now.getTime() - 1), now), 'no time');
  });

  it('opens the request window only as the end approaches', () => {
    const now = new Date();
    const edge = REQUEST_WINDOW_HOURS * HOUR;
    assert.equal(
      inRequestWindow(new Date(now.getTime() + edge + HOUR), now),
      false
    );
    assert.equal(
      inRequestWindow(new Date(now.getTime() + edge - HOUR), now),
      true
    );
    assert.equal(inRequestWindow(new Date(now.getTime() - HOUR), now), true);
  });
});

describe('what a trial grant holds', () => {
  const trialOwner: Grant[] = [
    { role: 'owner', scope: 'organisation', trial: true }
  ];
  const owner: Grant[] = [{ role: 'owner', scope: 'organisation' }];

  it('withholds uploading, reaching outside and managing people', () => {
    for (const capability of TRIAL_WITHHELD) {
      assert.equal(can(trialOwner, capability), false, capability);
      assert.equal(can(owner, capability), true, capability);
      assert.equal(withheldByTrial(trialOwner, capability), true, capability);
    }
  });

  it('keeps everything else an owner may do', () => {
    for (const capability of [
      'record.write',
      'assessment.submit',
      'approval.decide',
      'org.manage',
      'entity.delete'
    ] as const)
      assert.equal(can(trialOwner, capability), true, capability);
    assert.equal(withheldByTrial(trialOwner, 'record.write'), false);
  });

  it('refuses imports, which are uploads', () => {
    assert.equal(mayImport(trialOwner), false);
    assert.equal(mayImport(owner), true);
  });
});

describe('signing up', () => {
  it('sends a single-use link to the address, and stores only its hash', async () => {
    const email = `new-${tag()}@gmail.com`;
    const { result, sent } = await signUp(email);
    assert.deepEqual(result, { ok: true, message: SIGN_UP_SENT });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, [email]);
    const token = tokenFrom(sent[0]);
    const rows = await db
      .select()
      .from(trialSignups)
      .where(eq(trialSignups.email, email));
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].tokenHash, token);
    assert.ok(!JSON.stringify(rows).includes(token), 'the token is not stored');
    assert.equal(await trialLinkState(token), 'valid');
  });

  it('answers an address with a full account exactly as a new one, and sends it no link', async () => {
    const { user } = await fullOrganisation();
    const { result, sent } = await signUp(user.email);
    assert.deepEqual(result, { ok: true, message: SIGN_UP_SENT });
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /already have/);
    assert.doesNotMatch(sent[0].text, /\/trial\/start#/);
  });

  it('refuses a form sent too quickly to be a person', async () => {
    const { result, sent } = await signUp(`quick-${tag()}@gmail.com`, {
      started: signUpStarted()
    });
    assert.equal(result.ok, false);
    assert.equal(sent.length, 0);
  });

  it('refuses a forged opening time', async () => {
    const { result } = await signUp(`forged-${tag()}@gmail.com`, {
      started: `${Date.now() - 60_000}.not-a-signature`
    });
    assert.equal(result.ok, false);
  });

  it('tells a filled-in hidden field it worked, and does nothing', async () => {
    const email = `bot-${tag()}@gmail.com`;
    const { result, sent } = await signUp(email, {
      trap: 'http://spam.example'
    });
    assert.deepEqual(result, { ok: true, message: SIGN_UP_SENT });
    assert.equal(sent.length, 0);
    const rows = await db
      .select()
      .from(trialSignups)
      .where(eq(trialSignups.email, email));
    assert.equal(rows.length, 0);
  });

  it('refuses an address that is not one, and a form without the tick', async () => {
    assert.equal((await signUp('not an address')).result.ok, false);
    assert.equal(
      (await signUp(`untick-${tag()}@gmail.com`, { fictionalOnly: false }))
        .result.ok,
      false
    );
  });

  it('limits how often one address can ask, however it is spelt', async () => {
    const local = `limit${tag()}`;
    for (let i = 0; i < LIMITS.perEmail; i++)
      assert.equal((await signUp(`${local}+${i}@gmail.com`)).result.ok, true);
    const { result, sent } = await signUp(
      `${local.slice(0, 3)}.${local.slice(3)}@googlemail.com`
    );
    assert.deepEqual(result, { ok: false, message: SIGN_UP_TOO_MANY });
    assert.equal(sent.length, 0);
  });

  it('holds to the limit when many ask at once', async () => {
    const local = `burst${tag()}`;
    const results = await Promise.all(
      Array.from({ length: LIMITS.perEmail + 3 }, (_, i) =>
        signUp(`${local}+${i}@gmail.com`)
      )
    );
    assert.equal(
      results.filter((r) => r.result.ok).length,
      LIMITS.perEmail,
      'no more links than the limit, however close together they come'
    );
  });

  it('limits how often one connection can ask', async () => {
    const from = address();
    for (let i = 0; i < LIMITS.perAddress; i++)
      assert.equal(
        (await signUp(`ip-${tag()}@gmail.com`, { address: from })).result.ok,
        true
      );
    const { result } = await signUp(`ip-${tag()}@gmail.com`, { address: from });
    assert.deepEqual(result, { ok: false, message: SIGN_UP_TOO_MANY });
  });
});

describe('using the link', () => {
  it('starts a trial organisation of its own, for the trial length, with its audit event', async () => {
    const before = Date.now();
    const { person, trial, organisationId } = await startTrial();
    const length = trial.endsAt.getTime() - trial.startedAt.getTime();
    assert.equal(length, TRIAL_MS);
    assert.ok(trial.startedAt.getTime() >= before - 1000);
    const members = await db
      .select({ userId: memberships.userId, simulated: users.simulated })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organisationId, organisationId));
    assert.deepEqual(
      members.filter((m) => !m.simulated).map((m) => m.userId),
      [person.id],
      'the person trying it is the only real member'
    );
    assert.equal(members.filter((m) => m.simulated).length, COLLEAGUES.length);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, organisationId),
          eq(auditEvents.action, 'trial.started')
        )
      );
    assert.ok(event, 'trial.started is recorded');
  });

  it('works once', async () => {
    const { sent } = await signUp(`once-${tag()}@gmail.com`);
    const token = tokenFrom(sent[0]);
    assert.ok(await redeemTrialLink(token));
    assert.equal(await redeemTrialLink(token), null);
    assert.equal(await trialLinkState(token), 'used');
  });

  it('expires', async () => {
    const { sent } = await signUp(`late-${tag()}@gmail.com`);
    const token = tokenFrom(sent[0]);
    const later = new Date(Date.now() + 31 * 60_000);
    assert.equal(await trialLinkState(token, later), 'expired');
    assert.equal(await redeemTrialLink(token, later), null);
  });

  it('signs back in to the same trial rather than starting another', async () => {
    const local = `again${tag()}`;
    const { person, trial } = await startTrial(`${local}@gmail.com`);
    const { sent } = await signUp(`${local}+second@gmail.com`);
    const again = await redeemTrialLink(tokenFrom(sent[0]));
    assert.equal(again?.id, person.id);
    const all = await db
      .select()
      .from(trials)
      .where(eq(trials.canonicalEmail, trial.canonicalEmail));
    assert.equal(all.length, 1);
  });

  it('marks every grant in the trial, and stops marking them once converted', async () => {
    const { person, trial } = await startTrial();
    const [membership] = await loadMemberships(person.id);
    assert.equal(membership.trial?.endsAt.getTime(), trial.endsAt.getTime());
    assert.ok(membership.grants.every((g) => g.trial === true));
    assert.equal(can(membership.grants, 'file.upload'), false);
    await db
      .update(trials)
      .set({ status: 'converted' })
      .where(eq(trials.id, trial.id));
    const [converted] = await loadMemberships(person.id);
    assert.equal(converted.trial, null);
    assert.equal(can(converted.grants, 'file.upload'), true);
  });
});

const DPIA = {
  activity_name: 'Loyalty scheme',
  nature: 'Record purchases against a loyalty card.',
  purpose: 'Reward repeat customers.',
  lawful_basis: 'contract',
  data_categories: ['account_identifiers'],
  special_category: false,
  subject_groups: 'Customers who join the scheme.',
  children_likely: false,
  dpo_consulted: 'no_dpo',
  criminal_offence: false,
  volume: 20000,
  retention: 'Two years from last purchase.',
  necessity: 'Needed to award points.',
  alternatives: 'Paper stamp cards rejected.',
  transparency: 'Scheme terms.',
  rights_support: 'Through the account page.',
  controller_role: 'controller',
  sources_and_flows: 'Till and website, held in the UK.',
  views_sought: 'Customer panel.',
  uses_ai: false,
  transfers_abroad: false,
  risk_description: 'Profiling of spending.',
  measures: 'No sale of data; short retention.',
  residual_accepted: false,
  likelihood: 'remote',
  impact: 'minimal'
};

/** A stand-in for Resend that records what would have been sent. */
function fakeResend() {
  const bodies: string[] = [];
  const fetch = (async (_url: string, init?: { body?: string }) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return {
    bodies,
    fetch,
    config: { apiKey: 'test', from: 'test@example.com' }
  };
}

const violates =
  (constraint: string) => (e: Error & { cause?: { message?: string } }) =>
    new RegExp(constraint).test(`${e.message} ${e.cause?.message ?? ''}`);

describe('the demo company', () => {
  let t: Awaited<ReturnType<typeof startTrial>>;
  before(async () => {
    t = await startTrial();
  });

  it('is filled in with fictional records to explore', async () => {
    const org = t.organisationId;
    const rows = await withOrganisation(org, async () => ({
      activities: await db
        .select()
        .from(processingActivities)
        .where(eq(processingActivities.organisationId, org)),
      breaches: await db
        .select()
        .from(breaches)
        .where(eq(breaches.organisationId, org)),
      systems: await db
        .select()
        .from(aiUseCases)
        .where(eq(aiUseCases.organisationId, org)),
      risks: await db.select().from(risks).where(eq(risks.organisationId, org)),
      suppliers: await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.organisationId, org)),
      agreements: await db
        .select()
        .from(dpas)
        .where(eq(dpas.organisationId, org)),
      requests: await db
        .select()
        .from(dataSubjectRequests)
        .where(eq(dataSubjectRequests.organisationId, org)),
      complaints: await db
        .select()
        .from(dataProtectionComplaints)
        .where(eq(dataProtectionComplaints.organisationId, org))
    }));
    assert.ok(rows.activities.length >= 3, 'processing activities');
    assert.equal(rows.breaches.length, 1, 'a breach in progress');
    assert.equal(rows.systems.length, 1, 'an AI system');
    assert.ok(rows.risks.length >= 2, 'with risks');
    assert.equal(rows.suppliers.length, 2, 'suppliers');
    assert.equal(rows.agreements.length, 1, 'one supplier has no agreement');
    assert.equal(rows.agreements[0].signedAt, null, 'the other is unsigned');
    assert.equal(rows.requests.length, 1, 'a request');
    assert.equal(rows.complaints.length, 1, 'a complaint');

    // What the sign-in page promises a visitor, one check per line of
    // DEMO_HIGHLIGHTS, in order: a new line there needs its check here.
    const approvers = await withOrganisation(org, () =>
      db
        .select({ id: users.id })
        .from(roleAssignments)
        .innerJoin(
          memberships,
          eq(memberships.id, roleAssignments.membershipId)
        )
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.organisationId, org),
            eq(roleAssignments.role, 'approver'),
            eq(users.simulated, true)
          )
        )
    );
    const promised = [
      rows.activities.length > 0,
      rows.breaches.some(
        (b) => b.discoveredAt.getTime() > Date.now() - 72 * HOUR
      ),
      rows.systems.length > 0 && rows.risks.length > 0,
      rows.agreements.length < rows.suppliers.length ||
        rows.agreements.some((a) => a.signedAt === null),
      rows.requests.length > 0 && rows.complaints.length > 0,
      approvers.length > 0
    ];
    assert.equal(promised.length, DEMO_HIGHLIGHTS.length);
    promised.forEach((kept, i) => assert.ok(kept, DEMO_HIGHLIGHTS[i]));

    // Every address in it is one nobody can be reached at.
    const text = JSON.stringify(rows);
    for (const [address] of text.matchAll(/[\w.+-]+@[\w.-]+/g))
      assert.match(address, /@(example\.com|simulated\.invalid)$/, address);
  });

  it('records the fictional-data acceptance as an audit event of its own', async () => {
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, t.organisationId),
          eq(auditEvents.action, 'trial.fictional_data_accepted')
        )
      );
    assert.ok(event, 'trial.fictional_data_accepted is recorded');
    assert.equal(event.actorUserId, t.person.id);
    assert.ok(t.trial.fictionalDataAcceptedAt instanceof Date);
    assert.ok(
      JSON.stringify(event.after).includes(FICTIONAL_ONLY.slice(0, 40))
    );
  });

  it('refuses a sign-up without the acceptance', async () => {
    const { result, sent } = await signUp(`noaccept-${tag()}@gmail.com`, {
      fictionalOnly: false
    });
    assert.equal(result.ok, false);
    assert.equal(sent.length, 0);
  });
});

describe('simulated colleagues', () => {
  let t: Awaited<ReturnType<typeof startTrial>>;
  before(async () => {
    t = await startTrial();
  });

  async function colleague(role: 'approver' | 'privacy_analyst') {
    const [row] = await db
      .select({ id: users.id, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(
        roleAssignments,
        eq(roleAssignments.membershipId, memberships.id)
      )
      .where(
        and(
          eq(memberships.organisationId, t.organisationId),
          eq(users.simulated, true),
          eq(roleAssignments.role, role)
        )
      );
    return row;
  }

  it('live at an address that cannot receive mail', async () => {
    const priya = await colleague('approver');
    assert.ok(priya.email.endsWith(`@${SIMULATED_DOMAIN}`));
    assert.ok(isUndeliverable(priya.email));
  });

  it('cannot be given email, or a sign-in, in the database', async () => {
    const priya = await colleague('approver');
    await assert.rejects(
      db
        .update(users)
        .set({ emailNotifications: true })
        .where(eq(users.id, priya.id)),
      violates('simulated_unreachable')
    );
    await assert.rejects(
      db
        .update(users)
        .set({ ssoSubject: `google:${tag()}` })
        .where(eq(users.id, priya.id)),
      violates('simulated_unreachable')
    );
  });

  it('are never emailed, however a message is addressed to them', async () => {
    const priya = await colleague('approver');
    const resend = fakeResend();
    const outcome = await sendEmail(
      {
        to: [priya.email],
        subject: 'Approve this',
        text: 'Please',
        tag: 'test'
      },
      { config: resend.config, fetch: resend.fetch }
    );
    assert.deepEqual(outcome, { sent: false, reason: 'no_recipients' });
    assert.equal(resend.bodies.length, 0);
  });

  it('take approval tasks in the app while the person trying it decides them, and nothing is emailed', async () => {
    const priya = await colleague('approver');
    const [version] = await withOrganisation(t.organisationId, () =>
      db
        .select({ id: templateVersions.id })
        .from(templateVersions)
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        .where(
          and(
            eq(templates.organisationId, t.organisationId),
            eq(templates.kind, 'dpia'),
            eq(templateVersions.status, 'published')
          )
        )
    );
    const me = actorOf(t.person);
    const assessment = await createAssessment({
      organisationId: t.organisationId,
      entityId: t.entity.id,
      templateVersionId: version.id,
      title: 'Loyalty scheme',
      actor: me
    });
    await saveAnswers({
      assessmentId: assessment.id,
      organisationId: t.organisationId,
      answers: DPIA as never,
      actor: me
    });
    await submitForApproval({
      assessmentId: assessment.id,
      organisationId: t.organisationId,
      actor: me
    });

    const queued = await withOrganisation(t.organisationId, () =>
      db
        .select()
        .from(notifications)
        .where(eq(notifications.organisationId, t.organisationId))
    );
    assert.ok(queued.length > 0, 'the stages raised work for somebody');

    // Each stage, decided by the person trying it, as an owner may decide any.
    for (let i = 0; i < 10; i++) {
      const [next] = await withOrganisation(t.organisationId, () =>
        db
          .select()
          .from(approvals)
          .where(
            and(
              eq(approvals.assessmentId, assessment.id),
              eq(approvals.status, 'pending')
            )
          )
          .orderBy(approvals.position)
      );
      if (!next) break;
      await decideApproval({
        approvalId: next.id,
        organisationId: t.organisationId,
        decision: 'approved',
        rationale: 'Reviewed in the trial.',
        boardReference: next.boardName ? 'Trial board, minute 1' : undefined,
        callerRoles: ['owner'],
        actor: me
      });
    }
    const [done] = await withOrganisation(t.organisationId, () =>
      db.select().from(assessments).where(eq(assessments.id, assessment.id))
    );
    assert.equal(done.status, 'approved');

    const resend = fakeResend();
    await deliverNotifications(t.organisationId, {
      config: resend.config,
      fetch: resend.fetch
    });
    for (const body of resend.bodies) {
      assert.ok(!body.includes(SIMULATED_DOMAIN), 'no colleague was emailed');
      assert.ok(!body.includes(priya.email));
    }
  });
});

describe('a trial reaches nobody else', () => {
  let t: Awaited<ReturnType<typeof startTrial>>;
  before(async () => {
    t = await startTrial();
  });

  it('is a trial, and a full organisation is not', async () => {
    assert.equal(await isTrial(t.organisationId), true);
    assert.equal(await isTrial((await fullOrganisation()).org.id), false);
  });

  it('refuses, in the database, a second member', async () => {
    const [stranger] = await db
      .insert(users)
      .values({ email: `stranger-${tag()}@example.test` })
      .returning();
    await assert.rejects(
      db
        .insert(memberships)
        .values({ organisationId: t.organisationId, userId: stranger.id }),
      (e: Error & { cause?: { message?: string } }) =>
        /only the person trying it/.test(
          `${e.message} ${e.cause?.message ?? ''}`
        )
    );
  });

  it('refuses an invitation', async () => {
    await assert.rejects(
      inviteMember({
        organisationId: t.organisationId,
        email: `colleague-${tag()}@example.test`,
        role: 'approver',
        entityId: null,
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
  });

  it('refuses handing work over', async () => {
    await assert.rejects(
      handOver({
        organisationId: t.organisationId,
        fromUserId: t.person.id,
        toUserId: crypto.randomUUID(),
        actor: actorOf(t.person)
      } as Parameters<typeof handOver>[0]),
      TrialRestricted
    );
  });

  it('refuses claiming and verifying an email domain', async () => {
    await assert.rejects(
      claimDomain({
        organisationId: t.organisationId,
        domain: 'example.org',
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
    await assert.rejects(
      verifyDomain({
        organisationId: t.organisationId,
        claimId: crypto.randomUUID(),
        actor: actorOf(t.person)
      } as Parameters<typeof verifyDomain>[0]),
      TrialRestricted
    );
  });

  it('refuses a contributor link, which would ask somebody outside for approval or answers', async () => {
    await assert.rejects(
      issueContributorLink({
        organisationId: t.organisationId,
        assessmentId: crypto.randomUUID(),
        email: `outside-${tag()}@example.test`,
        sectionKey: null,
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
  });

  it('refuses publishing a public request form, of either kind', async () => {
    for (const kind of ['data_protection', 'foi'] as const)
      await assert.rejects(
        issueIntakeLink({
          organisationId: t.organisationId,
          entityId: t.entity.id,
          label: 'Public form',
          kind,
          actor: actorOf(t.person)
        }),
        TrialRestricted,
        kind
      );
  });

  it('refuses an Integration API key or webhook, and a new secret for one', async () => {
    await assert.rejects(
      createConnection({
        organisationId: t.organisationId,
        kind: 'other',
        name: 'Webhook',
        webhookUrl: 'https://hooks.example/govern',
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
    await assert.rejects(
      rotateSecret({
        organisationId: t.organisationId,
        connectionId: crypto.randomUUID(),
        actor: actorOf(t.person)
      } as Parameters<typeof rotateSecret>[0]),
      TrialRestricted
    );
  });

  it('refuses the Integration API, even for a connection made before the trial', async () => {
    const full = await fullOrganisation();
    const connection = await createConnection({
      organisationId: full.org.id,
      kind: 'waivern_portal',
      name: 'Portal',
      actor: actorOf({ id: full.user.id, email: full.user.email })
    });
    const signed = () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ records: [] });
      const path = '/api/v1/ingest/vendors';
      return new Request(`http://localhost${path}`, {
        method: 'POST',
        body,
        headers: {
          'x-waivern-connection': connection.id,
          'x-waivern-timestamp': timestamp,
          'x-waivern-signature': signRequest({
            secret: connection.secret,
            timestamp,
            method: 'POST',
            pathWithQuery: path,
            body
          })
        }
      });
    };
    assert.equal((await authenticate(signed())).ok, true);
    await db.insert(trials).values({
      organisationId: full.org.id,
      userId: full.user.id,
      canonicalEmail: canonicalEmail(full.user.email),
      endsAt: new Date(Date.now() + DAY),
      fictionalDataAcceptedAt: new Date()
    });
    assert.equal((await authenticate(signed())).ok, false);
  });

  it('refuses an AI provider, and testing one', async () => {
    await assert.rejects(
      saveProvider({
        organisationId: t.organisationId,
        kind: 'openai_compatible',
        baseUrl: 'https://models.example/v1',
        model: 'any',
        surfaces: [],
        apiKey: 'sk-test',
        isActive: true,
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
    await assert.rejects(testProvider(t.organisationId), TrialRestricted);
  });

  it('refuses the Consent Analyser: settings, starting a scan and checking one', async () => {
    await assert.rejects(
      setAnalyserSettings({
        organisationId: t.organisationId,
        url: 'https://analyser.example',
        token: 'tok',
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
    await assert.rejects(
      startPropertyScan({
        organisationId: t.organisationId,
        propertyId: crypto.randomUUID(),
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
    await assert.rejects(
      checkPropertyScan({
        organisationId: t.organisationId,
        scanId: crypto.randomUUID()
      }),
      TrialRestricted
    );
  });

  it('refuses fetching a page named in an agreement', async () => {
    await assert.rejects(
      followLink({
        organisationId: t.organisationId,
        entityId: null,
        linkId: crypto.randomUUID(),
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
  });
});

describe('a trial is text only', () => {
  let t: Awaited<ReturnType<typeof startTrial>>;
  before(async () => {
    t = await startTrial();
  });

  it('attaches a built-in example file by name, with the content the server holds', async () => {
    const [supplier] = await withOrganisation(t.organisationId, () =>
      db
        .select()
        .from(suppliers)
        .where(eq(suppliers.organisationId, t.organisationId))
    );
    const stored = await attachSampleDocument({
      organisationId: t.organisationId,
      entityId: null,
      subjectType: 'supplier',
      subjectId: supplier.id,
      sampleId: 'sample-dpa',
      // Whatever else a caller sends is not read: only the id is.
      ...({ content: Buffer.from('my own file') } as object),
      actor: actorOf(t.person)
    } as Parameters<typeof attachSampleDocument>[0]);
    const row = await readDocument(stored.id, t.organisationId);
    assert.equal(
      row?.content.toString('utf8'),
      SAMPLE_FILES.find((f) => f.id === 'sample-dpa')!.text
    );
    assert.equal(row?.contentType, 'text/plain');
  });

  it('refuses an example file that does not exist, and offers none outside a trial', async () => {
    const [supplier] = await withOrganisation(t.organisationId, () =>
      db
        .select()
        .from(suppliers)
        .where(eq(suppliers.organisationId, t.organisationId))
    );
    await assert.rejects(
      attachSampleDocument({
        organisationId: t.organisationId,
        entityId: null,
        subjectType: 'supplier',
        subjectId: supplier.id,
        sampleId: '../../etc/passwd',
        actor: actorOf(t.person)
      }),
      /no such example file/
    );
    const full = await fullOrganisation();
    await assert.rejects(
      attachSampleDocument({
        organisationId: full.org.id,
        entityId: null,
        subjectType: 'supplier',
        subjectId: crypto.randomUUID(),
        sampleId: 'sample-dpa',
        actor: actorOf({ id: full.user.id, email: full.user.email })
      }),
      /for trials/
    );
  });

  it('refuses attaching a document or evidence', async () => {
    await assert.rejects(
      attachDocument({
        organisationId: t.organisationId,
        entityId: t.entity.id,
        subjectType: 'supplier',
        subjectId: crypto.randomUUID(),
        filename: 'contract.pdf',
        contentType: 'application/pdf',
        content: PDF,
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
  });

  it('refuses an import, and adding files to one', async () => {
    await assert.rejects(
      uploadImport({
        organisationId: t.organisationId,
        recordType: 'supplier',
        sourceName: 'Spreadsheet',
        entityId: null,
        filename: 'vendors.csv',
        contentType: 'text/csv',
        bytes: new Uint8Array(Buffer.from('name\nAcme\n')),
        actor: actorOf(t.person)
      } as Parameters<typeof uploadImport>[0]),
      TrialRestricted
    );
    await assert.rejects(
      addImportFiles({
        organisationId: t.organisationId,
        batchId: crypto.randomUUID(),
        files: [],
        actor: actorOf(t.person)
      } as Parameters<typeof addImportFiles>[0]),
      TrialRestricted
    );
  });

  it('refuses an uploaded cookie report', async () => {
    await assert.rejects(
      ingestAnalyserReport({
        organisationId: t.organisationId,
        propertyId: crypto.randomUUID(),
        report: {},
        source: 'upload',
        actor: actorOf(t.person)
      }),
      TrialRestricted
    );
  });

  it('refuses a logo on a form', async () => {
    await assert.rejects(
      setFormAppearance({
        organisationId: t.organisationId,
        linkId: null,
        kind: 'data_protection',
        logo: new Uint8Array(PDF),
        actor: actorOf(t.person)
      } as Parameters<typeof setFormAppearance>[0]),
      TrialRestricted
    );
  });
});

describe('asking for more', () => {
  it('waits for the last day', async () => {
    const t = await startTrial();
    await assert.rejects(
      requestTrialChange({
        userId: t.person.id,
        email: t.person.email,
        kind: 'convert',
        organisationName: 'Example Ltd',
        message: 'Please'
      }),
      TrialRefused
    );
  });

  it('only an administrator extends it, from now or from its end', async () => {
    const t = await startTrial();
    await endsIn(t.trial.id, 2 * HOUR);
    const request = await requestTrialChange({
      userId: t.person.id,
      email: t.person.email,
      kind: 'extend',
      organisationName: 'Example Ltd',
      message: 'A week more, please.'
    });
    await assert.rejects(
      requestTrialChange({
        userId: t.person.id,
        email: t.person.email,
        kind: 'extend',
        organisationName: 'Example Ltd',
        message: 'Again'
      }),
      TrialRefused,
      'one open request at a time'
    );
    const [before] = await db
      .select()
      .from(trials)
      .where(eq(trials.id, t.trial.id));
    await decideTrialRequest({
      requestId: request.id,
      decidedByEmail: 'ops@waivern.test',
      decision: 'extend',
      days: 7
    });
    const [extended] = await db
      .select()
      .from(trials)
      .where(eq(trials.id, t.trial.id));
    assert.equal(extended.endsAt.getTime() - before.endsAt.getTime(), 7 * DAY);
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, t.organisationId),
          eq(auditEvents.action, 'trial.extended')
        )
      );
    assert.equal(events.length, 1);
    await assert.rejects(
      decideTrialRequest({
        requestId: request.id,
        decidedByEmail: 'ops@waivern.test',
        decision: 'extend',
        days: 7
      }),
      TrialRefused,
      'decided once'
    );
  });

  it('can still ask once it has ended, and converting lifts every restriction', async () => {
    const t = await startTrial();
    await endsIn(t.trial.id, -HOUR);
    const request = await requestTrialChange({
      userId: t.person.id,
      email: t.person.email,
      kind: 'convert',
      organisationName: 'Example Ltd',
      message: 'We would like to carry on.'
    });
    await decideTrialRequest({
      requestId: request.id,
      decidedByEmail: 'ops@waivern.test',
      decision: 'convert'
    });
    assert.equal(await isTrial(t.organisationId), false);
    const [membership] = await loadMemberships(t.person.id);
    assert.equal(membership.trial, null);
    // The simulated colleagues leave with the trial: nothing real waits on them.
    const colleagues = await db
      .select({ isActive: memberships.isActive })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organisationId, t.organisationId),
          eq(users.simulated, true)
        )
      );
    assert.equal(colleagues.length, COLLEAGUES.length);
    assert.ok(colleagues.every((c) => !c.isActive));
    const [stranger] = await db
      .insert(users)
      .values({ email: `colleague-${tag()}@example.test` })
      .returning();
    await db
      .insert(memberships)
      .values({ organisationId: t.organisationId, userId: stranger.id });
  });

  it('says why when declining', async () => {
    const t = await startTrial();
    await endsIn(t.trial.id, HOUR);
    const request = await requestTrialChange({
      userId: t.person.id,
      email: t.person.email,
      kind: 'extend',
      organisationName: 'Example Ltd',
      message: 'More please'
    });
    await assert.rejects(
      decideTrialRequest({
        requestId: request.id,
        decidedByEmail: 'ops@waivern.test',
        decision: 'decline',
        note: ' '
      }),
      TrialRefused
    );
    await decideTrialRequest({
      requestId: request.id,
      decidedByEmail: 'ops@waivern.test',
      decision: 'decline',
      note: 'Talk to sales.'
    });
    const mine = await trialOfUser(t.person.id);
    assert.equal(mine?.lastDecided?.decisionNote, 'Talk to sales.');
    assert.equal(mine?.pending, null);
  });
});

describe('after the grace period', () => {
  it("deletes the trial's records, ends its membership and tells the address it has gone", async () => {
    const local = `gone${tag()}`;
    const t = await startTrial(`${local}@gmail.com`);
    await withOrganisation(t.organisationId, () =>
      db.insert(trialRequests).values({
        organisationId: t.organisationId,
        trialId: t.trial.id,
        kind: 'convert',
        organisationName: 'Example Ltd',
        message: 'Personal words',
        status: 'declined',
        decidedByEmail: 'ops@waivern.test',
        decidedAt: new Date(),
        decisionNote: 'Not now'
      })
    );
    await db
      .update(trials)
      .set({ organisationName: 'Their Real Ltd' })
      .where(eq(trials.id, t.trial.id));
    await endsIn(t.trial.id, -(RETENTION_DAYS + 1) * DAY);

    await purgeEndedTrials();

    const [trial] = await db
      .select()
      .from(trials)
      .where(eq(trials.id, t.trial.id));
    assert.equal(trial.status, 'purged');
    assert.equal(trial.organisationName, null);
    const events = await withOrganisation(t.organisationId, () =>
      db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, t.organisationId))
    );
    const started = events.find((e) => e.action === 'trial.started');
    assert.ok(started?.erasedAt, 'what the person gave at sign-up is erased');
    assert.equal(started?.after, null);
    const accepted = events.find(
      (e) => e.action === 'trial.fictional_data_accepted'
    );
    assert.equal(accepted?.erasedAt, null, 'the acceptance stays whole');
    const left = await db
      .select()
      .from(entities)
      .where(eq(entities.organisationId, t.organisationId));
    assert.deepEqual(
      left.map((e) => e.name),
      ['Ended trial']
    );
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.organisationId, t.organisationId));
    assert.equal(membership.isActive, false);
    assert.equal(
      (
        await db
          .select()
          .from(trialRequests)
          .where(eq(trialRequests.organisationId, t.organisationId))
      ).length,
      0
    );

    const { sent } = await signUp(`${local}@gmail.com`);
    assert.match(sent[0].subject, /ended/);
    assert.doesNotMatch(sent[0].text, /\/trial\/start#/);
  });

  it('waits for an answer to a request made in time', async () => {
    const t = await startTrial();
    await endsIn(t.trial.id, -HOUR);
    const request = await requestTrialChange({
      userId: t.person.id,
      email: t.person.email,
      kind: 'convert',
      organisationName: 'Example Ltd',
      message: 'We would like to carry on.'
    });
    await endsIn(t.trial.id, -(RETENTION_DAYS + 1) * DAY);

    await purgeEndedTrials();
    const statusOf = async () =>
      (await db.select().from(trials).where(eq(trials.id, t.trial.id)))[0]
        .status;
    assert.equal(await statusOf(), 'active', 'kept while the request waits');

    await decideTrialRequest({
      requestId: request.id,
      decidedByEmail: 'ops@waivern.test',
      decision: 'decline',
      note: 'Talk to sales.'
    });
    await purgeEndedTrials();
    assert.equal(await statusOf(), 'purged');
  });

  it('takes no new request once the records are due for deletion', async () => {
    const t = await startTrial();
    await endsIn(t.trial.id, -(RETENTION_DAYS + 1) * DAY);
    await assert.rejects(
      requestTrialChange({
        userId: t.person.id,
        email: t.person.email,
        kind: 'convert',
        organisationName: 'Example Ltd',
        message: 'Too late?'
      }),
      /being deleted/
    );
  });

  it('leaves a trial in its grace period alone', async () => {
    const t = await startTrial();
    await endsIn(t.trial.id, -DAY);
    await purgeEndedTrials();
    const [trial] = await db
      .select()
      .from(trials)
      .where(eq(trials.id, t.trial.id));
    assert.equal(trial.status, 'active');
  });
});
