import { eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { users } from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { isTourOutcome, type TourOutcome } from '@/lib/tour/steps';

/** Somebody's answer to the guided tour, if they have given one. */
export async function tourStateFor(userId: string): Promise<{
  outcome: TourOutcome | null;
  simulated: boolean;
}> {
  const [row] = await db
    .select({ outcome: users.tourOutcome, simulated: users.simulated })
    .from(users)
    .where(eq(users.id, userId));
  return { outcome: row?.outcome ?? null, simulated: row?.simulated ?? false };
}

/**
 * Remember how somebody left the tour, so it is not offered again.
 *
 * The person's own choice and nobody else's, so it needs no capability. It is
 * written in the organisation they were working in when they made it, with its
 * audit event in the same transaction; replaying the tour later records the
 * new outcome over the old one.
 */
export async function recordTourOutcome(input: {
  organisationId: string;
  userId: string;
  actorLabel: string;
  outcome: TourOutcome;
}) {
  if (!isTourOutcome(input.outcome)) throw new Error('No such tour outcome');
  await withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const [before] = await tx
        .select({ outcome: users.tourOutcome })
        .from(users)
        .where(eq(users.id, input.userId));
      if (!before) throw new Error('No such person');
      await tx
        .update(users)
        .set({ tourOutcome: input.outcome, tourOutcomeAt: new Date() })
        .where(eq(users.id, input.userId));
      await appendAuditEvent(tx, {
        organisationId: input.organisationId,
        actorKind: 'user',
        actorUserId: input.userId,
        actorLabel: input.actorLabel,
        action: `tour.${input.outcome}`,
        subjectType: 'user',
        subjectId: input.userId,
        before: { outcome: before.outcome },
        after: { outcome: input.outcome }
      });
    })
  );
}
