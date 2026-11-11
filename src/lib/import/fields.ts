import { processingActivityIn, vendorIn } from '@/lib/integration/contracts';

import type { ImportMapping, ImportRecord } from './types';

/**
 * The fields each kind of record can be read into, and how one row becomes a
 * record. Pure, so the preview and the import run the same code, and the
 * checks are the Integration API's own (`lib/integration/contracts.ts`).
 */

export type RecordType = 'supplier' | 'processing_activity';

type FieldKind = 'text' | 'list' | 'date' | 'role' | 'transfers';

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  /** Header names that usually mean this field, to match a column at first. */
  aliases: string[];
};

const ID: FieldDef = {
  key: 'externalRef',
  label: 'Its ID in the other platform',
  kind: 'text',
  hint: 'What makes importing the same file again update rather than duplicate. Without one, the name is used.',
  aliases: ['id', 'external id', 'record id', 'reference', 'ref', 'uuid']
};

export const FIELDS: Record<RecordType, FieldDef[]> = {
  processing_activity: [
    ID,
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      required: true,
      aliases: [
        'name',
        'activity',
        'processing activity',
        'activity name',
        'title'
      ]
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'details', 'summary']
    },
    {
      key: 'purposes',
      label: 'Purposes',
      kind: 'list',
      aliases: ['purpose', 'purposes', 'purpose of processing']
    },
    {
      key: 'lawfulBasis',
      label: 'Lawful basis',
      kind: 'text',
      hint: 'Read into the Article 6 bases where it names them plainly; kept as written either way.',
      aliases: ['lawful basis', 'legal basis', 'lawful bases', 'legal bases']
    },
    {
      key: 'dataCategories',
      label: 'Categories of personal data',
      kind: 'list',
      aliases: [
        'data categories',
        'data elements',
        'personal data',
        'categories of data',
        'data types'
      ]
    },
    {
      key: 'subjectCategories',
      label: 'Categories of data subjects',
      kind: 'list',
      aliases: [
        'data subjects',
        'subject categories',
        'data subject types',
        'categories of data subjects'
      ]
    },
    {
      key: 'recipients',
      label: 'Recipients',
      kind: 'list',
      aliases: ['recipients', 'recipient', 'shared with', 'third parties']
    },
    {
      key: 'systems',
      label: 'Systems',
      kind: 'list',
      aliases: ['systems', 'assets', 'applications', 'system']
    },
    {
      key: 'transfers',
      label: 'International transfers',
      kind: 'transfers',
      hint: 'One per country, such as "United States (SCCs)".',
      aliases: [
        'transfers',
        'international transfers',
        'countries',
        'transfer countries'
      ]
    },
    {
      key: 'retention',
      label: 'Retention',
      kind: 'text',
      aliases: ['retention', 'retention period', 'how long']
    },
    {
      key: 'securityMeasures',
      label: 'Security measures',
      kind: 'text',
      aliases: [
        'security measures',
        'security',
        'technical and organisational measures',
        'toms'
      ]
    },
    {
      key: 'controllerRole',
      label: 'Our role',
      kind: 'role',
      hint: 'Controller, processor or joint controller.',
      aliases: [
        'role',
        'our role',
        'controller role',
        'controller or processor'
      ]
    },
    {
      key: 'controllerName',
      label: 'Controller',
      kind: 'text',
      aliases: ['controller', 'controller name']
    },
    {
      key: 'reviewDueAt',
      label: 'Review due',
      kind: 'date',
      aliases: ['review date', 'next review', 'review due']
    }
  ],
  supplier: [
    ID,
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      required: true,
      aliases: [
        'name',
        'vendor',
        'vendor name',
        'supplier',
        'supplier name',
        'company'
      ]
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'service', 'services', 'what they do']
    },
    {
      key: 'categories',
      label: 'Categories',
      kind: 'list',
      aliases: [
        'category',
        'categories',
        'type',
        'vendor type',
        'service category'
      ]
    }
  ]
};

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');

/** A first matching of columns to fields, by name, for a person to check. */
export function guessMapping(
  recordType: RecordType,
  columns: readonly string[]
): ImportMapping {
  const fields: Record<string, string> = {};
  const taken = new Set<string>();
  for (const f of FIELDS[recordType]) {
    const column = columns.find(
      (c) => !taken.has(c) && f.aliases.includes(norm(c))
    );
    if (column) {
      fields[f.key] = column;
      taken.add(column);
    }
  }
  return { fields, keepUnmapped: true };
}

