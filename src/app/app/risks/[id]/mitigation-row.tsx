'use client';

import type { ReactNode } from 'react';

import type { SourceEvent } from '@/lib/import/types';
import { savedKey } from '@/lib/saved-key';
import { useRefusableAction } from '@/lib/use-refusable-action';

import { mitigationStatusAction } from './actions';

const STATUSES = [
  'planned',
  'in_progress',
  'implemented',
  'verified',
  'abandoned'
] as const;

export function MitigationRow({
  riskId,
  mitigation,
  imported,
  editable
}: {
  riskId: string;
  mitigation: {
    id: string;
    description: string;
    controlRef: string | null;
    /** Already worded — "Limit", "Avoid" — or null where it was never recorded. */
    treatment: string | null;
    status: string;
    dueAt: string | null;
    evidenceRef: string | null;
    verifiedAt: string | null;
    /** Where the suggestion it started from came from — "from DSIT toolkit" — where it did. */
    fromSource: string | null;
    ownedByViewer: boolean;
  };
  /** Where it came from, if imported, and what that platform recorded of it. */
  imported?: {
    sourceName: string;
    confirmed: boolean;
    history: SourceEvent[] | null;
    legacy: Record<string, string> | null;
    /** The confirm control, where this person may confirm it. */
    confirm: ReactNode;
  } | null;
  editable: boolean;
}) {
  // Through a transition, so a refused update keeps the evidence reference typed.
  const { result, pending, formProps } = useRefusableAction<
    { ok: true } | { ok: false; message: string } | null
  >(
    (_previous, formData) =>
      mitigationStatusAction(riskId, mitigation.id, formData),
    {
      resetOnSuccess: false
    }
  );
  const error = result && !result.ok ? result.message : null;

  return (
    <li
      id={mitigation.id}
      className="space-y-2 px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{mitigation.description}</span>
        <span className="font-mono text-[11px] text-ink-soft">
          {mitigation.treatment ? `${mitigation.treatment} · ` : ''}
          {mitigation.controlRef ? `${mitigation.controlRef} · ` : ''}
          {mitigation.dueAt ? `due ${mitigation.dueAt}` : 'no date'}
          {mitigation.verifiedAt ? ` · verified ${mitigation.verifiedAt}` : ''}
          {mitigation.fromSource ? ` · ${mitigation.fromSource}` : ''}
        </span>
      </div>

      {imported ? (
        <div
          className={`space-y-1 rounded border-l-2 px-3 py-2 text-xs ${
            imported.confirmed
              ? 'border-line text-ink-soft'
              : 'border-amber-700 bg-amber-50 text-amber-950'
          }`}
        >
          <p className="font-medium">
            {imported.confirmed
              ? `Imported from ${imported.sourceName}`
              : `Imported from ${imported.sourceName}, not yet confirmed. Its due date reminds nobody until it is.`}
          </p>
          {imported.history?.map((e, i) => (
            <p key={i}>
              {e.what}
              {e.by ? ` by ${e.by}` : ''}
              {e.at ? ` on ${e.at.slice(0, 10)}` : ''}
              {e.detail ? `. ${e.detail}` : ''}. As {imported.sourceName}{' '}
              recorded it; not done here.
            </p>
          ))}
          {Object.entries(imported.legacy ?? {}).map(([k, v]) => (
            <p key={k}>
              <span className="font-medium">{k}:</span> {v}
            </p>
          ))}
          {imported.confirmed ? null : imported.confirm}
        </div>
      ) : null}

      {editable ? (
        <form
          key={savedKey(mitigation.status, mitigation.evidenceRef)}
          {...formProps}
          className="flex flex-wrap items-center gap-2"
        >
          <select
            name="status"
            defaultValue={mitigation.status}
            className="rounded border border-line bg-ground px-2 py-1 font-mono text-xs"
          >
            {STATUSES.map((s) => (
              <option
                key={s}
                value={s}
                // Verification is a second pair of eyes. Offering it to the
                // owner of the mitigation invites a refusal they cannot act on.
                disabled={s === 'verified' && mitigation.ownedByViewer}
              >
                {s.replace(/_/g, ' ')}
                {s === 'verified' && mitigation.ownedByViewer
                  ? ' (not by its owner)'
                  : ''}
              </option>
            ))}
          </select>
          <input
            name="evidenceRef"
            defaultValue={mitigation.evidenceRef ?? ''}
            placeholder="Evidence reference"
            className="w-48 rounded border border-line bg-ground px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-line bg-surface px-2.5 py-1 text-xs disabled:opacity-40 hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
          >
            Update
          </button>
        </form>
      ) : (
        <p className="font-mono text-xs text-ink-soft">
          {mitigation.status.replace(/_/g, ' ')}
        </p>
      )}

      {error ? (
        <p
          role="alert"
          className="text-xs text-red-800"
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}
