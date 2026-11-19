/**
 * Where a one-choice edit stands: a select beside its own save button.
 *
 * Kept apart from the component so the rules can be tested without a browser:
 * a save is offered only once the choice differs from what is saved, a result
 * stops applying the moment the choice is changed again, and a refusal keeps
 * the choice so it can be retried as it is.
 */
export type InlineSelectState =
  'unchanged' | 'changed' | 'saving' | 'saved' | 'refused';

export type InlineSelectResult = { ok: boolean; message: string } | null;

export function describeInlineSelect({
  saved,
  selected,
  pending,
  result
}: {
  /** The value as the server last rendered it. */
  saved: string;
  /** The value shown in the select now. */
  selected: string;
  pending: boolean;
  /** The last save's result, or null once the choice has changed since. */
  result: InlineSelectResult;
}): { state: InlineSelectState; mayDispatch: boolean } {
  const differs = selected !== saved;
  const mayDispatch = differs && !pending;
  if (pending) return { state: 'saving', mayDispatch };
  if (result && !result.ok) return { state: 'refused', mayDispatch };
  if (differs) return { state: 'changed', mayDispatch };
  if (result?.ok) return { state: 'saved', mayDispatch };
  return { state: 'unchanged', mayDispatch };
}

/** What the form remembers between renders, besides the server's props. */
export type InlineSelectMemory = {
  /** The value shown in the select now. */
  selected: string;
  /** The saved value the form last reconciled with. */
  saved: string;
  /** The save result the form last reconciled with. */
  seen: InlineSelectResult;
  /** A result that no longer applies, because the choice or the record moved on. */
  spent: InlineSelectResult;
};

/**
 * Bring the form up to date with the server, or null when it already is.
 *
 * Runs only once a save has finished, so nothing is decided against a
 * half-finished one. A save that was kept shows what the server now holds,
 * which is not always what was chosen: an action may normalise the value, and
 * the person should see what was stored rather than a choice that looks unsaved.
 * A refused save keeps the choice so it can be retried. A saved value that
 * changes without a save of ours - somebody else's, seen on re-render - replaces
 * the choice and retires any earlier result, which described something else.
 */
export function reconcileInlineSelect(
  memory: InlineSelectMemory,
  {
    value,
    result,
    pending
  }: {
    value: string;
    result: InlineSelectResult;
    pending: boolean;
  }
): InlineSelectMemory | null {
  if (pending) return null;
  const fresh = result !== memory.seen;
  if (!fresh && value === memory.saved) return null;
  if (fresh) {
    return {
      selected: result?.ok ? value : memory.selected,
      saved: value,
      seen: result,
      spent: memory.spent
    };
  }
  return { selected: value, saved: value, seen: result, spent: result };
}
