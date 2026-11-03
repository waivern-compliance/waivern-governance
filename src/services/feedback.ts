import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { feedback } from "@/db/schema";
import { cleanFeedback } from "@/lib/feedback";

/**
 * Feedback on the product (`lib/feedback.ts`), kept outside every
 * organisation and read by Waivern's operators.
 *
 * Nothing here is written to an organisation's audit log: an event there
 * would name who gave feedback, which is exactly what anonymous feedback must
 * not do, and the feedback is not the organisation's record anyway.
 */

/**
 * Keep one piece of feedback. `email` is the signed-in person's own address;
 * it is kept only when `shareEmail` is true.
 */
export async function submitFeedback(input: { message: unknown; pathname: unknown; shareEmail: boolean; email: string | null }) {
  const clean = cleanFeedback(input);
  const [row] = await db.insert(feedback).values(clean).returning({
    id: feedback.id,
    message: feedback.message,
    placeLabel: feedback.placeLabel,
    contactEmail: feedback.contactEmail,
  });
  return row;
}

/** For Waivern's operators: newest first. */
export async function feedbackInbox(limit = 200) {
  return db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(limit);
}

/** For Waivern's operators: mark it dealt with, or open again. */
export async function markFeedbackHandled(id: string, handled: boolean) {
  await db.update(feedback).set({ handledAt: handled ? new Date() : null }).where(eq(feedback.id, id));
}

/** For Waivern's operators: delete it, including any email address it holds. */
export async function deleteFeedback(id: string) {
  await db.delete(feedback).where(eq(feedback.id, id));
}
