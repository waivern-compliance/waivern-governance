import { EditForm } from '@/components/EditForm';
import { savedKey } from '@/lib/saved-key';
import {
  DEFAULT_REVIEW_MONTHS,
  MAX_REVIEW_MONTHS,
  type ReviewMonths
} from '@/lib/thirdparty/review';
import { SUPPLIER_TIERS, TIER_LABEL } from '@/lib/thirdparty/tier';

import { setSupplierReviewCycleAction } from '../../third-parties/actions';

/** How often suppliers are reviewed, by tier. */
export function ReviewCycleForm({ current }: { current: ReviewMonths }) {
  return (
    <EditForm
      key={savedKey(current)}
      action={setSupplierReviewCycleAction}
      className="space-y-3 rounded border border-line bg-surface p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Supplier review cycle</h2>
        <p className="max-w-prose text-sm text-ink-soft">
          Months between supplier reviews, by tier. Changing a cycle re-dates
          the next review of every supplier at that tier from its last review.
          By default: critical and high yearly, medium every two years, low
          every three.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {SUPPLIER_TIERS.map((t) => (
          <label
            key={t}
            className="block space-y-1"
          >
            <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
              {TIER_LABEL[t]}
            </span>
            <input
              name={t}
              type="number"
              min={1}
              max={MAX_REVIEW_MONTHS}
              step={1}
              required
              defaultValue={current[t]}
              className="w-24 rounded border border-line bg-ground px-3 py-2 text-sm tabular-nums"
            />
            <span className="block text-[11px] text-ink-soft">
              months (default {DEFAULT_REVIEW_MONTHS[t]})
            </span>
          </label>
        ))}
      </div>
      <button
        type="submit"
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Save the cycle
      </button>
    </EditForm>
  );
}
