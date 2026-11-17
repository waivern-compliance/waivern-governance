import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import type { SourceEvent } from '@/lib/import/types';

import { aiUseCases } from './ai';
import { documents } from './documents';
import { policyStatus, policyVersionStatus } from './enums';
import { importBatches, importSources } from './imports';
import { processingActivities } from './integration';
import { entities, organisations, users } from './tenancy';

/**
 * The register of an organisation's policies: information security,
 * acceptable use, retention, AI use and the rest. See issue #65.
 *
 * Separate from `policy_document`, the appropriate policy document the Data
 * Protection Act 2018 requires, which carries Schedule 1 conditions and its
 * own coverage checks.
 */
export const policies = pgTable(
  'policy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** The entity it is for. Null: every entity in the organisation. */
    entityId: uuid('entity_id').references(() => entities.id, {
      onDelete: 'restrict'
    }),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    /** What it is for, in a sentence or two. */
    summary: text('summary'),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    status: policyStatus('status').notNull().default('draft'),
    /** How often it is reviewed. The next review is set from it on approval. */
    reviewIntervalMonths: integer('review_interval_months')
      .notNull()
      .default(12),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnReason: text('withdrawn_reason'),
    /**
     * Moved in from another platform (docs/migration-plan.md): its identifier
     * there, the batch, and the source's fields with no home here. What the old platform
     * recorded of its approval is its account, shown as such: it was not
     * approved here, so it has no version in force here until one is.
     */
    externalRef: text('external_ref'),
    importSourceId: uuid('import_source_id').references(
      () => importSources.id,
      { onDelete: 'set null' }
    ),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null'
    }),
    legacy: jsonb('legacy').$type<Record<string, string>>(),
    sourceHistory: jsonb('source_history').$type<SourceEvent[]>(),
    /** Confirmed by a person here; until then it is not yet relied on. */
    importConfirmedAt: timestamp('import_confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('policy_reference_key').on(t.organisationId, t.reference),
    index('policy_entity_idx').on(t.organisationId, t.entityId),
    index('policy_review_idx').on(t.organisationId, t.nextReviewAt),
    uniqueIndex('policy_imported')
      .on(t.organisationId, t.importSourceId, t.externalRef)
      .where(
        sql`${t.importSourceId} is not null and ${t.externalRef} is not null`
      )
  ]
);

/**
 * One version of a policy, and the decision on it.
 *
 * A change to what a policy says is a new version, approved by somebody other
 * than the person who submitted it, naming where it was agreed. The version in
 * force is the one approved most recently; earlier ones are kept, superseded,
 * so the register shows what applied when.
 */
export const policyVersions = pgTable(
  'policy_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
    /** As the organisation numbers it: "2.1", "2026". */
    label: text('label').notNull(),
    /** What changed from the version before. */
    changes: text('changes'),
    /** The text of this version: one of the files attached to the policy. */
    documentId: uuid('document_id').references(() => documents.id, {
      onDelete: 'set null'
    }),
    status: policyVersionStatus('status').notNull().default('draft'),
    draftedByLabel: text('drafted_by_label').notNull(),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    submittedByLabel: text('submitted_by_label'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    decidedByLabel: text('decided_by_label'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Where it was agreed: the board or committee, the date, the minute. */
    approvalReference: text('approval_reference'),
    rejectionReason: text('rejection_reason'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('policy_version_policy_idx').on(t.policyId, t.createdAt),
    // One version in force, and one being worked on, at a time.
    uniqueIndex('policy_version_in_force')
      .on(t.policyId)
      .where(sql`${t.status} = 'approved'`),
    uniqueIndex('policy_version_open')
      .on(t.policyId)
      .where(sql`${t.status} in ('draft', 'submitted')`)
  ]
);

/** The processing activities a policy governs. */
export const policyActivities = pgTable(
  'policy_activity',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => processingActivities.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.policyId, t.activityId] }),
    index('policy_activity_idx').on(t.activityId)
  ]
);

/** The AI systems a policy governs. */
export const policyAiSystems = pgTable(
  'policy_ai_system',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
    aiUseCaseId: uuid('ai_use_case_id')
      .notNull()
      .references(() => aiUseCases.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.policyId, t.aiUseCaseId] }),
    index('policy_ai_system_idx').on(t.aiUseCaseId)
  ]
);
