'use client';

import { useEffect, useState } from 'react';

import { DraftEditor } from './DraftEditor';

/**
 * A template's draft: the saved one, or a new one not saved yet.
 *
 * Starting a draft opens the editor on a copy in the browser only. The first
 * Save draft creates the version and its audit event; Discard before then
 * leaves nothing behind, because a saved draft is audited and can only be
 * abandoned, never removed.
 *
 * One editor serves both states, so the first save's result - the problems
 * still to settle - is still shown when the page comes back with the draft
 * saved.
 */
export function DraftWorkspace({
  templateId,
  draft,
  basis
}: {
  templateId: string;
  /** The saved draft, when there is one. */
  draft: { id: string; definition: unknown } | null;
  /** What a new draft copies; undefined when there is nothing to copy. */
  basis: unknown;
}) {
  const [started, setStarted] = useState(false);
  const [edited, setEdited] = useState(false);
  const unsaved = !draft && started;

  // An unsaved draft lives only in this page, so leaving it loses the work.
  // The browser's own prompt covers reloading and closing; a saved draft
  // needs no warning.
  useEffect(() => {
    if (!unsaved || !edited) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, edited]);

  if (draft || started) {
    return (
      <div
        className="space-y-2"
        onInput={unsaved ? () => setEdited(true) : undefined}
      >
        {unsaved ? (
          <p className="max-w-prose text-xs text-ink-soft">
            A new draft, not saved yet. Nothing is recorded until you save it;
            Discard throws it away.
          </p>
        ) : null}
        <DraftEditor
          templateId={templateId}
          versionId={draft?.id ?? null}
          definition={draft ? draft.definition : basis}
          onDiscard={
            unsaved
              ? () => {
                  setStarted(false);
                  setEdited(false);
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (basis === undefined) {
    return (
      <p className="max-w-prose text-xs text-ink-soft">
        This template has no version to start a draft from.
      </p>
    );
  }

  return (
    <>
      <p className="max-w-prose text-xs text-ink-soft">
        There is no draft. Starting one copies the published version, so you
        edit a copy rather than what assessments are running against.
      </p>
      <button
        type="button"
        onClick={() => setStarted(true)}
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Start a new draft
      </button>
    </>
  );
}
