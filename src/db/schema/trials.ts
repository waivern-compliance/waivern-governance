import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import { organisations, users } from './tenancy';

/**
 * A request for a trial: an address, and the single-use link sent to it.
 *
 * Belongs to no organisation, as a request for one does not: until the link
 * is used there is nothing to belong to. No organisation's work may read
 * these; sign-up reads them as the owner (row-level security on, no policy).
 *
 * The token is stored only as its SHA-256. The visitor's address is kept as
 * an HMAC, for rate limiting alone, as the public request forms keep theirs.
 * `canonicalEmail` is the address with the parts that do not change the
 * mailbox taken off (`+tags`, and dots for Gmail), so one mailbox cannot ask
 * for one trial after another under different spellings.
 */
export const trialSignups = pgTable(
  'trial_signup',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    canonicalEmail: text('canonical_email').notNull(),
    tokenHash: text('token_hash').notNull(),
    ipHash: text('ip_hash').notNull(),
    /** The organisation they said they are from, if they said. Never checked. */
    organisationName: text('organisation_name'),
    /**
     * When they accepted that the trial is for fictional data only. The form
     * cannot be sent without it, so every row has one.
     */
    fictionalDataAcceptedAt: timestamp('fictional_data_accepted_at', {
      withTimezone: true
    }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('trial_signup_token_key').on(t.tokenHash),
    index('trial_signup_email_idx').on(t.canonicalEmail, t.createdAt),
    index('trial_signup_ip_idx').on(t.ipHash, t.createdAt)
  ]
);

/**
 * `active` until an administrator converts it to a full account. A trial past
 * `ends_at` is still `active` here: it has ended because the time has passed,
 * which is read from the clock, not written by a job that might not have run.
 * `purged` once its records have been deleted after it ended.
 */
export type TrialStatus = 'active' | 'converted' | 'purged';

/**
 * An organisation that is a trial, and until when.
 *
 * One per organisation and one per canonical address, ever: a second sign-up
 * from the same mailbox signs back in to the first trial rather than starting
 * another. Only a platform administrator moves `ends_at` or the status.
 */
export const trials = pgTable(
  'trial',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    canonicalEmail: text('canonical_email').notNull(),
    /** Their own organisation, as given at sign-up, for the administrators. */
    organisationName: text('organisation_name'),
    /** When they accepted that the trial is for fictional data only. */
    fictionalDataAcceptedAt: timestamp('fictional_data_accepted_at', {
      withTimezone: true
    }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').$type<TrialStatus>().notNull().default('active'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true })
  },
  (t) => [
    uniqueIndex('trial_organisation_key').on(t.organisationId),
    uniqueIndex('trial_email_key').on(t.canonicalEmail),
    uniqueIndex('trial_user_key').on(t.userId),
    index('trial_ends_idx').on(t.status, t.endsAt)
  ]
);

export type TrialRequestKind = 'extend' | 'convert';
export type TrialRequestStatus = 'pending' | 'approved' | 'declined';

/**
 * A trial's request to the platform administrators: more time, or a full
 * account. Only their decision changes the trial; the person asking cannot.
 */
export const trialRequests = pgTable(
  'trial_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    trialId: uuid('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TrialRequestKind>().notNull(),
    /** Who they are and what they want it for, in their words. */
    organisationName: text('organisation_name').notNull(),
    message: text('message').notNull(),
    status: text('status')
      .$type<TrialRequestStatus>()
      .notNull()
      .default('pending'),
    /** Days added, when an extension was approved. */
    extendedDays: integer('extended_days'),
    decidedByEmail: text('decided_by_email'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('trial_request_one_pending_key')
      .on(t.organisationId)
      .where(sql`${t.status} = 'pending'`),
    index('trial_request_status_idx').on(t.status, t.createdAt)
  ]
);
