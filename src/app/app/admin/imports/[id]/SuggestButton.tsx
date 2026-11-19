'use client';

import { useActionState, useTransition } from 'react';

import type { EditResult } from '@/lib/edit-result';

/**
 * Asks for a suggested matching with the matching form's own fields, so what
 * the person had chosen there goes with the request and is kept. It reads the
 * form rather than submitting it: the form's own handler would preview, and
 * would stop at the required fields that a suggestion is meant to fill.
 */
export function SuggestButton({
  formId,
  action
}: {
  formId: string;
  action: (prev: EditResult, formData: FormData) => Promise<EditResult>;
}) {
  const [result, dispatch, acting] = useActionState(action, null);
  const [transitioning, startTransition] = useTransition();
  const pending = acting || transitioning;
  const ask = () => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    startTransition(() => dispatch(data));
  };
  return (
    <div className="space-y-2">
      {result ? (
        <p
          role="alert"
          className={`rounded border px-4 py-2.5 text-sm ${
            result.ok
              ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
              : 'border-amber-700 bg-amber-50 text-amber-900'
          }`}
        >
          {result.message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={ask}
        disabled={pending}
        className="rounded border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {pending ? 'Asking the model…' : 'Suggest a matching'}
      </button>
    </div>
  );
}
