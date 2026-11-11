/**
 * Reading an export file into a header and rows of text. CSV is read here, to
 * RFC 4180 (quoted fields, doubled quotes, line breaks inside quotes); Excel
 * workbooks are read by the service, which hands their first sheet in as cells.
 */

export class ImportFileRefused extends Error {}

/** A file's header and rows, every cell as trimmed text. */
export type Table = { columns: string[]; rows: string[][] };

/** The most rows one file may hold. A larger register goes in several files. */
export const MAX_ROWS = 5000;

/** The largest file accepted. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Comma, semicolon or tab, whichever the header row uses most. */
function delimiterOf(firstLine: string): string {
  const [best] = [',', ';', '\t']
    .map((d) => ({ d, n: firstLine.split(d).length - 1 }))
    .sort((a, b) => b.n - a.n);
  return best.n > 0 ? best.d : ',';
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const delimiter = delimiterOf(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted)
    throw new ImportFileRefused('The file ends inside a quoted value.');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const cellText = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).trim();

/**
 * Rows of cells as a table: the first non-empty row is the header, empty
 * rows are dropped, short rows are padded. Refuses a file with no header,
 * a blank or repeated column name, or too many rows.
 */
export function toTable(cells: unknown[][]): Table {
  const rows = cells
    .map((r) => r.map(cellText))
    .filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0)
    throw new ImportFileRefused('The file has no rows to read.');
  const [header, ...body] = rows;
  // Trailing empty header cells are spreadsheet padding, not columns.
  while (header.length && header[header.length - 1] === '') header.pop();
  if (header.some((h) => h === ''))
    throw new ImportFileRefused(
      'Every column needs a name in the first row. One is blank.'
    );
  const seen = new Set<string>();
  for (const h of header) {
    const key = h.toLowerCase();
    if (seen.has(key))
      throw new ImportFileRefused(
        `Two columns are called "${h}". Rename one so each can be matched.`
      );
    seen.add(key);
  }
  if (body.length > MAX_ROWS)
    throw new ImportFileRefused(
      `The file has ${body.length} rows. Import at most ${MAX_ROWS} at a time: split it into several files.`
    );
  return {
    columns: header,
    rows: body.map((r) => header.map((_, i) => r[i] ?? ''))
  };
}

/** A row read as column name to value. */
export function rowObject(table: Table, row: string[]): Record<string, string> {
  return Object.fromEntries(table.columns.map((c, i) => [c, row[i] ?? '']));
}
