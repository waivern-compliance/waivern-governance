import {
  aiUseCaseIn,
  dpaIn,
  evidenceIn,
  processingActivityIn,
  vendorIn
} from '@/lib/integration/contracts';

import type { ImportMapping, ImportRecord } from './types';

/**
 * The fields each kind of record can be read into, and how one row becomes a
 * record. Pure, so the preview and the import run the same code, and the
 * checks are the Integration API's own (`lib/integration/contracts.ts`).
 */

export type RecordType =
  'supplier' | 'processing_activity' | 'dpa' | 'evidence' | 'ai_use_case';

/** Kinds of record that belong to a legal entity, which the upload names. */
export const ENTITY_SCOPED: ReadonlySet<RecordType> = new Set([
  'processing_activity',
  'evidence',
  'ai_use_case'
]);

/** Kinds of record whose rows can name a file added to the import. */
export const CARRIES_FILES: ReadonlySet<RecordType> = new Set([
  'dpa',
  'evidence'
]);

type FieldKind =
  'text' | 'list' | 'date' | 'role' | 'transfers' | 'choice' | 'yesno' | 'file';

/** A value a choice field accepts, and the words that mean it. */
type Choice = { value: string; label: string; words: string[] };

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  /** Header names that usually mean this field, to match a column at first. */
  aliases: string[];
  /** For a choice: the values it accepts. */
  choices?: Choice[];
};

const choice = (value: string, label: string, ...words: string[]): Choice => ({
  value,
  label,
  words
});

