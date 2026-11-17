import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte
} from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  assessmentAnswers,
  assessmentRevisions,
  assessments,
  dpas,
  organisations,
  supplierContracts,
  suppliers,
  templateVersions,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { addMonths } from '@/lib/dates';
import { isDueDiligenceDefinition } from '@/lib/templates/library/supplier-due-diligence';
import {
  MAX_REVIEW_MONTHS,
  nextReviewAt,
  outcomeOf,
  reviewMonthsFrom,
  reviewState,
  type ReviewMonths,
  type ReviewOutcome
} from '@/lib/thirdparty/review';
import { SUPPLIER_TIERS, TIER_LABEL } from '@/lib/thirdparty/tier';

import type { Actor } from './templates';

/**
 * The supplier review cycle. See `lib/thirdparty/review.ts`.
 *
 * A review is recorded when a due diligence assessment about a supplier is
 * approved (`recordSupplierReview`, called from the approval itself), so the
 * outcome on the register is always the one somebody signed off.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;

export class ReviewCycleRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewCycleRefused';
  }
}

async function monthsOf(reader: Reader, organisationId: string) {
  const [org] = await reader
    .select({ months: organisations.supplierReviewMonths })
    .from(organisations)
    .where(eq(organisations.id, organisationId));
  return reviewMonthsFrom(org?.months);
}

/** Months between reviews for each tier, with the defaults filled in. */
export async function supplierReviewCycle(
  organisationId: string
): Promise<ReviewMonths> {
  return withOrganisation(organisationId, () => monthsOf(db, organisationId));
}

/**
 * Set the months between reviews for each tier. Every supplier reviewed
 * before is re-dated from its last review by its tier's new cycle, and so is
 * the assessment that was its review, so the recurring reviews page agrees.
 */
export async function setSupplierReviewCycle(input: {
  organisationId: string;
  months: Record<string, number>;
  actor: Actor;
}) {
  const months = Object.fromEntries(
    SUPPLIER_TIERS.map((t) => {
      const v = input.months[t];
      if (!Number.isInteger(v) || v < 1 || v > MAX_REVIEW_MONTHS)
        throw new ReviewCycleRefused(
          `Give the ${TIER_LABEL[t].toLowerCase()} tier's cycle as a whole number of months from 1 to ${MAX_REVIEW_MONTHS}.`
        );
      return [t, v];
    })
  ) as ReviewMonths;
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await monthsOf(tx, input.organisationId);
      await tx
        .update(organisations)
        .set({ supplierReviewMonths: months, updatedAt: new Date() })
        .where(eq(organisations.id, input.organisationId));
      const reviewed = await tx
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.organisationId, input.organisationId),
            isNotNull(suppliers.tier),
            isNotNull(suppliers.lastReviewedAt)
          )
        );
      let moved = 0;
      for (const s of reviewed) {
        if (s.reviewOutcome === 'exit' || months[s.tier!] === before[s.tier!])
          continue;
        await redate(tx, s, months);
        moved += 1;
      }
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'organisation.supplier_review_cycle_set',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: { months: before },
        after: { months, suppliersRedated: moved }
      });
      return months;
    })
  );
}

/** Move a reviewed supplier's next review, and its review assessment's, to its tier's cycle. */
async function redate(
  tx: Tx,
  supplier: typeof suppliers.$inferSelect,
  months: ReviewMonths
) {
  const next = nextReviewAt(supplier, months, null);
  await tx
    .update(suppliers)
    .set({ nextReviewAt: next, updatedAt: new Date() })
    .where(eq(suppliers.id, supplier.id));
  if (supplier.reviewAssessmentId && supplier.tier)
    await tx
      .update(assessments)
      .set({
        reviewDueAt: next,
        reviewIntervalMonths: months[supplier.tier]
      })
      .where(eq(assessments.id, supplier.reviewAssessmentId));
}

/**
 * The next review once a supplier's tier is set. Reviewed, it is dated from
 * the last review by the new tier's cycle; never reviewed, its first review
 * is due from when it was first tiered. An exited supplier has none.
 */
export async function nextReviewOnTier(
  tx: Tx,
  organisationId: string,
  supplier: typeof suppliers.$inferSelect,
  tier: (typeof SUPPLIER_TIERS)[number]
): Promise<Date | null> {
  if (supplier.reviewOutcome === 'exit') return null;
  const months = await monthsOf(tx, organisationId);
  const next = nextReviewAt(
    { tier, lastReviewedAt: supplier.lastReviewedAt },
    months,
    supplier.nextReviewAt ?? new Date()
  );
  if (supplier.reviewAssessmentId && supplier.lastReviewedAt)
    await tx
      .update(assessments)
      .set({ reviewDueAt: next, reviewIntervalMonths: months[tier] })
      .where(eq(assessments.id, supplier.reviewAssessmentId));
  return next;
}

