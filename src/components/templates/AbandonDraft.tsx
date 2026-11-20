'use client';

import { abandonDraftAction } from '@/app/app/templates/actions';
import type { EditResult } from '@/lib/edit-result';
import { useRefusableAction } from '@/lib/use-refusable-action';

/**
 * Set a saved draft aside. It has been audited, so it is kept and marked
 * abandoned with the reason, not deleted.
 */
export function AbandonDraft({
  templateId,
  versionId,
  version
}: {
  templateId: string;
  versionId: string;
  version: number;
}) {
  const { result, pending, formProps } = useRefusableAction<EditResult>(
    abandonDraftAction.bind(null, templateId, versionId),
    { resetOnSuccess: false }
  );

  return (
    <details className="rounded border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm">
        Abandon this draft
      </summary>
      <form
        {...formProps}
        aria-busy={pending}
        className="space-y-3 border-t border-line p-4"
      >
        <p className="max-w-prose text-xs text-ink-soft">
          Version {version} has been saved, so it is part of the audit trail and
          cannot be deleted. Abandoning keeps it as it is, marked abandoned with
          your reason, and lets anyone start a new draft. The next draft is
          version {version + 1}.
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-soft">
            Why is it being abandoned?
          </span>
          <textarea
            name="reason"
            required
            rows={2}
            className="w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>
        {result && !result.ok ? (
          <p
            role="alert"
            className="text-sm text-red-800"
          >
            {result.message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {pending ? 'Abandoning…' : `Abandon version ${version}`}
        </button>
      </form>
    </details>
  );
}
