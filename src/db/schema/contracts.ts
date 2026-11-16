import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { suppliers } from './integration';
import { entities, organisations, users } from './tenancy';

/**
 * A commercial contract with a supplier, signed by one of our legal entities.
 * See `lib/thirdparty/contracts.ts`.
 *
 * Its commercial terms - the value and the signed copy - are shown only to
 * the people the person who added it named, to whoever added it, and to those
 * who may see every contract's terms (`contract.confidential`). Everything
 * else here is read like any other record, so renewals are never hidden from
 * the people who have to act on them.
 */
export const supplierContracts = pgTable(
  'supplier_contract',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    /** Commercial terms: restricted. Numeric, so no amount is ever rounded. */
    value: numeric('value', { precision: 16, scale: 2 }),
    currency: text('currency'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** Days before the end date by which notice must be given. */
    noticeDays: integer('notice_days'),
    autoRenews: boolean('auto_renews').notNull().default(false),
    /** Who added it, and so chose who may see its terms. */
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedReason: text('ended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('supplier_contract_reference').on(
      t.organisationId,
      t.reference
    ),
    index('supplier_contract_supplier_idx').on(t.supplierId),
    index('supplier_contract_entity_idx').on(t.organisationId, t.entityId),
    index('supplier_contract_end_idx').on(t.organisationId, t.endsAt)
  ]
);

/** The members named as allowed to see a contract's commercial terms. */
export const supplierContractViewers = pgTable(
  'supplier_contract_viewer',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => supplierContracts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.contractId, t.userId] }),
    index('supplier_contract_viewer_user_idx').on(t.userId)
  ]
);
