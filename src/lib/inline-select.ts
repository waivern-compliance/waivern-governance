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