/** Refused, with the reason, before anything is written. */
export class RowRefused extends Error {}

/** Several values in one cell: separated by semicolons, bars or line breaks. */
export function splitList(value: string): string[] {
  return value
    .split(/[;|\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 2026-03-31, 31/03/2026 (UK order) or 31.03.2026, as an ISO date-time. */
export function readDate(value: string): string {
  const v = value.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  const uk = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (uk) [d, m, y] = [+uk[1], +uk[2], +uk[3]];
  else
    throw new RowRefused(`"${v}" is not a date. Use 2026-03-31 or 31/03/2026.`);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    throw new RowRefused(`"${v}" is not a real date.`);
  return date.toISOString();
}

export function readRole(
  value: string
): 'controller' | 'processor' | 'joint_controller' {
  const v = norm(value);
  if (/joint/.test(v)) return 'joint_controller';
  if (/processor/.test(v)) return 'processor';
  if (/controller/.test(v)) return 'controller';
  throw new RowRefused(
    `"${value}" is not a role. Use controller, processor or joint controller.`
  );
}

/** "United States (SCCs)", "India: IDTA" or just "Canada". */
export function readTransfers(
  value: string
): Array<{ country: string; mechanism?: string }> {
  return splitList(value).map((entry) => {
    const m = /^(.+?)\s*(?:\((.+)\)|:\s*(.+))$/.exec(entry);
    return m
      ? { country: m[1].trim(), mechanism: (m[2] ?? m[3]).trim() }
      : { country: entry };
  });
}

export type Converted =
  | { action: 'skip' }
  | { action: 'refuse'; sourceRef: string | null; reason: string }
  | { action: 'ok'; sourceRef: string; record: ImportRecord };

/**
 * One row as a record, checked as the Integration API checks a pushed one.
 * Nothing is guessed: a value that cannot be read refuses the row, with why.
 */
export function convertRow(
  recordType: RecordType,
  mapping: ImportMapping,
  row: Record<string, string>
): Converted {
  if (Object.values(row).every((v) => v.trim() === ''))
    return { action: 'skip' };
  const defs = FIELDS[recordType];
  const valueOf = (key: string) => {
    const column = mapping.fields[key];
    return column ? (row[column] ?? '').trim() : '';
  };
  const sourceRef = valueOf('externalRef') || valueOf('name') || null;
  try {
    const data: Record<string, unknown> = {};
    for (const f of defs) {
      const raw = valueOf(f.key);
      if (!raw) {
        if (f.required) throw new RowRefused(`${f.label} is empty.`);
        continue;
      }
      data[f.key] =
        f.kind === 'list'
          ? splitList(raw)
          : f.kind === 'date'
            ? readDate(raw)
            : f.kind === 'role'
              ? readRole(raw)
              : f.kind === 'transfers'
                ? readTransfers(raw)
                : raw;
    }
    data.externalRef = sourceRef!;

    const mapped = new Set(Object.values(mapping.fields));
    const legacy = mapping.keepUnmapped
      ? Object.fromEntries(
          Object.entries(row).filter(
            ([column, value]) => !mapped.has(column) && value.trim() !== ''
          )
        )
      : {};

    const schema =
      recordType === 'processing_activity' ? processingActivityIn : vendorIn;
    const checked = schema.safeParse(data);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      const field = defs.find((f) => f.key === issue.path[0]);
      throw new RowRefused(
        `${field?.label ?? String(issue.path[0] ?? 'A value')}: ${
          issue.code === 'too_big' ? 'too long' : 'not accepted'
        }.`
      );
    }
    return {
      action: 'ok',
      sourceRef: sourceRef!,
      record:
        recordType === 'processing_activity'
          ? {
              kind: 'processing_activity',
              data: checked.data as Extract<
                ImportRecord,
                { kind: 'processing_activity' }
              >['data'],
              legacy
            }
          : {
              kind: 'supplier',
              data: {
                ...(checked.data as Extract<
                  ImportRecord,
                  { kind: 'supplier' }
                >['data']),
                externalRef: sourceRef!
              },
              legacy
            }
    };
  } catch (error) {
    if (error instanceof RowRefused)
      return { action: 'refuse', sourceRef, reason: error.message };
    throw error;
  }
}
