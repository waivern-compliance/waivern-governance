import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import type { OutOfScopeReason } from '@/lib/cyber-essentials/scope';
import type { ScopeKind } from '@/lib/cyber-essentials/scope-checks';
import type { CeEditionId } from '@/lib/cyber-essentials/types';

import { informationAssets } from './assets';
import { entities, organisations, users } from './tenancy';

/**
 * A Cyber Essentials certification scope: what one certificate covers. See
 * `lib/cyber-essentials/scope-checks.ts`.
 *
 * It has one home entity, which decides who may open and change it, and
 * lists every legal entity the certificate covers, because the assessment
 * names each one. Cyber Essentials is a scheme an organisation takes up or a
 * contract asks for, not a legal duty.
 */
export const cyberScopes = pgTable(
  'cyber_scope',
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
    kind: text('kind').$type<ScopeKind>().notNull(),
    /** The business unit, network boundary and location, as the assessment asks for them. */
    boundary: text('boundary'),
    /** For a sub-set: the firewall or VLAN that separates it. */
    segregation: text('segregation'),
    /** What is left out of the boundary, and why: the assessor asks for both. */
    exclusions: text('exclusions'),
    /** The requirements edition it is being prepared against. */
    edition: text('edition').$type<CeEditionId>().notNull(),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('cyber_scope_reference').on(t.organisationId, t.reference),
    index('cyber_scope_entity_idx').on(t.organisationId, t.entityId)
  ]
);

/** The legal entities a scope's certificate covers, its home entity among them. */
export const cyberScopeEntities = pgTable(
  'cyber_scope_entity',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => cyberScopes.id, { onDelete: 'cascade' }),
    // A deleted entity stops being covered; its assets leave the scope with
    // them (`entity-erasure.ts`).
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.entityId] }),
    index('cyber_scope_entity_entity_idx').on(t.entityId)
  ]
);

/**
 * An asset placed in or out of a scope. One left out says why, from the
 * reasons the requirements allow (`OUT_OF_SCOPE_REASONS`).
 */
export const cyberScopeAssets = pgTable(
  'cyber_scope_asset',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => cyberScopes.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => informationAssets.id, { onDelete: 'cascade' }),
    inScope: boolean('in_scope').notNull(),
    reason: text('reason').$type<OutOfScopeReason>(),
    note: text('note')
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.assetId] }),
    index('cyber_scope_asset_asset_idx').on(t.assetId)
  ]
);
