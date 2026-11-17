/**
 * The supplier review cycle: how often a supplier is reviewed, by tier, and
 * what a review concludes.
 *
 * A review is a due diligence assessment (`lib/templates/library/
 * supplier-due-diligence.ts`) at the depth its tier needs. When it is
 * approved, its recommendation becomes the supplier's review outcome and the
 * next review is dated from that approval by the tier's cycle. Critical and
 * high suppliers come round yearly by default, medium every two years and low
 * every three; the organisation may set its own.
 */

import { addMonths } from '@/lib/dates';

import { SUPPLIER_TIERS, type SupplierTier } from './tier';

export type ReviewMonths = Record<SupplierTier, number>;

export const DEFAULT_REVIEW_MONTHS: ReviewMonths = {
  critical: 12,
  high: 12,
  medium: 24,
  low: 36
};

/** Ten years: beyond that a cycle is not a cycle. */
export const MAX_REVIEW_MONTHS = 120;

export const REVIEW_OUTCOMES = [
  'approved',
  'approved_with_conditions',
  'exit'
] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  exit: 'Exit'
};

export function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return (REVIEW_OUTCOMES as readonly unknown[]).includes(value);
}

/** The outcome a due diligence recommendation amounts to, or null for none. */
export function outcomeOf(recommendation: unknown): ReviewOutcome | null {
  switch (recommendation) {
    case 'proceed':
      return 'approved';
    case 'proceed_with_conditions':
      return 'approved_with_conditions';
    case 'do_not_proceed':
      return 'exit';
    default:
      return null;
  }
}

/**
 * A cycle as stored, read defensively: anything missing or out of range
 * falls back to the default for that tier rather than leaving a supplier
 * with no next review.
 */
export function reviewMonthsFrom(stored: unknown): ReviewMonths {
  const given =
    stored && typeof stored === 'object'
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    SUPPLIER_TIERS.map((t) => {
      const v = given[t];
      return [
        t,
        Number.isInteger(v) &&
        (v as number) >= 1 &&
        (v as number) <= MAX_REVIEW_MONTHS
          ? (v as number)
          : DEFAULT_REVIEW_MONTHS[t]
      ];
    })
  ) as ReviewMonths;
}

/**
 * When a supplier is next due. From its last review by its tier's cycle;
 * never reviewed, it is due from when it was first tiered (`firstDue`), so a
 * newly tiered supplier is reviewed rather than waiting a whole cycle first.
 * A supplier with no tier has no cycle.
 */
export function nextReviewAt(
  supplier: { tier: SupplierTier | null; lastReviewedAt: Date | null },
  months: ReviewMonths,
  firstDue: Date | null
): Date | null {
  if (!supplier.tier) return null;
  if (supplier.lastReviewedAt)
    return addMonths(supplier.lastReviewedAt, months[supplier.tier]);
  return firstDue;
}

export type ReviewState = 'overdue' | 'due_soon' | 'scheduled' | 'none';

/** Due within this many days counts as coming up, as on the recurring reviews page. */
export const REVIEW_SOON_DAYS = 60;

export function reviewState(next: Date | null, now = new Date()): ReviewState {
  if (!next) return 'none';
  const days = (next.getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return 'overdue';
  if (days <= REVIEW_SOON_DAYS) return 'due_soon';
  return 'scheduled';
}
