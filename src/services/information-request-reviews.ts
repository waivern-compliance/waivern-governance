import { and, asc, eq, inArray, like } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  informationRequestRegulatorEvents,
  informationRequestReviews,
  informationRequests,
  tasks
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  actOf,
  allowsExceptionalReview,
  APPEAL,
  appealDeadline,
  informationRequestReviewClock,
  REGIME,
  REGULATOR,
  REGULATOR_APPLICATION,
  REVIEW,
  reviewAskedLate,
  reviewRequestDeadline,
  type FoiRegime,
  type InformationRequestReviewClock
} from '@/lib/foi/statutory';

import {
  clean,
  clockOf,
  decisionsOf,
  earlierDay,
  InformationRequestRefused,
  lockedRequest,
  TEXT_LIMIT,
  type InformationRequest
} from './information-requests';
import type { Actor } from './templates';

/**
 * Reviews of freedom of information requests, and cases before the regulator.
 *
 * A review is the authority's second look: the internal review the FOIA s.45
 * code asks for (part 5), reconsideration under EIR reg 11, and the reviews
 * FOI(S)A ss.20 and 21 and EI(S)R reg 16 require. After it, the requester can
 * apply to the Information Commission (FOIA s.50) or the Scottish Information
 * Commissioner (FOI(S)A s.47), and either side can appeal the decision notice.
 *
 * As with the register, nothing here decides anything. The grounds are the
 * requester's words and stay out of the audit chain.
 */

export type InformationRequestReview =
  typeof informationRequestReviews.$inferSelect;
export type InformationRequestRegulatorEvent =
  typeof informationRequestRegulatorEvents.$inferSelect;
export type ReviewOutcome = NonNullable<InformationRequestReview['outcome']>;
export type RegulatorEventKind = InformationRequestRegulatorEvent['kind'];

/** How the review was asked for. */
export const REVIEW_CHANNELS = [
  'email',
  'web_form',
  'post',
  'social_media',
  'phone',
  'in_person'
] as const;

const SPOKEN: readonly string[] = ['phone', 'in_person'];

/**
 * Regimes that require a review to be asked for in a lasting form: EIR reg
 * 11(2) (in writing), FOI(S)A s.20(3) (in writing or another recordable form).
 */
const REVIEW_IN_WRITING: Partial<Record<FoiRegime, string>> = {
  eir: 'reg 11(2)',
  foisa: 's.20(3)'
};

/** What a decision notice found. */
export const NOTICE_FINDINGS = [
  'for_authority',
  'partly',
  'against_authority'
] as const;
export type NoticeFinding = (typeof NOTICE_FINDINGS)[number];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function notFuture(at: Date) {
  if (at.getTime() > Date.now() + 60_000)
    throw new InformationRequestRefused('That date is in the future.');
}

export function reviewClockOf(
  review: InformationRequestReview,
  request: Pick<InformationRequest, 'timeProfile'>,
  now = new Date()
): InformationRequestReviewClock {
  return informationRequestReviewClock({
    regimes: review.regimes,
    requestedAt: review.requestedAt,
    exceptional: review.exceptional,
    profile: request.timeProfile,
    schoolDaysDeadline: review.schoolDaysDeadline,
    decidedAt: review.decidedAt,
    withdrawn: review.status === 'withdrawn',
    now
  });
}

/**
 * The request's deadline and response, which the review window runs from.
 * Null where there is nothing to review: the request is not yet due, was
 * closed without a response being owed, or became a subject access request.
 */
async function reviewable(row: InformationRequest) {
  if (row.status === 'converted')
    throw new InformationRequestRefused(
      'This request became a subject access request. A complaint about it is a data protection complaint.'
    );
  if (row.status === 'closed')
    throw new InformationRequestRefused(
      'This request was closed without a response being owed, so there is no response to review.'
    );
  const decisions =
    (await decisionsOf(row.organisationId, [row.id])).get(row.id) ?? [];
  const clock = clockOf(row, decisions);
  if (!('dueAt' in clock))
    throw new InformationRequestRefused(
      'No time is running on this request yet, so there is nothing to review.'
    );
  if (row.status === 'open' && clock.state !== 'overdue')
    throw new InformationRequestRefused(
      'This request has not been answered and is not yet late. A review is of a response, or of a failure to give one in time.'
    );
  return { deadline: clock.dueAt, respondedAt: row.respondedAt };
}

