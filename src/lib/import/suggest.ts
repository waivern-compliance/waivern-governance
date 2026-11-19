import { z } from 'zod';

import { extractJson } from '@/lib/assistant/parse';

import { CASE_HISTORY, FIELDS, RATINGS, type RecordType } from './fields';

/**
 * Asking the organisation's own model which column of an unfamiliar file
 * holds which field (migration plan decision 7, issue #86). Pure: what is
 * sent, and what of the reply is believed. The model sees the field list, the
 * header row and at most a few sample rows, and never writes: what it says is
 * offered on the matching step, and a person previewing is what makes it a
 * mapping.
 */

/** Bumped when the prompt changes, so a suggestion stays attributable to one. */
export const IMPORT_SUGGEST_PROMPT_VERSION = '2026-11-19.1';

/** Rows sent as examples, for every kind but case history. */
export const SAMPLE_ROWS = 3;
/** Longer cells are cut: the shape of a value tells the model enough. */
export const CELL_LIMIT = 80;

/**
 * The rows sent as examples: the first that fill most of the columns, so the
 * model sees what each holds. None for case history, whose files are mostly
 * about the people who asked, and whose names and circumstances a redactor
 * that catches shapes, not meaning, would let through (decision 1).
 */
export function sampleRows(
  recordType: RecordType,
  columns: readonly string[],
  rows: readonly (readonly string[])[]
): string[][] {
  if (CASE_HISTORY.has(recordType)) return [];
  const filled = (row: readonly string[]) =>
    row.filter((cell) => String(cell ?? '').trim() !== '').length;
  const full = rows.filter((row) => filled(row) * 2 >= columns.length);
  const chosen = (full.length ? full : rows.filter((r) => filled(r) > 0)).slice(
    0,
    SAMPLE_ROWS
  );
  return chosen.map((row) =>
    columns.map((_, i) => {
      const cell = String(row[i] ?? '').trim();
      return cell.length > CELL_LIMIT ? `${cell.slice(0, CELL_LIMIT)}…` : cell;
    })
  );
}

export const SYSTEM = `You match the columns of a spreadsheet exported from another governance platform to the fields of a record in this one.

Answer with JSON only, in this shape:
{"fields": {"<field key>": "<column name exactly as given>"}, "notes": "<optional, one or two sentences>"}

Rules:
- Use only field keys and column names you were given, spelt exactly as given.
- Give each column to one field at most.
- Leave a field out when no column clearly holds it. A gap a person fills is better than a wrong match.
- Do not judge the values themselves: say which column holds a rating or a status, never what it means.`;

/** What the model is told: the fields, the header row, and any samples. */
export function buildTurn(
  recordType: RecordType,
  columns: readonly string[],
  samples: readonly (readonly string[])[]
): string {
  const fields = FIELDS[recordType].map((f) => ({
    key: f.key,
    label: f.label,
    kind: f.kind,
    ...(f.required ? { required: true } : {}),
    ...(f.hint ? { hint: f.hint } : {}),
    ...(f.choices ? { values: f.choices.map((c) => c.label) } : {})
  }));
  return [
    `Fields of the record:\n${JSON.stringify(fields, null, 1)}`,
    `Columns of the file, in order:\n${JSON.stringify(columns)}`,
    samples.length
      ? `Sample rows, cells in column order, long cells cut:\n${samples
          .map((row) => JSON.stringify(row))
          .join('\n')}`
      : 'No sample rows are given for this kind of record: match by the column names.'
  ].join('\n\n');
}

const Reply = z.object({
  fields: z.record(z.string(), z.string()),
  notes: z.string().max(1000).optional()
});

export type SuggestedColumns = {
  /** Field key to column name, as in the header row. */
  fields: Record<string, string>;
  notes: string | null;
  /** Matches given that named a field or column that does not exist, or reused one. */
  dropped: number;
};

/**
 * What of the reply is believed: a known field, a column the file has, and
 * each column once (ratings may share one, as a source with a single rating
 * is read as both likelihood and impact). Null when it is not JSON of the
 * right shape at all.
 */
export function readSuggestion(
  raw: string,
  recordType: RecordType,
  columns: readonly string[]
): SuggestedColumns | null {
  const parsed = Reply.safeParse(extractJson(raw));
  if (!parsed.success) return null;
  const keys = new Set(FIELDS[recordType].map((f) => f.key));
  const byName = new Map(columns.map((c) => [c.trim().toLowerCase(), c]));
  const fields: Record<string, string> = {};
  const taken = new Set<string>();
  let dropped = 0;
  for (const [key, given] of Object.entries(parsed.data.fields)) {
    const column = byName.get(given.trim().toLowerCase());
    const shared = RATINGS.has(key);
    if (!keys.has(key) || !column || (taken.has(column) && !shared)) {
      dropped += 1;
      continue;
    }
    fields[key] = column;
    if (!shared) taken.add(column);
  }
  return { fields, notes: parsed.data.notes?.trim() || null, dropped };
}

/**
 * A suggestion beside the matching already offered, which it never
 * overwrites: it fills the fields left empty, with columns nothing else
 * reads, and lists where it would have chosen otherwise.
 */
export function besideMapping(
  current: Readonly<Record<string, string>>,
  suggested: Readonly<Record<string, string>>
): { filled: Record<string, string>; differs: Record<string, string> } {
  const used = new Set(
    Object.entries(current)
      .filter(([key]) => !RATINGS.has(key))
      .map(([, column]) => column)
  );
  const filled: Record<string, string> = {};
  const differs: Record<string, string> = {};
  for (const [key, column] of Object.entries(suggested)) {
    if (current[key]) {
      if (current[key] !== column) differs[key] = column;
      continue;
    }
    if (used.has(column) && !RATINGS.has(key)) continue;
    filled[key] = column;
    if (!RATINGS.has(key)) used.add(column);
  }
  return { filled, differs };
}
