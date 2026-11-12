import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { actorKind, recordType } from './enums';
import { entities, organisations, users } from './tenancy';

/**
 * The append-only record of every state change. Each row carries the hash of
 * its predecessor, so removing or altering a row breaks the chain from that
 * point onward and the break is detectable by anyone holding an export.
 *
 * Rows are never deleted, and only one update is possible: erasing an event's
 * contents (`before`, `after` and `metadata`) through `eraseAuditContents` in
 * `lib/audit.ts`. That clears the contents, keeps their digest, and is itself
 * an audit event written in the same transaction; the database refuses any
 * other update or delete (migrations 0001 and 0112). Nothing else in the code
 * updates or deletes audit rows.
 *
 * Since scheme 2 the hash covers a digest of the contents rather than the
 * contents, so an erased event still verifies. Events written before then
 * (scheme 1) keep their original hashes; their digests are committed by the
 * organisation's `audit.scheme_changed` event (see `verifyAuditChain`).
 *
 * Tamper-evidence is cheap to add now and cannot be retrofitted credibly later:
 * a chain that starts three months into the record proves nothing about the
 * three months before it.
 */
export const auditEvents = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    /** Position in this organisation's chain. Gapless, starting at 1. */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),

    actorKind: actorKind('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    /**
     * Human-readable actor for the record, kept even if the user row is later
     * removed — and the only actor identifier a link contributor has.
     */
    actorLabel: text('actor_label').notNull(),

    /** Namespaced past-tense verb, e.g. `assessment.submitted`. */
    action: text('action').notNull(),
    subjectType: recordType('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** Entity the subject belongs to, so audit exports can be scoped. */
    entityId: uuid('entity_id').references(() => entities.id, {
      onDelete: 'set null'
    }),

    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    /** Hash of the preceding event. The first event in a chain uses GENESIS_HASH. */
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),

    /**
     * How `hash` was computed. 1: over the contents themselves, as written
     * before the change. 2: over `content_digest` instead.
     */
    scheme: integer('scheme').notNull().default(1),
    /**
     * SHA-256 of the canonical [before, after, metadata]. Set on every scheme 2
     * event when written, and on scheme 1 events when their organisation's
     * chain moved to scheme 2. Never changes afterwards.
     */
    contentDigest: text('content_digest'),
    /** When the contents were erased, and the event that records the erasure. */
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    erasedBy: uuid('erased_by')
  },
  (t) => [
    uniqueIndex('audit_org_seq_key').on(t.organisationId, t.seq),
    index('audit_subject_idx').on(t.organisationId, t.subjectType, t.subjectId),
    index('audit_at_idx').on(t.organisationId, t.at),
    index('audit_actor_idx').on(t.organisationId, t.actorUserId)
  ]
);

/**
 * One row per organisation holding the tip of its chain. Appending takes a row
 * lock on this record, which is what makes concurrent writes serialise into a
 * single ordering with no gaps and no forks. Without it, two simultaneous
 * writers would both read the same predecessor and produce a branch.
 */
export const auditChainHeads = pgTable('audit_chain_head', {
  organisationId: uuid('organisation_id')
    .primaryKey()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  seq: bigint('seq', { mode: 'number' }).notNull().default(0),
  headHash: text('head_hash').notNull(),
  /**
   * The scheme new events are written under. A chain begun before scheme 2
   * moves to it on its next append (`appendAuditEvent`).
   */
  scheme: integer('scheme').notNull().default(2),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});