async function retireReviewTasks(
  tx: Tx,
  input: { organisationId: string; reviewId: string; label: string }
) {
  await tx
    .update(tasks)
    .set({
      status: 'done',
      completedAt: new Date(),
      completedByLabel: input.label
    })
    .where(
      and(
        eq(tasks.organisationId, input.organisationId),
        eq(tasks.type, 'foi_deadline'),
        like(tasks.idempotencyKey, `foi-review:${input.reviewId}:%`),
        inArray(tasks.status, ['open', 'in_progress'])
      )
    );
}

/**
 * Record a request for review. One asked for after the last day need not be
 * accepted: say whether it is, and why. A declined one is recorded as decided
 * there and then, so the record shows it was asked for.
 */
export async function requestInformationRequestReview(input: {
  organisationId: string;
  requestId: string;
  regimes?: readonly string[];
  requestedAt: Date;
  channel: string;
  grounds: string;
  /** For a review asked for after the last day. */
  late?: { accept: boolean; reason: string } | null;
  reviewerName?: string | null;
  reviewerNotInvolved?: boolean | null;
  schoolDaysDeadline?: Date | null;
  actor: Actor;
}) {
  const grounds = clean(input.grounds);
  if (!grounds)
    throw new InformationRequestRefused(
      'Say what the requester is unhappy with, in their words.'
    );
  if (grounds.length > TEXT_LIMIT)
    throw new InformationRequestRefused('The grounds are too long.');
  if (!(REVIEW_CHANNELS as readonly string[]).includes(input.channel))
    throw new InformationRequestRefused('Say how the review was asked for.');
  notFuture(input.requestedAt);

  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const request = await lockedRequest(
        input.organisationId,
        input.requestId
      );
      const { deadline, respondedAt } = await reviewable(request);

      const asked = input.regimes?.length ? [...new Set(input.regimes)] : null;
      const regimes = asked
        ? request.regimes.filter((r) => asked.includes(r))
        : request.regimes;
      if (regimes.length === 0 || (asked && regimes.length !== asked.length))
        throw new InformationRequestRefused(
          'A review can only be of the regimes the request was handled under.'
        );

      if (SPOKEN.includes(input.channel)) {
        const written = regimes.find((r) => REVIEW_IN_WRITING[r]);
        if (written)
          throw new InformationRequestRefused(
            `A review under the ${REGIME[written].label} has to be asked for in writing (${REVIEW_IN_WRITING[written]}). Help them put it in writing.`
          );
      }

      if (earlierDay(input.requestedAt, respondedAt ?? request.receivedAt))
        throw new InformationRequestRefused(
          respondedAt
            ? 'The review cannot be asked for before the response was sent.'
            : 'The review cannot be asked for before the request arrived.'
        );

      const [open] = await tx
        .select({ id: informationRequestReviews.id })
        .from(informationRequestReviews)
        .where(
          and(
            eq(informationRequestReviews.requestId, request.id),
            eq(informationRequestReviews.status, 'open')
          )
        );
      if (open)
        throw new InformationRequestRefused(
          'A review of this request is already open. Decide it, or record that it was withdrawn, first.'
        );

      const lateRegimes = reviewAskedLate({
        regimes,
        requestedAt: input.requestedAt,
        respondedAt,
        deadline
      });
      const allLate = lateRegimes.length === regimes.length;
      const lateReason = clean(input.late?.reason);
      if (allLate && (!input.late || !lateReason)) {
        const lastDay = reviewRequestDeadline({
          regime: regimes[0],
          respondedAt,
          deadline
        });
        throw new InformationRequestRefused(
          `This was asked for after the last day, ${lastDay.toISOString().slice(0, 10)}. You need not accept it. Say whether you do, and why.`
        );
      }
      const declined = allLate && input.late?.accept === false;

      const [row] = await tx
        .insert(informationRequestReviews)
        .values({
          organisationId: input.organisationId,
          requestId: request.id,
          regimes,
          requestedAt: input.requestedAt,
          channel: input.channel,
          grounds,
          aboutNoResponse: request.status === 'open',
          lateAcceptedReason: allLate && !declined ? lateReason : null,
          schoolDaysDeadline: input.schoolDaysDeadline ?? null,
          reviewerName: clean(input.reviewerName),
          reviewerNotInvolved: input.reviewerNotInvolved ?? null,
          createdBy: input.actor.actorUserId ?? null,
          ...(declined
            ? {
                status: 'decided' as const,
                outcome: 'declined' as const,
                decidedAt: new Date(),
                outcomeSummary: lateReason
              }
            : {})
        })
        .returning();

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: request.entityId,
        action: declined ? 'foi.review_declined' : 'foi.review_requested',
        subjectType: 'information_request',
        subjectId: request.id,
        after: {
          reviewId: row.id,
          regimes,
          requestedAt: input.requestedAt.toISOString(),
          askedLate: allLate,
          aboutNoResponse: row.aboutNoResponse
        }
      });
      return row;
    })
  );
}

