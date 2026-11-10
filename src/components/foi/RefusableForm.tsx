'use client';

import type { ReactNode } from 'react';

import { useRefusableAction } from '@/lib/use-refusable-action';

type Result = { ok: boolean; message: string } | null;

/**
 * A form that does one thing to a freedom of information request and says
 * whether it worked. A refusal keeps every field as it was typed; a form that
 * adds something is cleared once it succeeds, one that edits in place is not.
 */
export function RefusableForm({
  action,
  submit,
  pendingLabel,
  className,
  resetOnSuccess = true,
  children
}: {
  action: (prev: Result, formData: FormData) => Promise<Result>;
  submit: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  children: ReactNode;
}) {
  const { result, pending, formProps } = useRefusableAction<Result>(action, {
    resetOnSuccess
  });
  return (
    <form
      {...formProps}
      className={
        className ?? 'space-y-3 rounded border border-line bg-surface p-5'
      }
    >
      {children}
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
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {pending ? (pendingLabel ?? 'Saving…') : submit}
      </button>
    </form>
  );
}
