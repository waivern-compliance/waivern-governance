import { EditForm } from '@/components/EditForm';
import { inputClass } from '@/components/form-classes';
import type { EditResult } from '@/lib/edit-result';
import {
  RETIRE_REASON_WORDS,
  RETIRE_REASONS,
  type RetireReason
} from '@/lib/retirement';

type Action = (previous: EditResult, formData: FormData) => Promise<EditResult>;

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Retiring a record and restoring it, the same on every register
 * (`lib/retirement.ts`).
 *
 * A record on the register offers to retire it, tucked away below the
 * record, because it is the rarer act. A retired record says so at the top,
 * with who retired it, when and why, and offers to restore it. Nothing here
 * deletes: the record and its history are kept either way.
 */
export function RetireRecord({
  what,
  retired,
  retire,
  restore,
  mayEdit
}: {
  /** The record, in words: "processing activity", "supplier". */
  what: string;
  retired: {
    at: Date | null;
    by: string | null;
    reason: RetireReason | null;
    note: string | null;
  };
  retire: Action;
  restore: Action;
  mayEdit: boolean;
}) {
  if (retired.at) {
    return (
      <section
        aria-label={`Retired ${what}`}
        className="space-y-2 rounded border border-amber-700 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        <p>
          <span className="font-medium">Retired {day(retired.at)}</span>
          {retired.by ? ` by ${retired.by}` : ''}
          {retired.reason ? ` · ${RETIRE_REASON_WORDS[retired.reason]}` : ''}
          {retired.note ? `: ${retired.note}` : ''}
        </p>
        <p className="text-xs">
          It is kept as it was, with its links and its history, and no longer
          counts on the register. {mayEdit ? 'Restore it to change it.' : null}
        </p>
        {mayEdit ? (
          <EditForm action={restore}>
            <button
              type="submit"
              className="rounded border border-amber-800 bg-surface px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-brand"
            >
              Restore the {what}
            </button>
          </EditForm>
        ) : null}
      </section>
    );
  }

  if (!mayEdit) return null;
  return (
    <details className="rounded border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
        Retire the {what}
      </summary>
      <EditForm
        action={retire}
        className="space-y-3 border-t border-line p-5"
      >
        <p className="max-w-prose text-xs text-ink-soft">
          Takes it off the register. It is kept as it was, read-only, with its
          links and its history, and can be restored. Nothing is deleted.
        </p>
        <label className="block space-y-1">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
            Why
          </span>
          <select
            name="reason"
            required
            defaultValue=""
            className={inputClass}
          >
            <option
              value=""
              disabled
            >
              Choose a reason
            </option>
            {RETIRE_REASONS.map((r) => (
              <option
                key={r}
                value={r}
              >
                {RETIRE_REASON_WORDS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
            Note{' '}
            <span className="font-normal normal-case tracking-normal">
              which record it was merged into, or anything else worth keeping
            </span>
          </span>
          <input
            name="note"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          className="rounded border border-red-800 px-4 py-2 text-sm text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-brand"
        >
          Retire the {what}
        </button>
      </EditForm>
    </details>
  );
}