/** A review of the given request, locked; the request is named so a caller checked against its entity cannot reach another entity's review. */
async function lockedReview(
  organisationId: string,
  requestId: string,
  reviewId: string
) {
  const [row] = await db
    .select()
    .from(informationRequestReviews)
    .where(
      and(
        eq(informationRequestReviews.id, reviewId),
        eq(informationRequestReviews.requestId, requestId),
        eq(informationRequestReviews.organisationId, organisationId)
      )
    )
    .for('update');
  if (!row) throw new InformationRequestRefused('No such review.');
  if (row.status !== 'open')
    throw new InformationRequestRefused(
      'This review has been decided or withdrawn.'
    );
  const [request] = await db
    .select()
    .from(informationRequests)
    .where(eq(informationRequests.id, row.requestId));
  return { review: row, request };
}

/**
 * Take the further twenty working days the FOIA code allows in exceptional
 * cases (para 5.5): long or complex reviews. The requester should be told.
 * No other regime has it: EIR reg 11(4) is already forty days, and FOI(S)A
 * s.21(1) and EI(S)R reg 16(4) are twenty, without extension.
 */
export async function extendInformationRequestReview(input: {
  organisationId: string;
  requestId: string;
  reviewId: string;
  reason: string;
  actor: Actor;
}) {
  const reason = clean(input.reason);
  if (!reason)
    throw new InformationRequestRefused(
      'Say why the review needs more time. The code allows it only in exceptional cases.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const { review, request } = await lockedReview(
        input.organisationId,
        input.requestId,
        input.reviewId
      );
      if (!review.regimes.some(allowsExceptionalReview))
        throw new InformationRequestRefused(
          'Only a FOIA internal review can take more time (s.45 code, para 5.5). The others have a fixed limit.'
        );
      if (review.exceptional)
        throw new InformationRequestRefused('The review was already extended.');
      const clock = reviewClockOf(review, request);
      if (clock.state === 'overdue')
        throw new InformationRequestRefused(
          'The time for the review has already run out. Decide it, and record why it was late.'
        );
      const [after] = await tx
        .update(informationRequestReviews)
        .set({
          exceptional: true,
          exceptionalReason: reason,
          updatedAt: new Date()
        })
        .where(eq(informationRequestReviews.id, review.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: request.entityId,
        action: 'foi.review_extended',
        subjectType: 'information_request',
        subjectId: request.id,
        after: { reviewId: review.id, reason }
      });
      return after;
    })
  );
}

/**
 * Record what the review came to. The notice has to tell the requester they
 * can go to the regulator (FOIA s.17(7) for the original notice and the code
 * for the review; FOI(S)A s.21(10), which also names the s.56 appeal).
 */
