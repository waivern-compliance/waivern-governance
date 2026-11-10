import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  memberships,
  organisations,
  tasks,
  users
} from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import { setFreedomOfInformation } from '@/services/entities';
import {
  decideInformationRequestReview,
  extendInformationRequestReview,
  recordRegulatorEvent,
  regulatorCaseOf,
  requestInformationRequestReview,
  reviewsAndRegulator,
  withdrawInformationRequestReview
} from '@/services/information-request-reviews';
import {
  convertToSubjectAccessRequest,
  InformationRequestRefused,
  loadInformationRequest,
  recordInformationRequest,
  respondToInformationRequest
} from '@/services/information-requests';
import { sweepOrganisation } from '@/services/sweep';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'foi review test'
};
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

after(() => pg.end());

async function world(label: string, act: 'foia' | 'foisa' = 'foia') {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `FOI review ${label}`,
      slug: `foi-review-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Council', isDefault: true })
    .returning();
  const [handler] = await db
    .insert(users)
    .values({ email: `handler-${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: handler.id });
  await setFreedomOfInformation({
    organisationId: org.id,
    entityId: entity.id,
    act,
    timeProfile: 'standard',
    actor: SYSTEM
  });
  return { org, entity };
}

type World = Awaited<ReturnType<typeof world>>;

/** A request answered `respondedDaysAgo` days ago, received a week before that. */
async function answered(
  w: World,
  respondedDaysAgo = 3,
  over: Partial<Parameters<typeof recordInformationRequest>[0]> = {}
) {
  const request = await recordInformationRequest({
    organisationId: w.org.id,
    entityId: w.entity.id,
    channel: 'email',
    receivedAt: daysAgo(respondedDaysAgo + 7),
    description: 'Spending on agency staff in 2025.',
    requesterName: 'Alex Applicant',
    correspondenceAddress: 'alex@example.com',
    actor: SYSTEM,
    ...over
  });
  await respondToInformationRequest({
    outcome: 'released_in_full',
    organisationId: w.org.id,
    requestId: request.id,
    respondedAt: daysAgo(respondedDaysAgo),
    summary: 'Released in part.',
    actor: SYSTEM
  });
  return request;
}

function ask(
  w: World,
  requestId: string,
  over: Partial<Parameters<typeof requestInformationRequestReview>[0]> = {}
) {
  return requestInformationRequestReview({
    organisationId: w.org.id,
    requestId,
    requestedAt: daysAgo(1),
    channel: 'email',
    grounds: 'You withheld the agency names. I think that is wrong.',
    actor: SYSTEM,
    ...over
  });
}

const refusedWith = (pattern: RegExp) => (error: unknown) =>
  error instanceof InformationRequestRefused && pattern.test(error.message);

describe('asking for a review', () => {
  it('records it with its clock, and keeps the grounds out of the audit chain', async () => {
    const w = await world('record');
    const request = await answered(w);
    const review = await ask(w, request.id);
    assert.equal(review.status, 'open');
    assert.deepEqual(review.regimes, ['foia']);
    assert.equal(review.aboutNoResponse, false);

    const loaded = await loadInformationRequest(request.id, w.org.id);
    const after = await reviewsAndRegulator(w.org.id, loaded!);
    assert.equal(after.reviews[0].clock.state, 'running');
    assert.equal(after.mayAskForReview, true);

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'foi.review_requested')
        )
      );
    assert.equal(events.length, 1);
    assert.doesNotMatch(JSON.stringify(events[0].after), /agency names/);
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
  });

  it('is refused for a request not yet answered and not late, or converted', async () => {
    const w = await world('early');
    const open = await recordInformationRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: daysAgo(2),
      description: 'Minutes of the planning committee.',
      requesterName: 'Alex Applicant',
      actor: SYSTEM
    });
    await assert.rejects(ask(w, open.id), refusedWith(/not yet late/));
    await convertToSubjectAccessRequest({
      organisationId: w.org.id,
      requestId: open.id,
      actor: SYSTEM
    });
    await assert.rejects(ask(w, open.id), refusedWith(/subject access/));
  });

  it('takes a review of a request that went unanswered past its deadline', async () => {
    const w = await world('unanswered');
    const late = await recordInformationRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: daysAgo(45),
      description: 'Minutes of the planning committee.',
      requesterName: 'Alex Applicant',
      actor: SYSTEM
    });
    const review = await ask(w, late.id, {
      grounds: 'You never replied.'
    });
    assert.equal(review.aboutNoResponse, true);
  });

  it('keeps one review open at a time', async () => {
    const w = await world('one');
    const request = await answered(w);
    await ask(w, request.id);
    await assert.rejects(ask(w, request.id), refusedWith(/already open/));
  });

  it('needs an environmental review in writing', async () => {
    const w = await world('spoken');
    const request = await answered(w, 3, {
      kind: 'environmental',
      channel: 'phone'
    });
    await assert.rejects(
      ask(w, request.id, { channel: 'phone' }),
      refusedWith(/reg 11\(2\)/)
    );
  });

  it('asks whether a late request for review is accepted, and records a declined one', async () => {
    const w = await world('late');
    const request = await answered(w, 120);
    await assert.rejects(ask(w, request.id), refusedWith(/after the last day/));
    const declined = await ask(w, request.id, {
      late: { accept: false, reason: 'Four months after the response.' }
    });
    assert.equal(declined.status, 'decided');
    assert.equal(declined.outcome, 'declined');

    const accepted = await ask(w, request.id, {
      late: { accept: true, reason: 'They were in hospital.' }
    });
    assert.equal(accepted.status, 'open');
    assert.equal(accepted.lateAcceptedReason, 'They were in hospital.');
  });
});

