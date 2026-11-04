import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Feedback on the product, for Waivern's operators (`lib/feedback.ts`).
 *
 * Belongs to no organisation and names nobody: no user id, no organisation id.
 * The email address is there only where the person agreed to a follow-up.
 * Row level security is on with no policy, so no organisation's work can read
 * it; the platform reads it as the owner, as it does requests for new
 * organisations.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    message: text('message').notNull(),
    /** The page's route with record ids replaced by [id]. */
    place: text('place').notNull(),
    placeLabel: text('place_label').notNull(),
    contactEmail: text('contact_email'),
    /** When an operator marked it dealt with. */
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [index('feedback_created_idx').on(t.createdAt)]
);
