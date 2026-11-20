'use client';

/**
 * Throw away what has been typed into a form that has not been submitted, and
 * fold away the disclosure it sits in.
 *
 * Only for a form whose submit is the first and only write: nothing exists yet,
 * so there is nothing to retire. Once submitted, a record is audited and stays.
 */
export function DiscardDraftButton({ label = 'Discard' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.currentTarget.form?.reset();
        e.currentTarget.closest('details')?.removeAttribute('open');
      }}
      className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {label}
    </button>
  );
}