export async function decideInformationRequestReview(input: {
  organisationId: string;
  requestId: string;
  reviewId: string;
  outcome: ReviewOutcome;
  decidedAt: Date;
  summary: string;
  informationReleased?: boolean | null;
  noticeChecked?: boolean;
  lateReason?: string | null;
  reviewerName?: string | null;
  reviewerNotInvolved?: boolean | null;
  actor: Actor;
}) {
  const summary = clean(input.summary);
  if (!summary)
    throw new InformationRequestRefused(
      'Say what the review found, and what changes because of it.'
    );
  if (input.outcome === 'declined')
    throw new InformationRequestRefused(
      'Only a review asked for after the last day can be declined, and that is recorded when it arrives.'
    );
  notFuture(input.decidedAt);
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const { review, request } = await lockedReview(
        input.organisationId,
        input.requestId,
        input.reviewId
      );
      if (earlierDay(input.decidedAt, review.requestedAt))
        throw new InformationRequestRefused(
          'The review cannot be decided before it was asked for.'
        );
      const act = actOf(review.regimes[0]);
      if (!input.noticeChecked)
        throw new InformationRequestRefused(
          `Confirm the review notice tells the requester they can apply to ${REGULATOR[act]}${act === 'foisa' ? ' (s.47) and appeal to the Court of Session (s.56)' : ' (s.50)'}.`
        );
      const reviewerName = clean(input.reviewerName) ?? review.reviewerName;
      if (!reviewerName)
        throw new InformationRequestRefused('Say who carried out the review.');
      const clock = reviewClockOf(
        { ...review, decidedAt: input.decidedAt },
        request
      );
      const lateReason = clean(input.lateReason);
      if (clock.state === 'late' && !lateReason)
        throw new InformationRequestRefused(
          'The review was decided after the time allowed. Record why: the requester can take the delay to the regulator.'
        );
      const [after] = await tx
        .update(informationRequestReviews)
        .set({
          status: 'decided',
          outcome: input.outcome,
          decidedAt: input.decidedAt,
          outcomeSummary: summary,
          informationReleased: input.informationReleased ?? null,
          noticeChecked: true,
          lateReason: clock.state === 'late' ? lateReason : null,
          reviewerName,
          reviewerNotInvolved:
            input.reviewerNotInvolved ?? review.reviewerNotInvolved,
          updatedAt: new Date()
        })
        .where(eq(informationRequestReviews.id, review.id))
        .returning();
      await retireReviewTasks(tx, {
        organisationId: input.organisationId,
        reviewId: review.id,
        label: input.actor.actorLabel
      });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: request.entityId,
        action: 'foi.review_decided',
        subjectType: 'information_request',
        subjectId: request.id,
        after: {
          reviewId: review.id,
          outcome: input.outcome,
          decidedAt: input.decidedAt.toISOString(),
          onTime: clock.state === 'met',
          informationReleased: input.informationReleased ?? null
        }
      });
      return after;
    })
  );
}

/** The requester withdrew the review. */
export async function withdrawInformationRequestReview(input: {
  organisationId: string;
  requestId: string;
  reviewId: string;
  note: string;
  actor: Actor;
}) {
  const note = clean(input.note);
  if (!note)
    throw new InformationRequestRefused(
      'Say how the requester withdrew it, and when.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const { review, request } = await lockedReview(
        input.organisationId,
        input.requestId,
        input.reviewId
      );
      const [after] = await tx
        .update(informationRequestReviews)
        .set({
          status: 'withdrawn',
          withdrawnAt: new Date(),
          withdrawnNote: note,
          updatedAt: new Date()
        })
        .where(eq(informationRequestReviews.id, review.id))
        .returning();
      await retireReviewTasks(tx, {
        organisationId: input.organisationId,
        reviewId: review.id,
        label: input.actor.actorLabel
      });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: request.entityId,
        action: 'foi.review_withdrawn',
        subjectType: 'information_request',
        subjectId: request.id,
        after: { reviewId: review.id }
      });
      return after;
    })
  );
}

export type RegulatorCase = {
  open: boolean;
  caseReference: string | null;
  /** The last day to appeal the latest decision notice, while none is lodged. */
  appealBy: Date | null;
  /** The date the regulator set for taking the steps it required, while owed. */
  complyBy: Date | null;
  /** An appeal is lodged and not yet decided. */
  appealPending: boolean;
};

const dateOf = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * How the case before the regulator stands, from its events in order. Only
 * the latest case counts: a closed case followed by a new application is a
 * new case.
 */