const FILE: FieldDef = {
  key: 'file',
  label: 'File',
  kind: 'file',
  hint: 'The name of a file added to this import, such as "acme-dpa.pdf". Add the files on this page.',
  aliases: ['file', 'filename', 'file name', 'attachment', 'document']
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
  ],
  dpa: [
    ID,
    {
      key: 'supplier',
      label: 'Supplier',
      kind: 'text',
      required: true,
      hint: 'Matched by name to a supplier already recorded. Import the supplier list first.',
      aliases: [
        'supplier',
        'vendor',
        'processor',
        'vendor name',
        'supplier name'
      ]
    },
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'agreement', 'agreement name', 'contract']
    },
    {
      key: 'documentRef',
      label: 'Its reference',
      kind: 'text',
      aliases: ['contract reference', 'contract number', 'agreement reference']
    },
    {
      key: 'signedAt',
      label: 'Signed',
      kind: 'date',
      aliases: ['signed', 'signed date', 'date signed', 'effective date']
    },
    {
      key: 'expiresAt',
      label: 'Expires',
      kind: 'date',
      aliases: ['expires', 'expiry', 'expiry date', 'end date', 'renewal date']
    },
    {
      key: 'transferMechanism',
      label: 'Transfer mechanism',
      kind: 'text',
      aliases: ['transfer mechanism', 'transfer safeguard', 'safeguard']
    },
    {
      key: 'subProcessors',
      label: 'Sub-processors',
      kind: 'list',
      aliases: ['sub processors', 'subprocessors', 'sub-processors']
    },
    FILE
  ],
  evidence: [
    ID,
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'evidence', 'evidence name', 'document name']
    },
    {
      key: 'kind',
      label: 'Kind',
      kind: 'choice',
      hint: 'A document, scan, attestation or link. Left empty, a row with a file is a document and one with only a link is a link.',
      aliases: ['kind', 'type', 'evidence type'],
      choices: [
        choice('document', 'Document', 'file', 'policy', 'report'),
        choice('scan', 'Scan', 'scan result', 'test'),
        choice('attestation', 'Attestation', 'attested', 'declaration'),
        choice('link', 'Link', 'url', 'web link')
      ]
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'details', 'notes']
    },
    {
      key: 'uri',
      label: 'Link',
      kind: 'text',
      aliases: ['link', 'url', 'uri', 'location']
    },
    {
      key: 'collectedAt',
      label: 'Collected',
      kind: 'date',
      aliases: [
        'collected',
        'date',
        'collected at',
        'evidence date',
        'uploaded'
      ]
    },
    {
      key: 'attachTo',
      label: 'Supports',
      kind: 'text',
      hint: 'The reference of a record here it supports, such as ROPA-2026-0004 or DPIA-2026-0001.',
      aliases: ['supports', 'attach to', 'related record', 'record']
    },
    FILE
  ],
  ai_use_case: [
    ID,
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      required: true,
      aliases: ['name', 'system', 'ai system', 'use case', 'title']
    },
    {
      key: 'purpose',
      label: 'Purpose',
      kind: 'text',
      required: true,
      aliases: ['purpose', 'use', 'what it is for', 'business purpose']
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'details', 'summary']
    },
    {
      key: 'systemType',
      label: 'Type of system',
      kind: 'choice',
      required: true,
      aliases: ['type', 'system type', 'ai type', 'category'],
      choices: [
        choice(
          'predictive',
          'Predictive',
          'classification',
          'machine learning',
          'ml',
          'scoring'
        ),
        choice('generative', 'Generative', 'genai', 'gen ai', 'llm', 'chatbot'),
        choice('agentic', 'Agentic', 'agent', 'ai agent'),
        choice('hybrid', 'Hybrid', 'mixed')
      ]
    },
    {
      key: 'provenance',
      label: 'Where it comes from',
      kind: 'choice',
      required: true,
      aliases: ['provenance', 'source', 'built or bought', 'origin'],
      choices: [
        choice(
          'built_in_house',
          'Built in house',
          'in house',
          'internal',
          'built',
          'built internally'
        ),
        choice('fine_tuned', 'Fine-tuned', 'fine tuned', 'customised model'),
        choice(
          'third_party_api',
          'Third-party API',
          'third party api',
          'api',
          'external api'
        ),
        choice(
          'embedded_vendor',
          'Inside a product we bought',
          'embedded',
          'vendor',
          'third party product',
          'bought'
        )
      ]
    },
    {
      key: 'lifecycleStage',
      label: 'Stage',
      kind: 'choice',
      hint: 'Used when the system is first recorded; a re-import never moves it.',
      aliases: ['stage', 'status', 'lifecycle', 'lifecycle stage'],
      choices: [
        choice('proposed', 'Proposed', 'idea', 'planned', 'requested'),
        choice('development', 'Development', 'in development', 'building'),
        choice('pilot', 'Pilot', 'trial', 'testing', 'poc', 'proof of concept'),
        choice(
          'production',
          'Production',
          'live',
          'in use',
          'deployed',
          'active'
        ),
        choice('retiring', 'Retiring', 'being retired', 'sunsetting'),
        choice('retired', 'Retired', 'decommissioned', 'inactive')
      ]
    },
    {
      key: 'deploymentPattern',
      label: 'How it is deployed',
      kind: 'choice',
      aliases: ['deployment', 'deployment pattern', 'hosting'],
      choices: [
        choice(
          'public_web_app',
          'Public web app',
          'web app',
          'saas',
          'chat service'
        ),
        choice('embedded', 'Embedded in other software'),
        choice('public_api', 'Public API', 'api'),
        choice(
          'privately_hosted',
          'Privately hosted',
          'self hosted',
          'private cloud',
          'on premises'
        ),
        choice('local', 'Local device', 'on device', 'desktop'),
        choice('trained_here', 'Trained here', 'trained in house')
      ]
    },
    {
      key: 'supplierName',
      label: 'Supplier',
      kind: 'text',
      hint: 'Linked to the supplier of that name where one is recorded.',
      aliases: ['supplier', 'vendor', 'provider']
    },
    {
      key: 'modelName',
      label: 'Model',
      kind: 'text',
      aliases: ['model', 'model name', 'foundation model']
    },
    {
      key: 'deployedIn',
      label: 'Deployed in',
      kind: 'list',
      aliases: ['deployed in', 'systems', 'used in', 'applications']
    },
    {
      key: 'processesPersonalData',
      label: 'Processes personal data',
      kind: 'yesno',
      aliases: [
        'personal data',
        'processes personal data',
        'uses personal data'
      ]
    },
    {
      key: 'dataCategories',
      label: 'Categories of personal data',
      kind: 'list',
      aliases: ['data categories', 'categories of data', 'data types']
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

const words = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, '');