describe('deciding a review', () => {
  it('needs the reviewer and the regulator right in the notice, and records the outcome', async () => {
    const w = await world('decide');
    const request = await answered(w);
    const review = await ask(w, request.id);
    const decide = (
      over: Partial<Parameters<typeof decideInformationRequestReview>[0]>
    ) =>
      decideInformationRequestReview({
        organisationId: w.org.id,
        requestId: request.id,
        reviewId: review.id,
        outcome: 'varied',
        decidedAt: new Date(),
        summary: 'Agency names released; rates still withheld under s.43.',
        reviewerName: 'Head of Legal',
        noticeChecked: true,
        actor: SYSTEM,
        ...over
      });
    await assert.rejects(
      decide({ noticeChecked: false }),
      refusedWith(/Information Commission/)
    );
    await assert.rejects(
      decide({ reviewerName: null }),
      refusedWith(/who carried out/)
    );
    await assert.rejects(
      decide({ outcome: 'declined' }),
      refusedWith(/declined/)
    );
    const decided = await decide({ informationReleased: true });
    assert.equal(decided.status, 'decided');
    assert.equal(decided.outcome, 'varied');
    assert.equal(decided.informationReleased, true);
    await assert.rejects(decide({}), refusedWith(/decided or withdrawn/));
  });

  it('gives a FOIA review the code extension, and no other', async () => {
    const w = await world('extend');
    const request = await answered(w);
    const review = await ask(w, request.id);
    const before = (
      await reviewsAndRegulator(
        w.org.id,
        (await loadInformationRequest(request.id, w.org.id))!
      )
    ).reviews[0].clock;
    await extendInformationRequestReview({
      organisationId: w.org.id,
      requestId: request.id,
      reviewId: review.id,
      reason: 'Six hundred pages to re-read.',
      actor: SYSTEM
    });
    const extended = (
      await reviewsAndRegulator(
        w.org.id,
        (await loadInformationRequest(request.id, w.org.id))!
      )
    ).reviews[0].clock;
    assert.ok('dueAt' in before && 'dueAt' in extended);
    assert.ok(extended.dueAt > before.dueAt);

    const s = await world('extend-scot', 'foisa');
    const scottish = await answered(s);
    const scotReview = await ask(s, scottish.id);
    await assert.rejects(
      extendInformationRequestReview({
        organisationId: s.org.id,
        requestId: scottish.id,
        reviewId: scotReview.id,
        reason: 'Long.',
        actor: SYSTEM
      }),
      refusedWith(/Only a FOIA internal review/)
    );
  });

  it('will not reach a review through another request', async () => {
    const w = await world('cross');
    const one = await answered(w);
    const two = await answered(w);
    const review = await ask(w, one.id);
    await assert.rejects(
      withdrawInformationRequestReview({
        organisationId: w.org.id,
        requestId: two.id,
        reviewId: review.id,
        note: 'By email.',
        actor: SYSTEM
      }),
      refusedWith(/No such review/)
    );
  });

  it('raises a task for an overdue review, once, and retires it on the decision', async () => {
    const w = await world('sweep');
    const request = await answered(w, 50, { receivedAt: daysAgo(55) });
    const review = await ask(w, request.id, {
      requestedAt: daysAgo(40),
      late: null
    });
    const first = await sweepOrganisation(w.org.id);
    assert.equal(first.foiReviewDeadlinesRaised, 1);
    assert.equal(
      (await sweepOrganisation(w.org.id)).foiReviewDeadlinesRaised,
      0
    );
    await decideInformationRequestReview({
      organisationId: w.org.id,
      requestId: request.id,
      reviewId: review.id,
      outcome: 'upheld',
      decidedAt: new Date(),
      summary: 'The exemption was rightly applied.',
      reviewerName: 'Head of Legal',
      noticeChecked: true,
      lateReason: 'The reviewer was on leave.',
      actor: SYSTEM
    });
    const open = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, w.org.id),
          eq(tasks.type, 'foi_deadline'),
          eq(tasks.status, 'open')
        )
      );
    assert.deepEqual(
      open.filter((t) => t.idempotencyKey?.startsWith('foi-review:')),
      []
    );
  });
});

