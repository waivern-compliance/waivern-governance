'use client';

import type { ReactNode } from 'react';

import { raiseRisk } from '@/app/app/risks/actions';
import type { EditResult } from '@/lib/edit-result';
import { useRefusableAction } from '@/lib/use-refusable-action';

import { DiscardDraftButton } from './DiscardDraftButton';

/**
 * The form around `RaiseRiskForm`'s fields: Raise, Discard and any refusal.
 *
 * Raise is disabled while it is pending because a raised risk is audited and
 * never deleted, so a second press would leave a duplicate that can only be
 * closed. A refusal keeps what was typed and says why.
 */
export function RaiseRiskShell({ children }: { children: ReactNode }) {
  const { result, pending, formProps } = useRefusableAction<EditResult>(
    raiseRisk,
    { resetOnSuccess: false }
  );
  return (
    <form
      {...formProps}
      aria-busy={pending}
      className="space-y-3 border-t border-line p-4"
    >
      {children}
      <p className="text-xs text-ink-soft">
        Nothing is saved until you press Raise. Raising puts the risk on the
        register with its history, and it stays there: if it turns out not to be
        a risk, close it with a reason.
      </p>
      {result && !result.ok ? (
        <p
          role="alert"
          className="text-sm text-red-800"
        >
          {result.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
        >
          {pending ? 'Raising…' : 'Raise'}
        </button>
        <DiscardDraftButton />
      </div>
    </form>
  );
}