export function regulatorCaseOf(
  events: readonly InformationRequestRegulatorEvent[],
  act: 'foia' | 'foisa'
): RegulatorCase {
  const ordered = [...events].sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      a.recordedAt.getTime() - b.recordedAt.getTime()
  );
  const lastApplication = ordered.map((e) => e.kind).lastIndexOf('application');
  const current = lastApplication < 0 ? [] : ordered.slice(lastApplication);
  const none: RegulatorCase = {
    open: false,
    caseReference: null,
    appealBy: null,
    complyBy: null,
    appealPending: false
  };
  if (current.length === 0) return none;
  const caseReference =
    [...current].reverse().find((e) => e.caseReference)?.caseReference ?? null;
  const open = !current.some((e) => e.kind === 'closed');

  let complyBy: Date | null = null;
  let appealBy: Date | null = null;
  let appealPending = false;
  for (const e of current) {
    if (e.kind === 'decision_notice') {
      complyBy = dateOf(e.detail.complyBy);
      appealBy = appealDeadline(act, e.occurredAt);
      appealPending = false;
    } else if (e.kind === 'enforcement_notice') {
      complyBy = dateOf(e.detail.complyBy);
    } else if (e.kind === 'appeal_lodged') {
      appealPending = true;
      appealBy = null;
    } else if (e.kind === 'appeal_decided') {
      appealPending = false;
      // The tribunal's own order replaces the notice's steps, where it sets any.
      complyBy = dateOf(e.detail.complyBy);
    } else if (e.kind === 'complied') {
      complyBy = null;
    }
  }
  return {
    open,
    caseReference,
    appealBy: open && !appealPending ? appealBy : null,
    // Steps an appeal affects need not be taken while it is pending (FOIA s.50(6)).
    complyBy: open && !appealPending ? complyBy : null,
    appealPending: open && appealPending
  };
}

/**
 * Record a step in a case before the regulator or an appeal from it. The
 * order is checked: an application starts a case, a decision notice comes
 * before compliance or an appeal, and nothing follows a closed case except a
 * new application.
 */