describe('the regulator', () => {
  it('starts with an application and checks the order of what follows', async () => {
    const w = await world('regulator');
    const request = await answered(w, 20);
    const step = (
      kind: Parameters<typeof recordRegulatorEvent>[0]['kind'],
      detail: Record<string, unknown> = {},
      occurredAt = daysAgo(1)
    ) =>
      recordRegulatorEvent({
        organisationId: w.org.id,
        requestId: request.id,
        kind,
        note: 'Letter received.',
        occurredAt,
        detail,
        actor: SYSTEM
      });
    await assert.rejects(step('enquiry'), refusedWith(/application/));
    await recordRegulatorEvent({
      organisationId: w.org.id,
      requestId: request.id,
      kind: 'application',
      caseReference: 'IC-123456',
      note: 'The Commission told us of the complaint.',
      occurredAt: daysAgo(10),
      actor: SYSTEM
    });
    await assert.rejects(step('application'), refusedWith(/already open/));
    await assert.rejects(step('appeal_lodged'), refusedWith(/notice first/));
    await assert.rejects(
      step('decision_notice', { finding: 'against_authority' }),
      refusedWith(/date it sets/)
    );
    const complyBy = new Date(Date.now() + 35 * DAY).toISOString();
    await step('decision_notice', { finding: 'against_authority', complyBy });

    let loaded = await reviewsAndRegulator(
      w.org.id,
      (await loadInformationRequest(request.id, w.org.id))!
    );
    assert.equal(loaded.regulatorCase.open, true);
    assert.equal(loaded.regulatorCase.caseReference, 'IC-123456');
    assert.equal(loaded.regulatorCase.complyBy?.toISOString(), complyBy);
    assert.ok(loaded.regulatorCase.appealBy);

    await step('appeal_lodged', { appellant: 'authority' });
    loaded = await reviewsAndRegulator(
      w.org.id,
      (await loadInformationRequest(request.id, w.org.id))!
    );
    assert.equal(loaded.regulatorCase.appealPending, true);
    assert.equal(loaded.regulatorCase.complyBy, null, 'suspended by appeal');

    await step('appeal_decided', { finding: 'for_authority' });
    await step('closed');
    await assert.rejects(step('enquiry'), refusedWith(/closed/));
  });

  it('needs a review before an application to the Scottish Information Commissioner', async () => {
    const w = await world('scot', 'foisa');
    const request = await answered(w, 20);
    await assert.rejects(
      recordRegulatorEvent({
        organisationId: w.org.id,
        requestId: request.id,
        kind: 'application',
        note: 'Application made.',
        occurredAt: daysAgo(1),
        actor: SYSTEM
      }),
      refusedWith(/s\.47\(1\)/)
    );
  });

  it('clears the steps once they are taken', () => {
    const at = (n: number) => daysAgo(n);
    const event = (
      kind: Parameters<typeof recordRegulatorEvent>[0]['kind'],
      n: number,
      detail: Record<string, unknown> = {}
    ) => ({
      id: crypto.randomUUID(),
      organisationId: 'o',
      requestId: 'r',
      kind,
      caseReference: null,
      note: '',
      detail,
      occurredAt: at(n),
      recordedBy: null,
      recordedByLabel: 'x',
      recordedAt: at(n)
    });
    const state = regulatorCaseOf(
      [
        event('application', 30),
        event('decision_notice', 20, {
          finding: 'partly',
          complyBy: at(-10).toISOString()
        }),
        event('complied', 5)
      ],
      'foia'
    );
    assert.equal(state.complyBy, null);
    assert.equal(state.open, true);
  });
});
