'use client';

import { useState } from 'react';

import { DraftEditor } from './DraftEditor';

/**
 * Start a new draft without saving anything yet.
 *
 * Starting opens the editor on a copy of the current version, in the browser
 * only. The first Save draft creates the version and its audit event; Discard
 * before then leaves nothing behind, because a saved draft is audited and can
 * only be abandoned, never removed.
 */
export function NewDraft({
  templateId,
  definition
}: {
  templateId: string;
  /** What the draft starts from: the published version, normally. */
  definition: unknown;
}) {
  const [started, setStarted] = useState(false);

  if (started) {
    return (
      <div className="space-y-2">
        <p className="max-w-prose text-xs text-ink-soft">
          A new draft, not saved yet. Nothing is recorded until you save it;
          Discard throws it away.
        </p>
        <DraftEditor
          templateId={templateId}
          versionId={null}
          definition={definition}
          onDiscard={() => setStarted(false)}
        />
      </div>
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