export async function recordRegulatorEvent(input: {
  organisationId: string;
  requestId: string;
  kind: RegulatorEventKind;
  caseReference?: string | null;
  note: string;
  occurredAt: Date;
  detail?: Record<string, unknown>;
  actor: Actor;
}) {
  const note = clean(input.note);
  if (!note) throw new InformationRequestRefused('Say what happened.');
  notFuture(input.occurredAt);
  const detail = input.detail ?? {};

  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const request = await lockedRequest(
        input.organisationId,
        input.requestId
      );
      if (request.status === 'converted')
        throw new InformationRequestRefused(
          'This request became a subject access request. A case about it is a data protection matter.'
        );
      if (earlierDay(input.occurredAt, request.receivedAt))
        throw new InformationRequestRefused(
          'That is before the request arrived.'
        );
      const events = await tx
        .select()
        .from(informationRequestRegulatorEvents)
        .where(eq(informationRequestRegulatorEvents.requestId, request.id))
        .orderBy(asc(informationRequestRegulatorEvents.occurredAt));
      const act = request.act;
      const state = regulatorCaseOf(events, act);
      const current = (() => {
        const i = events.map((e) => e.kind).lastIndexOf('application');
        return i < 0 ? [] : events.slice(i);
      })();
      const has = (k: RegulatorEventKind) => current.some((e) => e.kind === k);

      const recorded: Record<string, unknown> = {};
      if (input.kind === 'application') {
        if (state.open)
          throw new InformationRequestRefused(
            'A case is already open with the regulator. Record what happens in it, or that it closed.'
          );
        if (REGULATOR_APPLICATION[act].reviewFirst === 'required') {
          const reviews = await tx
            .select()
            .from(informationRequestReviews)
            .where(eq(informationRequestReviews.requestId, request.id));
          const reviewed = reviews.some(
            (r) =>
              r.status === 'decided' ||
              (r.status === 'open' &&
                reviewClockOf(r, request).state === 'overdue')
          );
          if (!reviewed)
            throw new InformationRequestRefused(
              `Under FOI(S)A ${REGULATOR_APPLICATION.foisa.provision}(1) an application to ${REGULATOR.foisa} comes after a review, or after the time for one runs out. Record the review first.`
            );
        }
      } else {
        if (current.length === 0)
          throw new InformationRequestRefused(
            `Record the application to ${REGULATOR[act]} first. The date the regulator gives for it is enough.`
          );
        if (!state.open)
          throw new InformationRequestRefused(
            'This case is closed. A new application starts a new case.'
          );
      }

      if (input.kind === 'decision_notice' || input.kind === 'appeal_decided') {
        const finding = text(detail.finding);
        if (!(NOTICE_FINDINGS as readonly string[]).includes(finding))
          throw new InformationRequestRefused(
            'Say what was found: for the authority, partly, or against it.'
          );
        recorded.finding = finding;
        const complyBy = dateOf(detail.complyBy);
        if (
          input.kind === 'decision_notice' &&
          finding !== 'for_authority' &&
          !complyBy
        )
          throw new InformationRequestRefused(
            'The notice requires steps. Give the date it sets for taking them.'
          );
        if (complyBy) {
          if (earlierDay(complyBy, input.occurredAt))
            throw new InformationRequestRefused(
              'The date to comply by cannot be before the notice.'
            );
          recorded.complyBy = complyBy.toISOString();
        }
        if (input.kind === 'appeal_decided' && !state.appealPending)
          throw new InformationRequestRefused(
            'No appeal is pending. Record the appeal first.'
          );
      }

      if (input.kind === 'enforcement_notice') {
        const complyBy = dateOf(detail.complyBy);
        if (!complyBy)
          throw new InformationRequestRefused(
            'Give the date the enforcement notice sets for taking the steps.'
          );
        recorded.complyBy = complyBy.toISOString();
      }

      if (input.kind === 'appeal_lodged') {
        if (!has('decision_notice'))
          throw new InformationRequestRefused(
            'An appeal is against a decision notice. Record the notice first.'
          );
        if (state.appealPending)
          throw new InformationRequestRefused('An appeal is already pending.');
        const appellant = text(detail.appellant);
        if (appellant !== 'authority' && appellant !== 'requester')
          throw new InformationRequestRefused(
            'Say who appealed: the authority or the requester.'
          );
        recorded.appellant = appellant;
        recorded.to = APPEAL[act].to;
      }

      if (
        input.kind === 'complied' &&
        !has('decision_notice') &&
        !has('enforcement_notice')
      )
        throw new InformationRequestRefused(
          'There are no steps to comply with. Record the notice that required them first.'
        );

      const [row] = await tx
        .insert(informationRequestRegulatorEvents)
        .values({
          organisationId: input.organisationId,
          requestId: request.id,
          kind: input.kind,
          caseReference: clean(input.caseReference),
          note,
          detail: recorded,
          occurredAt: input.occurredAt,
          recordedBy: input.actor.actorUserId ?? null,
          recordedByLabel: input.actor.actorLabel
        })
        .returning();

      // A step done, or a case closed, asks for nothing more.
      if (
        input.kind === 'complied' ||
        input.kind === 'closed' ||
        input.kind === 'appeal_lodged'
      )
        await tx
          .update(tasks)
          .set({
            status: 'done',
            completedAt: new Date(),
            completedByLabel: input.actor.actorLabel
          })
          .where(
            and(
              eq(tasks.organisationId, input.organisationId),
              eq(tasks.type, 'foi_deadline'),
              eq(tasks.subjectType, 'information_request'),
              eq(tasks.subjectId, request.id),
              like(tasks.idempotencyKey, `foi-comply:${request.id}:%`),
              inArray(tasks.status, ['open', 'in_progress'])
            )
          );

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: request.entityId,
        action: 'foi.regulator_event_recorded',
        subjectType: 'information_request',
        subjectId: request.id,
        after: {
          eventId: row.id,
          kind: row.kind,
          caseReference: row.caseReference,
          occurredAt: input.occurredAt.toISOString(),
          ...recorded
        }
      });
      return row;
    })
  );
}

export type LoadedReview = InformationRequestReview & {
  clock: InformationRequestReviewClock;
  askedLate: boolean;
  lastDayToAsk: Date | null;
};

/**
 * A request's reviews and regulator case, for its page. `lastDayToAsk` is the
 * window for a new review, where one could still be asked for.
 */
