'use client';

import { useRefusableAction } from '@/lib/use-refusable-action';

import { sendTestEmailAction, type DecisionResult } from './actions';

/** Send one test email to the platform administrators and show what happened. */
export function TestEmail() {
  const test = useRefusableAction<DecisionResult>(sendTestEmailAction, {
    resetOnSuccess: false
  });
  return (
    <div className="space-y-2">
      <form {...test.formProps}>
        <button
          type="submit"
          disabled={test.pending}
          className="rounded border border-line bg-surface px-3 py-1.5 text-xs hover:border-brand focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
        >
          {test.pending ? 'Sending…' : 'Send test email'}
        </button>
      </form>
      {test.result ? (
        <p
          role={test.result.ok ? 'status' : 'alert'}
          className={`text-xs ${test.result.ok ? 'text-emerald-800' : 'text-red-800'}`}
        >
          {test.result.message}
        </p>
      ) : null}
    </div>
  );
}
