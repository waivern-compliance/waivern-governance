/**
 * Retiring a record: taking it off the working register without losing it.
 *
 * Govern never deletes a record a person made: the audit chain is a permanent
 * account of what the organisation recorded and decided, and a record that
 * vanished would leave events pointing at nothing. A record that is no longer
 * true is retired instead. It is kept as it was, readable and exported, with
 * who retired it, when and why, and it can be restored.
 */
export const RETIRE_REASONS = [
  'no_longer_used',
  'merged',
  'recorded_in_error'
] as const;

export type RetireReason = (typeof RETIRE_REASONS)[number];

export const RETIRE_REASON_WORDS: Record<RetireReason, string> = {
  no_longer_used: 'No longer carried on',
  merged: 'Merged into another record',
  recorded_in_error: 'Recorded in error'
};

export class RetireRefused extends Error {}

export function isRetireReason(value: unknown): value is RetireReason {
  return (
    typeof value === 'string' &&
    (RETIRE_REASONS as readonly string[]).includes(value)
  );
}

/**
 * The reason and note as kept. A merge must say where the record went, or the
 * register loses the thread from the old record to the one that replaced it.
 */
export function cleanRetirement(input: { reason: unknown; note: unknown }): {
  reason: RetireReason;
  note: string | null;
} {
  if (!isRetireReason(input.reason))
    throw new RetireRefused('Say why it is being retired.');
  const note =
    typeof input.note === 'string' && input.note.trim()
      ? input.note.trim()
      : null;
  if (input.reason === 'merged' && !note)
    throw new RetireRefused('Say which record it was merged into.');
  return { reason: input.reason, note };
}
