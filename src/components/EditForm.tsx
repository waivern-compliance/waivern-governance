'use client';

import { useState, type ReactNode } from 'react';

import type { EditResult } from '@/lib/edit-result';
import { useRefusableAction } from '@/lib/use-refusable-action';

/**
 * A form that edits something already saved.
 *
 * Submitted through `useRefusableAction`, so React never resets it: a refused
 * save leaves every field as the person typed it, with the reason beside the
 * button, and they correct it rather than start again.
 *
 * `saved`, where the fields are prefilled, is the `savedKey` of the values
 * they default to. The form element is keyed on it, so it is rebuilt from what the server stored,
 * normalisation included. Only the form element is rebuilt: the result lives
 * here, above it. Callers used to key the whole `EditForm`, and the save that
 * changed the key took its own result with it, so nothing said it had been
 * kept.
 *
 * A save is confirmed through a live region that screen readers announce. The
 * confirmation stays until a field is changed again, because a message that
 * vanishes on a timer is one some people never get to read.
 *
 * The children are the fields and the submit button, rendered by the page.
 */
export function EditForm({
  action,
  saved,
  className,
  children
}: {
  action: (previous: EditResult, formData: FormData) => Promise<EditResult>;
  saved?: string;
  className?: string;
  children: ReactNode;
}) {
  const { result, pending, formProps } = useRefusableAction<EditResult>(
    action,
    {
      resetOnSuccess: false
    }
  );
  // A confirmation a later edit has made out of date, so it is no longer
  // shown. A refusal stays while the field it names is corrected.
  const [spent, setSpent] = useState<EditResult>(null);
  const confirmed = result?.ok && result !== spent ? result : null;

  return (
    <form
      key={saved}
      {...formProps}
      aria-busy={pending}
      onInput={() => setSpent(result)}
      className={className}
    >
      {children}
      {/* Always rendered: a live region added with its message is often not announced. */}
      <p
        role="status"
        className="basis-full text-sm text-emerald-800 empty:hidden sm:col-span-full"
      >
        {pending ? (
          <span className="text-ink-soft">Saving</span>
        ) : confirmed ? (
          <>
            <span
              aria-hidden
              className="mr-1"
            >
              ✓
            </span>
            {confirmed.message}
          </>
        ) : null}
      </p>
      {!pending && result && !result.ok ? (
        <p
          role="alert"
          className="basis-full text-sm text-red-800 sm:col-span-full"
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
