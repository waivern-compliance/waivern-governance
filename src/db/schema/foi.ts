import { relations } from 'drizzle-orm';
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
  informationRequestStatus
} from './enums';
import { dataSubjectRequests } from './requests';
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

export const informationRequestsRelations = relations(
  informationRequests,
  ({ one, many }) => ({
    decisions: many(informationRequestDecisions),
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
