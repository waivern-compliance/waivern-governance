'use client';

import { discardDraft } from '@/lib/discard-draft';

/**
 * Discard a form that has not been submitted.
 *
 * Only for a form whose submit is the first and only write: nothing exists yet,
 * so there is nothing to retire. Once submitted, a record is audited and stays.
 */
export function DiscardDraftButton() {
  return (
    <button
      type="button"
      onClick={(e) => discardDraft(e.currentTarget)}
      className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      Discard
    </button>
  );
}
