import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { organisations, users } from './tenancy';

/**
 * Where a request to delete a legal entity has got to.
 *
 * `requested` until the link emailed to the requester is used or lapses;
 * `erasing` only inside the transaction that deletes, which is what the
 * database's append-only guards look for before letting a row go
 * (`entity_erasure_in_progress()`); `completed` once it has committed.
 * `superseded` when the same entity was asked for again. A link that lapsed
 * unused stays `requested`, past its `expires_at`.
 */
export type EntityErasureStatus =
  'requested' | 'erasing' | 'completed' | 'superseded';

/**
 * A request to delete one legal entity and every record held for it, and,
 * once done, the record that it was done.
 *
 * Belongs to the organisation, not the entity, so it outlives what it deleted:
 * owners can see that an entity was deleted, by whom and when, and that is all.
 * No foreign key to the entity, which is gone. The entity's name is kept, as
 * the name of a company is what people will look for; nothing held about the
 * people in its records is.
 *
 * The link's token is stored only as its SHA-256, as contributor links are.
 */
export const entityErasures = pgTable(
  'entity_erasure',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').notNull(),
    entityName: text('entity_name').notNull(),
    legalEntityRef: text('legal_entity_ref'),
    status: text('status')
      .$type<EntityErasureStatus>()
      .notNull()
      .default('requested'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    requestedBy: uuid('requested_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    /** The requester's address of record when asked: where the link went. */
    requestedByEmail: text('requested_by_email').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Rows deleted, by table, and audit events whose contents were erased. */
    counts: jsonb('counts').$type<Record<string, number>>(),
    auditErased: integer('audit_erased')
  },
  (t) => [
    uniqueIndex('entity_erasure_token_key').on(t.tokenHash),
    index('entity_erasure_org_idx').on(t.organisationId, t.requestedAt)
  ]
);