export type RecordedReview =
  | ({ current: true } & CurrentReview)
  /**
   * Approved after a review that was started later: the later one stands,
   * and this one is superseded by it as soon as it is approved.
   */
  | { current: false; supersededBy: string };

type CurrentReview = {
  outcome: ReviewOutcome;
  /** When the supplier and its review assessment are next due, or null after an exit. */
  nextReviewAt: Date | null;
  intervalMonths: number | null;
  supplier: { id: string; name: string; ownerId: string | null };
  /** For an exit: what is still in force with it, for the task to end it. */
  inForce: { contracts: number; agreements: number };
};

/**
 * Record a supplier review from an approved due diligence assessment.
 *
 * Called inside the approval's transaction, once the assessment is marked
 * approved. Returns null for anything that is not a due diligence assessment
 * about a supplier, which the approval then dates as usual. The
 * recommendation becomes the outcome; the next review is dated from this
 * approval by the supplier's tier, or by the template's own cycle where the
 * supplier has no tier yet, and the assessment is dated to match. The
 * supplier's previous review is superseded by this one, so nothing brings it
 * round again.
 *
 * Reviews can be approved out of the order they were started in. The one
 * started last is the supplier's current position, so an older review
 * approved after it is superseded at once rather than overwriting it.
 */
export async function recordSupplierReview(
  tx: Tx,
  input: {
    organisationId: string;
    assessment: typeof assessments.$inferSelect;
    approvedAt: Date;
    actor: Actor;
  }
): Promise<RecordedReview | null> {
  const a = input.assessment;
  if (a.subjectType !== 'supplier' || !a.subjectId) return null;
  const [version] = await tx
    .select({ definition: templateVersions.definition })
    .from(templateVersions)
    .where(eq(templateVersions.id, a.templateVersionId));
  if (!version || !isDueDiligenceDefinition(version.definition)) return null;

  const answers = new Map(
    (
      await tx
        .select({
          key: assessmentAnswers.questionKey,
          value: assessmentAnswers.value
        })
        .from(assessmentAnswers)
        .where(
          and(
            eq(assessmentAnswers.assessmentId, a.id),
            inArray(assessmentAnswers.questionKey, [
              'recommendation',
              'conditions'
            ])
          )
        )
    ).map((r) => [r.key, r.value])
  );
  const outcome = outcomeOf(answers.get('recommendation'));
  if (!outcome) return null;
  const conditionsAnswer = answers.get('conditions');
  const conditions =
    outcome === 'approved_with_conditions' &&
    typeof conditionsAnswer === 'string'
      ? conditionsAnswer.trim() || null
      : null;

  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, a.subjectId),
        eq(suppliers.organisationId, input.organisationId)
      )
    )
    .for('update');
  if (!supplier) return null;

  const [previous] = supplier.reviewAssessmentId
    ? await tx
        .select({
          id: assessments.id,
          reference: assessments.reference,
          createdAt: assessments.createdAt
        })
        .from(assessments)
        .where(eq(assessments.id, supplier.reviewAssessmentId))
    : [];
  if (previous && previous.id !== a.id && previous.createdAt > a.createdAt) {
    await supersede(tx, {
      organisationId: input.organisationId,
      assessmentId: a.id,
      by: previous.reference,
      actor: input.actor,
      at: input.approvedAt
    });
    return { current: false, supersededBy: previous.reference };
  }

  const months = await monthsOf(tx, input.organisationId);
  const intervalMonths =
    outcome === 'exit'
      ? null
      : supplier.tier
        ? months[supplier.tier]
        : (version.definition.reviewIntervalMonths ?? null);
  const next = intervalMonths
    ? addMonths(input.approvedAt, intervalMonths)
    : null;

  if (previous && previous.id !== a.id)
    await supersede(tx, {
      organisationId: input.organisationId,
      assessmentId: previous.id,
      by: a.reference,
      actor: input.actor,
      at: input.approvedAt
    });
  await tx
    .update(assessments)
    .set({ reviewDueAt: next, reviewIntervalMonths: intervalMonths })
    .where(eq(assessments.id, a.id));

  await tx
    .update(suppliers)
    .set({
      lastReviewedAt: input.approvedAt,
      nextReviewAt: next,
      reviewOutcome: outcome,
      reviewConditions: conditions,
      reviewAssessmentId: a.id,
      updatedAt: input.approvedAt
    })
    .where(eq(suppliers.id, supplier.id));

  await appendAuditEvent(tx, {
    ...input.actor,
    organisationId: input.organisationId,
    action: 'supplier.reviewed',
    subjectType: 'supplier',
    subjectId: supplier.id,
    before: {
      outcome: supplier.reviewOutcome,
      lastReviewedAt: supplier.lastReviewedAt,
      nextReviewAt: supplier.nextReviewAt
    },
    after: {
      outcome,
      conditions,
      assessment: a.reference,
      supersedes: supplier.reviewAssessmentId,
      tier: supplier.tier,
      nextReviewAt: next
    }
  });

  const inForce =
    outcome === 'exit'
      ? {
          contracts: (
            await tx
              .select({ id: supplierContracts.id })
              .from(supplierContracts)
              .where(
                and(
                  eq(supplierContracts.supplierId, supplier.id),
                  isNull(supplierContracts.endedAt)
                )
              )
          ).length,
          agreements: (
            await tx
              .select({ id: dpas.id })
              .from(dpas)
              .where(eq(dpas.supplierId, supplier.id))
          ).length
        }
      : { contracts: 0, agreements: 0 };

  return {
    current: true,
    outcome,
    nextReviewAt: next,
    intervalMonths,
    supplier: {
      id: supplier.id,
      name: supplier.name,
      ownerId: supplier.ownerId
    },
    inForce
  };
}

