import Link from 'next/link';

import {
  OUTCOME_LABEL,
  reviewState,
  type ReviewOutcome
} from '@/lib/thirdparty/review';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Where a supplier stands in its review cycle: the last outcome, and when it is next due. */
export function SupplierReview({
  tier,
  nextReviewAt,
  lastReviewedAt,
  outcome,
  conditions,
  assessmentId
}: {
  tier: string | null;
  nextReviewAt: Date | null;
  lastReviewedAt: Date | null;
  outcome: ReviewOutcome | null;
  conditions: string | null;
  assessmentId: string | null;
}) {
  const state = reviewState(nextReviewAt);
  return (
    <div className="space-y-1 rounded border border-line bg-surface px-4 py-3 text-sm">
      {outcome && lastReviewedAt ? (
        <p>
          <span
            className={`font-medium ${outcome === 'exit' ? 'text-red-800' : ''}`}
          >
            {OUTCOME_LABEL[outcome]}
          </span>{' '}
          on {day(lastReviewedAt)}
          {assessmentId ? (
            <>
              {' '}
              ·{' '}
              <Link
                href={`/app/assessments/${assessmentId}`}
                className="text-brand hover:underline"
              >
                the review
              </Link>
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-ink-soft">Not reviewed yet.</p>
      )}
      {conditions ? (
        <p className="text-xs text-ink-soft">Conditions: {conditions}</p>
      ) : null}
      <p
        className={`text-xs ${
          state === 'overdue'
            ? 'text-red-800'
            : state === 'due_soon'
              ? 'text-amber-900'
              : 'text-ink-soft'
        }`}
      >
        {outcome === 'exit'
          ? 'No further review: the outcome was to exit.'
          : nextReviewAt
            ? `${state === 'overdue' ? 'Review overdue since' : 'Next review'} ${day(nextReviewAt)}`
            : tier
              ? 'No review date.'
              : 'Set a tier to start its review cycle.'}
      </p>
    </div>
  );
}
