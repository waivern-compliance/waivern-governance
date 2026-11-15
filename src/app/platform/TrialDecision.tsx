'use client';

import { useRefusableAction } from '@/lib/use-refusable-action';

import { decideTrialAction, type DecisionResult } from './actions';

/** One trial request: extend by some days, convert, or decline with a reason. */
export function TrialDecision({
  requestId,
  maxDays
}: {
  requestId: string;
  maxDays: number;
}) {
  const { result, pending, formProps } = useRefusableAction<DecisionResult>(
    decideTrialAction.bind(null, requestId),
    { resetOnSuccess: false }
  );
  return (
    <form
      {...formProps}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          name="decision"
          value="convert"
          disabled={pending}
          className="rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Convert to a full account
        </button>
        <label className="flex items-center gap-1 text-xs">
          <input
            name="days"
            type="number"
            min={1}
            max={maxDays}
            defaultValue={7}
            className="w-16 rounded border border-line bg-ground px-2 py-1.5 text-xs"
          />
          days
        </label>
        <button
          type="submit"
          name="decision"
          value="extend"
          disabled={pending}
          className="rounded border border-line bg-surface px-3 py-1.5 text-xs hover:border-brand disabled:opacity-50"
        >
          Extend
        </button>
        <input
          name="note"
          placeholder="Why not - shown to them"
          className="w-56 rounded border border-line bg-ground px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          name="decision"
          value="decline"
          disabled={pending}
          className="rounded border border-line bg-surface px-3 py-1.5 text-xs hover:border-red-700 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {result ? (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`text-xs ${result.ok ? 'text-emerald-800' : 'text-red-800'}`}
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
