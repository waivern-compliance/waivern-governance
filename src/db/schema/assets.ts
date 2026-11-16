import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import type {
  AssetClassification,
  AssetType,
  HostingModel
} from '@/lib/assets/register';

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
    assetType: text('asset_type').$type<AssetType>().notNull(),
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
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    /** No longer in use: kept, with its links, and owes nothing. */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
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
    index('information_asset_entity_idx').on(t.organisationId, t.entityId),
    index('information_asset_review_idx').on(t.organisationId, t.nextReviewAt)
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
