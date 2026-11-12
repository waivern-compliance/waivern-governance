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

import type { CallNumbers } from '@/lib/ie-eprivacy/marketing';
import type { EprivacyScope } from '@/lib/ie-eprivacy/scope';

import {
  marketingActivityStatus,
  marketingBasis,
  marketingChannel,
  marketingRecipients
} from './enums';
import { processingActivities } from './integration';
import { entities, organisations, users } from './tenancy';

/**
 * One campaign or channel of electronic direct marketing: the unit PECR
 * regulations 19 to 22 apply to.
 *
 * Linked to the ROPA processing activity that has direct marketing among its
 * purposes, so objections upheld in the request register count against it.
 * The suppression list itself stays in the marketing tool: this records what the
 * sending relies on, not who is on the list.
 */
export const marketingActivities = pgTable(
  'marketing_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'restrict' }),
    reference: text('reference').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    channel: marketingChannel('channel').notNull(),
    recipients: marketingRecipients('recipients')
      .notNull()
      .default('individuals'),
    /**
     * Which of its entity's ePrivacy laws govern it: UK PECR, the Irish
     * ePrivacy Regulations, or both (`lib/ie-eprivacy/scope.ts`).
     */
    eprivacyScope: text('eprivacy_scope')
      .$type<EprivacyScope>()
      .notNull()
      .default('uk'),
    /** Where it is sent from: the email platform, the dialler. */
    tool: text('tool'),
    processingActivityId: uuid('processing_activity_id').references(
      () => processingActivities.id,
      { onDelete: 'set null' }
    ),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    status: marketingActivityStatus('status').notNull().default('active'),
    /** For live calls: when the numbers were last screened against the TPS and CTPS. */
    tpsScreenedAt: timestamp('tps_screened_at', { withTimezone: true }),
    /**
     * Under the Irish Regulations: when the numbers were last screened
     * against the National Directory Database (an opt-out binds after 28
     * days), whether calls go to landlines or mobiles (mobiles need consent),
     * and whether marketing is added to texts sent for another purpose
     * (13(7)). See `lib/ie-eprivacy/marketing.ts`.
     */
    nddScreenedAt: timestamp('ndd_screened_at', { withTimezone: true }),
    callNumbers: text('call_numbers').$type<CallNumbers>(),
    inServiceTexts: boolean('in_service_texts'),
    /** For the charity soft opt-in: the charity's registration number. Only registered charities qualify. */
    charityNumber: text('charity_number'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('marketing_activity_reference_key').on(
      t.organisationId,
      t.reference
    ),
    index('marketing_activity_entity_idx').on(t.organisationId, t.entityId)
  ]
);

/**
 * The basis one activity relies on, decided by a named person with reasons,
 * and kept rather than overwritten. Changing one's mind is a second decision.
 */
export const marketingDecisions = pgTable(
  'marketing_decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => marketingActivities.id, { onDelete: 'cascade' }),
    basis: marketingBasis('basis').notNull(),
    /**
     * The law the basis is recorded under: UK PECR or the Irish ePrivacy
     * Regulations. An activity under both has a decision for each.
     */
    law: text('law').$type<'uk' | 'ie'>().notNull().default('uk'),
    /** Which of the basis's conditions the person confirmed. */
    conditions: jsonb('conditions')
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    /** "PECR reg 22(3)". */
    statutoryBasis: text('statutory_basis').notNull(),
    /** Never optional. */
    rationale: text('rationale').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    decidedByLabel: text('decided_by_label').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('marketing_decision_activity_idx').on(t.activityId, t.decidedAt)
  ]
);

export const marketingActivityRelations = relations(
  marketingActivities,
  ({ many, one }) => ({
    decisions: many(marketingDecisions),
    entity: one(entities, {
      fields: [marketingActivities.entityId],
      references: [entities.id]
    })
  })
);

export const marketingDecisionRelations = relations(
  marketingDecisions,
  ({ one }) => ({
    activity: one(marketingActivities, {
      fields: [marketingDecisions.activityId],
      references: [marketingActivities.id]
    })
  })
);