/** A choice field's value, from its value, label or a usual word for it. */
export function readChoice(field: FieldDef, value: string): string {
  const v = words(value);
  const found = (field.choices ?? []).find(
    (c) =>
      words(c.value.replace(/_/g, ' ')) === v ||
      words(c.label) === v ||
      c.words.some((w) => words(w) === v)
  );
  if (!found)
    throw new RowRefused(
      `"${value}" is not a ${field.label.toLowerCase()} Govern knows. Use one of: ${(
        field.choices ?? []
      )
        .map((c) => c.label)
        .join(', ')}.`
    );
  return found.value;
}

export function readYesNo(field: FieldDef, value: string): boolean {
  const v = words(value);
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  throw new RowRefused(
    `"${value}" is not yes or no, for ${field.label.toLowerCase()}.`
  );
}

/** Its identifier there, or what names it when the file has none. */
function refOf(recordType: RecordType, valueOf: (key: string) => string) {
  const given = valueOf('externalRef');
  if (given) return given;
  if (recordType === 'dpa') {
    const supplier = valueOf('supplier');
    const title = valueOf('title');
    return supplier && title ? `${supplier} / ${title}` : null;
  }
  if (recordType === 'evidence') {
    // A title alone would make next year's "Annual penetration test" this
    // year's, written over it: when and which file tell them apart.
    const title = valueOf('title');
    return title
      ? [title, valueOf('collectedAt'), valueOf('file')]
          .filter(Boolean)
          .join(' / ')
      : null;
  }
  return valueOf('name') || null;
}

/**
 * What each kind of record is checked against: the Integration API's own
 * contract, with the import's field names put into its terms.
 */
function checkAs(recordType: RecordType, data: Record<string, unknown>) {
  switch (recordType) {
    case 'processing_activity':
      return processingActivityIn.safeParse(data);
    case 'supplier':
      return vendorIn.safeParse(data);
    case 'dpa': {
      const { supplier, file: _file, ...rest } = data;
      return dpaIn.safeParse({ ...rest, vendorName: supplier });
    }
    case 'evidence': {
      const { file: _file, ...rest } = data;
      return evidenceIn.safeParse(rest);
    }
    case 'ai_use_case':
      return aiUseCaseIn.safeParse(data);
  }
}

/** Contract field names that differ from the import's. */
const CONTRACT_KEY: Record<string, string> = { vendorName: 'supplier' };

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
  const sourceRef = refOf(recordType, valueOf);
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
                : f.kind === 'choice'
                  ? readChoice(f, raw)
                  : f.kind === 'yesno'
                    ? readYesNo(f, raw)
                    : raw;
    }
    data.externalRef = sourceRef!;
    // Evidence is a document unless the row only gives a link.
    if (recordType === 'evidence' && !data.kind)
      data.kind = data.file || !data.uri ? 'document' : 'link';

    const mapped = new Set(Object.values(mapping.fields));
    const legacy = mapping.keepUnmapped
      ? Object.fromEntries(
          Object.entries(row).filter(
            ([column, value]) => !mapped.has(column) && value.trim() !== ''
          )
        )
      : {};

    const checked = checkAs(recordType, data);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      const key = String(issue.path[0] ?? '');
      const field = defs.find((f) => f.key === (CONTRACT_KEY[key] ?? key));
      throw new RowRefused(
        `${field?.label ?? (key || 'A value')}: ${
          issue.code === 'too_big' ? 'too long' : 'not accepted'
        }.`
      );
    }
    // The contract's defaults (empty lists) applied; the import's own names
    // and the file kept, which the contract does not know.
    const clean: Record<string, unknown> = {
      ...data,
      ...checked.data,
      externalRef: sourceRef!
    };
    if (recordType === 'dpa') delete clean.vendorName;
    return {
      action: 'ok',
      sourceRef: sourceRef!,
      record: { kind: recordType, data: clean, legacy } as ImportRecord
    };
  } catch (error) {
    if (error instanceof RowRefused)
      return { action: 'refuse', sourceRef, reason: error.message };
    throw error;
  }
}
