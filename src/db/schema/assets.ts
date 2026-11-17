import { sql } from 'drizzle-orm';
import {
  boolean,
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

import type { AssetClassification, HostingModel } from '@/lib/assets/register';
import type { AssetDetailValues } from '@/lib/assets/types';

import { supplierContracts } from './contracts';
import { importBatches, importSources } from './imports';
import { processingActivities, suppliers } from './integration';
import { risks } from './risks';
import { entities, organisations, users } from './tenancy';

/**
 * An information asset: a system or repository the organisation holds
 * information in. See `lib/assets/register.ts`.
 *
 * It describes the system, never what is in it. The categories of personal
 * data stay on the processing register, which this links to.
 */
export const informationAssets = pgTable(
  'information_asset',
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
    /** A built-in type's key, or one of the organisation's own (`asset_type`). */
    assetType: text('asset_type').notNull(),
    /**
     * The information asset owner: the named person accountable for it. Null
     * is allowed and shown as a gap, because refusing to record an asset until
     * somebody owns it is how assets stay off the register.
     */
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    hosting: text('hosting').$type<HostingModel>(),
    /** Who hosts it, or which building it is in: "Microsoft Azure", "Head office basement". */
    hostedBy: text('hosted_by'),
    region: text('region'),
    /** The countries it is held in, as written. */
    countries: jsonb('countries').$type<string[]>().notNull().default([]),
    /** A level of the organisation's classification scheme. */
    classification: text('classification').$type<AssetClassification>(),
    /** How long what it holds is kept, and on what basis. Free text, as on the processing register. */
    retention: text('retention'),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    /** The fields particular to its type: a domain's registrar, a licence's seats. */
    details: jsonb('details').$type<AssetDetailValues>().notNull().default({}),
    /**
     * For a type that carries one: when it expires or is next due for renewal,
     * with the notice rules of a contract (`lib/renewals.ts`).
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    noticeDays: integer('notice_days'),
    autoRenews: boolean('auto_renews').notNull().default(false),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    /** No longer in use: kept, with its links, and owes nothing. */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    /**
     * Moved in from another platform (docs/migration-plan.md): its identifier
     * there, the batch, and the source's fields with no home here, kept to read.
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
    uniqueIndex('information_asset_reference').on(
      t.organisationId,
      t.reference
    ),
    uniqueIndex('information_asset_imported')
      .on(t.organisationId, t.importSourceId, t.externalRef)
      .where(
        sql`${t.importSourceId} is not null and ${t.externalRef} is not null`
      ),
    index('information_asset_entity_idx').on(t.organisationId, t.entityId),
    index('information_asset_review_idx').on(t.organisationId, t.nextReviewAt),
    index('information_asset_type_idx').on(t.organisationId, t.assetType),
    index('information_asset_expiry_idx').on(t.organisationId, t.expiresAt)
  ]
);

/**
 * A type of asset the organisation has added to the built-in ones
 * (`lib/assets/types.ts`). Never deleted while an asset has it; retired
 * instead, so those assets keep their type and no new one is given it.
 */
export const assetTypes = pgTable(
  'asset_type',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** What assets store. Made from the name when the type is added, and never changed. */
    key: text('key').notNull(),
    label: text('label').notNull(),
    definition: text('definition').notNull(),
    hasExpiry: boolean('has_expiry').notNull().default(false),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('asset_type_key').on(t.organisationId, t.key),
    uniqueIndex('asset_type_label').on(t.organisationId, t.label)
  ]
);

/** The contracts that pay for an asset: a subscription, a licence, a hosting agreement. */
export const informationAssetContracts = pgTable(
  'information_asset_contract',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => informationAssets.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => supplierContracts.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.contractId] }),
    index('information_asset_contract_idx').on(t.contractId)
  ]
);

/** The processing activities that use an asset. */
export const informationAssetActivities = pgTable(
  'information_asset_activity',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => informationAssets.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => processingActivities.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.activityId] }),
    index('information_asset_activity_idx').on(t.activityId)
  ]
);

/** The suppliers that host, run or support an asset. */
export const informationAssetSuppliers = pgTable(
  'information_asset_supplier',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => informationAssets.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.supplierId] }),
    index('information_asset_supplier_idx').on(t.supplierId)
  ]
);

/** The risks on the register that concern an asset. */
export const informationAssetRisks = pgTable(
  'information_asset_risk',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => informationAssets.id, { onDelete: 'cascade' }),
    riskId: uuid('risk_id')
      .notNull()
      .references(() => risks.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.riskId] }),
    index('information_asset_risk_idx').on(t.riskId)
  ]
);
