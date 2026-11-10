import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import type { FoiAct, FoiRegime, TimeProfile } from '@/lib/foi/statutory';

import {
  informationRequestDecisionKind,
  informationRequestOutcome,
  informationRequestRegulatorEventKind,
  informationRequestReviewOutcome,
  informationRequestReviewStatus,
  informationRequestStatus
} from './enums';
import { dataSubjectRequests, dsrIntakeLinks } from './requests';
import { entities, organisations, users } from './tenancy';

/**
 * A request for information held by a public authority, and how it was handled.
 *
 * Shaped like the register of data subject requests: the facts here, the
 * clock worked out from them by `lib/foi/statutory.ts`, never stored. The Act
 * and time profile are copied from the entity when the request is recorded, so
 * a later change to the entity does not move a deadline already running.
 *
 * Holds the requester's name and address for correspondence, which FOIA s.8
 * requires for a valid request, and nothing else about them: the law is
 * applicant-blind, and why they want the information is not asked.
 */
export const informationRequests = pgTable(
  'information_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'restrict' }),
    /** `FOI-2026-0001`, from the reference counter. */
    reference: text('reference').notNull(),
    act: text('act').$type<FoiAct>().notNull(),
    /**
     * The regimes the request falls under: the Act's own, its environmental
     * regulations, or both for a request that asks for both kinds of
     * information. One response answers it, so it is one record.
     */
    regimes: jsonb('regimes').$type<FoiRegime[]>().notNull(),
    timeProfile: text('time_profile')
      .$type<TimeProfile>()
      .notNull()
      .default('standard'),
    channel: text('channel').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    /** What they asked for, as they put it. */
    description: text('description').notNull(),
    requesterName: text('requester_name').notNull(),
    /** FOIA s.8(1)(b): an address for correspondence, postal or email. */
    correspondenceAddress: text('correspondence_address'),
    /**
     * The name looks like a pseudonym. Under FOIA and FOI(S)A a request needs
     * the applicant's real name (s.45 code 1.14); the environmental
     * regulations do not ask for one.
     */
    pseudonymous: boolean('pseudonymous').notNull().default(false),
    /** s.11: a copy, inspection, a digest or summary, or a format. */
    preferredMeans: text('preferred_means'),
    /** FOIA s.1(3), EIR reg 9: more needed to identify what is wanted. */
    clarificationSoughtAt: timestamp('clarification_sought_at', {
      withTimezone: true
    }),
    clarificationReceivedAt: timestamp('clarification_received_at', {
      withTimezone: true
    }),
    /** The handler's date for the twentieth school day (`school` profile). */
    schoolDaysDeadline: timestamp('school_days_deadline', {
      withTimezone: true
    }),
    /** A day the Information Commission set on application (FOIA only). */
    commissionSetDeadline: timestamp('commission_set_deadline', {
      withTimezone: true
    }),
    /** EIR / EI(S)R reg 7: complex and voluminous, and the applicant told. */
    extendedForComplexity: boolean('extended_for_complexity')
      .notNull()
      .default(false),
    status: informationRequestStatus('status').notNull().default('open'),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseSummary: text('response_summary'),
    /** What the response came to, for the figures. Null before it was asked. */
    outcome: informationRequestOutcome('outcome'),
    /**
     * The handler confirmed the refusal notice says everything the regime
     * requires (FOIA s.17, EIR reg 14, FOI(S)A ss.16 and 19, EI(S)R reg 13).
     * Required to record a response that refuses anything.
     */
    refusalNoticeChecked: boolean('refusal_notice_checked'),
    /** Where the response is kept: a document system, a mailbox. */
    responseLink: text('response_link'),
    lateReason: text('late_reason'),
    /** Released information was put on the disclosure log. */
    published: boolean('published'),
    /** The published web form it came through, if it did. */
    intakeLinkId: uuid('intake_link_id').references(() => dsrIntakeLinks.id, {
      onDelete: 'set null'
    }),
    /** Where it was for the requester's own personal data and became a DSR. */
    convertedToRequestId: uuid('converted_to_request_id').references(
      () => dataSubjectRequests.id,
      { onDelete: 'set null' }
    ),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closureRationale: text('closure_rationale'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('information_request_reference_key').on(
      t.organisationId,
      t.reference
    ),
    index('information_request_status_idx').on(t.organisationId, t.status),
    index('information_request_received_idx').on(
      t.organisationId,
      t.receivedAt
    ),
    index('information_request_converted_idx').on(t.convertedToRequestId)
  ]
);

/**
 * A judgement or a step on a freedom of information request, and the reason
 * for it. Append-only, like the decisions on data subject requests: a changed
 * mind is a new decision, so the record shows what was decided when.
 *
 * `detail` holds what the kind needs: whether information is held, the hours
 * estimated against the cost limit, the public interest factors on each side,
 * the date given for a public interest decision, a fee's amount.
 */