/**
 * Mark an approved review superseded, with a snapshot in its history and an
 * audit event of its own, so the assessment says why it stopped counting.
 */
async function supersede(
  tx: Tx,
  input: {
    organisationId: string;
    assessmentId: string;
    /** The reference of the review that replaces it. */
    by: string;
    actor: Actor;
    at: Date;
  }
) {
  const [row] = await tx
    .update(assessments)
    .set({ status: 'superseded', reviewDueAt: null, updatedAt: input.at })
    .where(
      and(
        eq(assessments.id, input.assessmentId),
        eq(assessments.status, 'approved')
      )
    )
    .returning({ entityId: assessments.entityId });
  if (!row) return;

  // An approved assessment was submitted first, so it has a snapshot of the
  // answers it was approved on; the supersession repeats it with its reason.
  const [latest] = await tx
    .select()
    .from(assessmentRevisions)
    .where(eq(assessmentRevisions.assessmentId, input.assessmentId))
    .orderBy(desc(assessmentRevisions.revision))
    .limit(1);
  if (latest)
    await tx.insert(assessmentRevisions).values({
      assessmentId: input.assessmentId,
      revision: latest.revision + 1,
      reason: 'superseded',
      answers: latest.answers,
      evaluation: latest.evaluation,
      score: latest.score,
      createdByUserId: input.actor.actorUserId ?? null,
      createdByLabel: input.actor.actorLabel,
      createdAt: input.at
    });

  await appendAuditEvent(tx, {
    ...input.actor,
    organisationId: input.organisationId,
    action: 'assessment.superseded',
    subjectType: 'assessment',
    subjectId: input.assessmentId,
    entityId: row.entityId,
    before: { status: 'approved' },
    after: { status: 'superseded', supersededBy: input.by }
  });
}

/** Tiered suppliers whose next review has come. For the sweep. */
export async function suppliersDueForReview(
  organisationId: string,
  now = new Date()
) {
  return withOrganisation(organisationId, () =>
    db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.organisationId, organisationId),
          isNotNull(suppliers.tier),
          lte(suppliers.nextReviewAt, now)
        )
      )
      .orderBy(asc(suppliers.nextReviewAt))
  );
}

/** Every supplier with a next review, and how near it is, for the recurring reviews page. */
export async function supplierReviewSchedule(
  organisationId: string,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        tier: suppliers.tier,
        nextReviewAt: suppliers.nextReviewAt,
        lastReviewedAt: suppliers.lastReviewedAt,
        reviewOutcome: suppliers.reviewOutcome,
        ownerEmail: users.email
      })
      .from(suppliers)
      .leftJoin(users, eq(users.id, suppliers.ownerId))
      .where(
        and(
          eq(suppliers.organisationId, organisationId),
          isNotNull(suppliers.nextReviewAt)
        )
      )
      .orderBy(asc(suppliers.nextReviewAt));
    return rows.map((r) => ({ ...r, state: reviewState(r.nextReviewAt, now) }));
  });
}