export async function reviewsAndRegulator(
  organisationId: string,
  request: InformationRequest & { clock: { state: string; dueAt?: Date } }
) {
  return withOrganisation(organisationId, async () => {
    const [reviews, events] = await Promise.all([
      db
        .select()
        .from(informationRequestReviews)
        .where(
          and(
            eq(informationRequestReviews.organisationId, organisationId),
            eq(informationRequestReviews.requestId, request.id)
          )
        )
        .orderBy(asc(informationRequestReviews.requestedAt)),
      db
        .select()
        .from(informationRequestRegulatorEvents)
        .where(
          and(
            eq(
              informationRequestRegulatorEvents.organisationId,
              organisationId
            ),
            eq(informationRequestRegulatorEvents.requestId, request.id)
          )
        )
        .orderBy(
          asc(informationRequestRegulatorEvents.occurredAt),
          asc(informationRequestRegulatorEvents.recordedAt)
        )
    ]);
    const deadline = request.clock.dueAt ?? null;
    const lastDay = (regimes: readonly FoiRegime[]) =>
      deadline
        ? regimes
            .map((regime) =>
              reviewRequestDeadline({
                regime,
                respondedAt: request.respondedAt,
                deadline
              })
            )
            .reduce((a, b) => (b > a ? b : a))
        : null;
    const now = new Date();
    return {
      reviews: reviews.map(
        (r): LoadedReview => ({
          ...r,
          clock: reviewClockOf(r, request, now),
          askedLate:
            deadline !== null &&
            reviewAskedLate({
              regimes: r.regimes,
              requestedAt: r.requestedAt,
              respondedAt: request.respondedAt,
              deadline
            }).length === r.regimes.length,
          lastDayToAsk: lastDay(r.regimes)
        })
      ),
      lastDayToAsk: lastDay(request.regimes),
      mayAskForReview:
        request.status === 'responded' ||
        (request.status === 'open' && request.clock.state === 'overdue'),
      events,
      regulatorCase: regulatorCaseOf(events, request.act)
    };
  });
}

/**
 * Open reviews whose time is close or gone, and regulator steps due within a
 * week or past, for the sweep to raise as tasks.
 */
export async function reviewsNeedingAttention(organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const open = await db
      .select({
        review: informationRequestReviews,
        request: informationRequests
      })
      .from(informationRequestReviews)
      .innerJoin(
        informationRequests,
        eq(informationRequests.id, informationRequestReviews.requestId)
      )
      .where(
        and(
          eq(informationRequestReviews.organisationId, organisationId),
          eq(informationRequestReviews.status, 'open')
        )
      );
    const now = new Date();
    const reviews = open
      .map(({ review, request }) => ({
        review,
        request,
        clock: reviewClockOf(review, request, now)
      }))
      .filter(
        (r) => r.clock.state === 'due_soon' || r.clock.state === 'overdue'
      );

    const events = await db
      .select({
        event: informationRequestRegulatorEvents,
        request: informationRequests
      })
      .from(informationRequestRegulatorEvents)
      .innerJoin(
        informationRequests,
        eq(informationRequests.id, informationRequestRegulatorEvents.requestId)
      )
      .where(
        eq(informationRequestRegulatorEvents.organisationId, organisationId)
      );
    const byRequest = new Map<
      string,
      {
        request: InformationRequest;
        events: InformationRequestRegulatorEvent[];
      }
    >();
    for (const { event, request } of events) {
      const entry = byRequest.get(request.id) ?? { request, events: [] };
      entry.events.push(event);
      byRequest.set(request.id, entry);
    }
    const week = now.getTime() + 7 * 86_400_000;
    const steps = [...byRequest.values()]
      .map(({ request, events: own }) => ({
        request,
        regulatorCase: regulatorCaseOf(own, request.act)
      }))
      .filter(
        (c) =>
          c.regulatorCase.complyBy && c.regulatorCase.complyBy.getTime() <= week
      );
    return { reviews, steps };
  });
}

/** The words for a review's name under a regime, for the page. */
export function reviewName(regimes: readonly FoiRegime[]): string {
  const names = [...new Set(regimes.map((r) => REVIEW[r].name))];
  return names.join(' and ');
}