export const informationRequestDecisions = pgTable(
  'information_request_decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => informationRequests.id, { onDelete: 'cascade' }),
    kind: informationRequestDecisionKind('kind').notNull(),
    /** The regime of the request it is under, where that matters. */
    regime: text('regime').$type<FoiRegime>(),
    /** The section or regulation relied on: "s.43", "reg 12(4)(b)". */
    provision: text('provision'),
    detail: jsonb('detail')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Never optional: the record has to say why. */
    rationale: text('rationale').notNull(),
    /** When it happened, where that differs from when it was recorded. */
    effectiveAt: timestamp('effective_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    decidedByLabel: text('decided_by_label').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('information_request_decision_request_idx').on(
      t.requestId,
      t.decidedAt
    ),
    index('information_request_decision_kind_idx').on(t.organisationId, t.kind)
  ]
);

/**
 * A review of how a request was handled: the internal review under the FOIA
 * s.45 code (part 5), reconsideration under EIR reg 11, or review under
 * FOI(S)A ss.20 and 21 and EI(S)R reg 16. Its clock is worked out from these
 * facts by `lib/foi/statutory.ts`, never stored.
 *
 * A request may be reviewed more than once, but only one review is open at a
 * time. The grounds are the requester's; nothing else about them is kept.
 */
export const informationRequestReviews = pgTable(
  'information_request_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => informationRequests.id, { onDelete: 'cascade' }),
    /** The regimes of the request the review is about. */
    regimes: jsonb('regimes').$type<FoiRegime[]>().notNull(),
    /** When the request for review arrived, which starts its clock. */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    channel: text('channel').notNull(),
    /** What the requester is unhappy with, as they put it. */
    grounds: text('grounds').notNull(),
    /** The complaint is that no response came in time. */
    aboutNoResponse: boolean('about_no_response').notNull().default(false),
    /** Asked after the last day, and accepted anyway: why. */
    lateAcceptedReason: text('late_accepted_reason'),
    /** FOIA s.45 code, para 5.5: a further twenty working days, exceptionally. */
    exceptional: boolean('exceptional').notNull().default(false),
    exceptionalReason: text('exceptional_reason'),
    /** The handler's date for the twentieth school day (FOI(S)A `school` profile). */
    schoolDaysDeadline: timestamp('school_days_deadline', {
      withTimezone: true
    }),
    /** Who is reviewing, and whether they had no part in the original decision. */
    reviewerName: text('reviewer_name'),
    reviewerNotInvolved: boolean('reviewer_not_involved'),
    status: informationRequestReviewStatus('status').notNull().default('open'),
    outcome: informationRequestReviewOutcome('outcome'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    outcomeSummary: text('outcome_summary'),
    /** More information was released because of the review. */
    informationReleased: boolean('information_released'),
    /**
     * The review notice tells the requester they can go to the regulator (and,
     * under FOI(S)A s.21(10), of the s.47 application and s.56 appeal).
     */
    noticeChecked: boolean('notice_checked'),
    lateReason: text('late_reason'),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnNote: text('withdrawn_note'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('information_request_review_request_idx').on(
      t.requestId,
      t.requestedAt
    ),
    index('information_request_review_status_idx').on(
      t.organisationId,
      t.status
    ),
    uniqueIndex('information_request_review_one_open_key')
      .on(t.requestId)
      .where(sql`${t.status} = 'open'`)
  ]
);

/**
 * One dated step in a case before the regulator, or an appeal from its
 * decision, appended and never edited. `detail` holds what the kind needs:
 * the decision notice's finding and the date to comply by, who appealed.
 */
export const informationRequestRegulatorEvents = pgTable(
  'information_request_regulator_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => informationRequests.id, { onDelete: 'cascade' }),
    kind: informationRequestRegulatorEventKind('kind').notNull(),
    /** The regulator's or the tribunal's reference for the case. */
    caseReference: text('case_reference'),
    /** What happened. Never optional. */
    note: text('note').notNull(),
    detail: jsonb('detail')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    recordedByLabel: text('recorded_by_label').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('information_request_regulator_event_request_idx').on(
      t.requestId,
      t.occurredAt
    )
  ]
);

export const informationRequestsRelations = relations(
  informationRequests,
  ({ one, many }) => ({
    decisions: many(informationRequestDecisions),
    reviews: many(informationRequestReviews),
    regulatorEvents: many(informationRequestRegulatorEvents),
    entity: one(entities, {
      fields: [informationRequests.entityId],
      references: [entities.id]
    }),
    owner: one(users, {
      fields: [informationRequests.ownerId],
      references: [users.id]
    }),
    convertedTo: one(dataSubjectRequests, {
      fields: [informationRequests.convertedToRequestId],
      references: [dataSubjectRequests.id]
    })
  })
);

export const informationRequestDecisionsRelations = relations(
  informationRequestDecisions,
  ({ one }) => ({
    request: one(informationRequests, {
      fields: [informationRequestDecisions.requestId],
      references: [informationRequests.id]
    })
  })
);

export const informationRequestReviewsRelations = relations(
  informationRequestReviews,
  ({ one }) => ({
    request: one(informationRequests, {
      fields: [informationRequestReviews.requestId],
      references: [informationRequests.id]
    })
  })
);

export const informationRequestRegulatorEventsRelations = relations(
  informationRequestRegulatorEvents,
  ({ one }) => ({
    request: one(informationRequests, {
      fields: [informationRequestRegulatorEvents.requestId],
      references: [informationRequests.id]
    })
  })
);
