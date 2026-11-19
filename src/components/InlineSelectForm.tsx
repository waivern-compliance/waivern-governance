'use client';

import { useId, useState, type ReactNode } from 'react';

import {
  describeInlineSelect,
  type InlineSelectResult
} from '@/lib/inline-select';
import { useRefusableAction } from '@/lib/use-refusable-action';

export type InlineSelectOption = { value: string; label: string };

const LOOK = {
  compact: {
    form: 'flex flex-wrap items-center gap-2 text-xs',
    label: 'flex flex-wrap items-center gap-1.5 text-ink-soft',
    caption: '',
    select:
      'rounded border border-line bg-ground px-2 py-1 text-xs text-ink focus-visible:outline-2 focus-visible:outline-brand',
    button: 'px-2 py-1 text-xs'
  },
  field: {
    form: 'flex flex-wrap items-end gap-2',
    label: 'block space-y-1',
    caption: 'block text-xs font-medium uppercase tracking-wider text-ink-soft',
    select:
      'rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand',
    button: 'px-4 py-2 text-sm'
  }
} as const;

/**
 * One saved choice, a select and its own button: a role, a tier, a law.
 *
 * Built for the place a plain `EditForm` left people guessing. Keyed on the
 * saved value, that form was rebuilt by the very save it made, so the result
 * went with it and nothing said the change had been kept. This one is not
 * rebuilt: it follows the saved value itself, and so it can say what happened.
 *
 * - The button does nothing until the choice differs from what is saved.
 * - While the action runs the button says so and cannot be pressed twice.
 * - A save is confirmed beside the button, through a live region that screen
 *   readers announce, without reloading the page or moving focus. It stays
 *   until the choice is changed again - a message that vanishes on a timer is
 *   one some people never get to read.
 * - A refusal is shown as an alert and the choice is kept, as `EditForm` does,
 *   so it can be retried or put back.
 *
 * The action is any edit action that reports through `refusable()`, or
 * returns its own `{ ok, message }`: a saved message other than the generic
 * "Saved." is shown as written, for saves whose consequence needs saying.
 */
export function InlineSelectForm({
  action,
  name,
  label,
  value,
  options,
  submitLabel = 'Save',
  look = 'field',
  className
}: {
  action: (
    previous: InlineSelectResult,
    formData: FormData
  ) => Promise<InlineSelectResult>;
  name: string;
  label: ReactNode;
  /** The saved value; the empty string for "not set". */
  value: string;
  options: readonly InlineSelectOption[];
  submitLabel?: string;
  look?: keyof typeof LOOK;
  className?: string;
}) {
  const { result, pending, formProps } = useRefusableAction<InlineSelectResult>(
    action,
    { resetOnSuccess: false }
  );
  const [selected, setSelected] = useState(value);
  const [saved, setSaved] = useState(value);
  // The result the person has moved on from by changing the choice again.
  const [spent, setSpent] = useState<InlineSelectResult>(null);
  const statusId = useId();

  // The saved value changes when this save lands, and when somebody else's
  // does and the page is re-rendered. Either way the select shows what is now
  // saved; a choice still being made here is not overwritten mid-save.
  if (value !== saved && !pending) {
    setSaved(value);
    setSelected(value);
  }

  const current = result === spent ? null : result;
  const { state, mayDispatch } = describeInlineSelect({
    saved: value,
    selected,
    pending,
    result: current
  });
  const styles = LOOK[look];

  return (
    <form
      {...formProps}
      aria-busy={pending}
      className={`${styles.form} ${className ?? ''}`}
    >
      <label className={styles.label}>
        <span className={styles.caption}>{label}</span>
        <select
          name={name}
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setSpent(result);
          }}
          aria-describedby={statusId}
          className={styles.select}
        >
          {options.map((o) => (
            <option
              key={o.value}
              value={o.value}
            >
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={!mayDispatch}
        className={`inline-flex items-center gap-1.5 rounded border font-medium focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed ${styles.button} ${
          state === 'changed' || (state === 'refused' && mayDispatch)
            ? 'border-brand bg-brand text-white hover:opacity-90'
            : 'border-line bg-surface text-ink-soft'
        }`}
      >
        {pending ? (
          <span
            aria-hidden
            className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
        ) : null}
        {pending ? 'Saving' : submitLabel}
      </button>
      {/* Always rendered: a live region added with its message is often not announced. */}
      <span
        id={statusId}
        role="status"
        className="text-xs text-emerald-800"
      >
        {state === 'saved' && current ? (
          <>
            <span
              aria-hidden
              className="mr-1"
            >
              ✓
            </span>
            {current.message}
          </>
        ) : null}
      </span>
      {state === 'refused' && current ? (
        <p
          role="alert"
          className="basis-full text-xs text-red-800"
        >
          {current.message}
        </p>
      ) : null}
    </form>
  );
}
