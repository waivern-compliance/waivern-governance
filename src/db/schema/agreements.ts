import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { entities, organisations, users } from './tenancy';

/**
 * The evidence that somebody accepted Waivern's terms for the hosted service,
 * as themselves.
 *
 * The terms bind every user personally (clause 1.3), so each accepts them once
 * per version. A row records exactly what was accepted - the version and a
 * SHA-256 of the text on screen - and when and from where, because in a dispute
 * it is Waivern that has to prove the contract was made and on which terms.
 * Append-only (see `drizzle/0091_agreement_guards.sql`): an acceptance is a
 * fact about the past, and a new version is a new row, never an edit.
 *
 * The platform's, like the user it names: row-level security is on with no
 * policy, so no organisation's work can read it.
 */
export const termsAcceptances = pgTable(
  'terms_acceptance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** As at acceptance, so the record stands if the account changes later. */
    email: text('email').notNull(),
    name: text('name'),
    termsVersion: text('terms_version').notNull(),
    termsSha256: text('terms_sha256').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  // One acceptance per version: a second, from another tab, adds nothing.
  (t) => [uniqueIndex('terms_acceptance_user_idx').on(t.userId, t.termsVersion)]
);

/**
 * The evidence that a legal entity accepted the terms and the Data Processing
 * Agreement, through a person with authority to bind it.
 *
 * Each legal entity is a controller in its own right, so each is a party to its
 * own Data Processing Agreement (UK GDPR Article 28(3)), and nobody may work in
 * its records until one is in place. The person accepting confirms in terms
 * that they may bind it, and their name and position are kept with the entity's
 * name and reference as they stood that day. Append-only, like the terms
 * acceptance above.
 */
export const entityAgreements = pgTable(
  'entity_agreement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'restrict' }),
    entityName: text('entity_name').notNull(),
    legalEntityRef: text('legal_entity_ref'),
    termsVersion: text('terms_version').notNull(),
    termsSha256: text('terms_sha256').notNull(),
    dpaVersion: text('dpa_version').notNull(),
    dpaSha256: text('dpa_sha256').notNull(),
    acceptedBy: uuid('accepted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acceptedByEmail: text('accepted_by_email').notNull(),
    /** The name they gave, which is what they signed as. */
    acceptedByName: text('accepted_by_name').notNull(),
    acceptedByPosition: text('accepted_by_position').notNull(),
    /** Always true: the database refuses a row without it. */
    authorityConfirmed: boolean('authority_confirmed').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    // One acceptance per entity and pair of versions, however many owners
    // accept at once.
    uniqueIndex('entity_agreement_entity_idx').on(
      t.entityId,
      t.termsVersion,
      t.dpaVersion
    ),
    index('entity_agreement_org_idx').on(t.organisationId)
  ]
);
