import { z } from 'zod';

/**
 * The asset typology: what kinds of asset the register holds.
 *
 * One register, so one typology. The built-in types are the information
 * asset register's systems and repositories, and the digital assets that
 * renew: domains, certificates and software licences. An organisation adds
 * its own (`services/asset-types.ts`), each with a definition, because a
 * type nobody has defined is filled in differently by everyone who uses it.
 *
 * A type may carry an expiry or renewal date, which brings the same notice
 * reminders as a contract (`lib/renewals.ts`). The fields particular to a
 * type describe the asset, never the contents of a system: a certificate's
 * issuer and the names it covers, not its private key.
 */

/** Fields an asset can carry beyond the register's own, by type. */
export const DETAIL_FIELDS = {
  registrar: {
    label: 'Registrar',
    hint: 'Who the domain is registered with.',
    kind: 'text'
  },
  issuer: {
    label: 'Issuer',
    hint: 'The certificate authority that issued it.',
    kind: 'text'
  },
  names: {
    label: 'Names covered',
    hint: 'The domain names it is valid for, separated by commas.',
    kind: 'list'
  },
  seats: {
    label: 'Seats',
    hint: 'How many users or devices the licence covers.',
    kind: 'count'
  }
} as const;
export type DetailField = keyof typeof DETAIL_FIELDS;

const text = z.string().trim().max(200);
const DETAIL_SCHEMAS = {
  registrar: text,
  issuer: text,
  names: z.array(text).max(100),
  seats: z.number().int().min(1).max(10_000_000)
} satisfies Record<DetailField, z.ZodType>;

export type AssetDetailValues = {
  registrar?: string;
  issuer?: string;
  names?: string[];
  seats?: number;
};

export type AssetTypeDef = {
  key: string;
  label: string;
  definition: string;
  /** Whether its assets carry an expiry or renewal date, with reminders. */
  hasExpiry: boolean;
  fields: readonly DetailField[];
  builtIn: boolean;
  /** Retired: offered for no new asset, kept by those that have it. */
  retiredAt: Date | null;
};

const builtIn = (
  key: string,
  label: string,
  definition: string,
  hasExpiry = false,
  fields: readonly DetailField[] = []
): AssetTypeDef => ({
  key,
  label,
  definition,
  hasExpiry,
  fields,
  builtIn: true,
  retiredAt: null
});

/** The built-in types. Their keys are those the register has always stored. */
export const BUILT_IN_ASSET_TYPES: readonly AssetTypeDef[] = [
  builtIn(
    'system',
    'System',
    'An application the organisation runs or has run for it, such as an HR or case management system.'
  ),
  builtIn(
    'database',
    'Database',
    'A store of structured records that more than one system or team reads from.'
  ),
  builtIn(
    'file_share',
    'File share',
    'Shared folders or document libraries, on a server or in the cloud.'
  ),
  builtIn(
    'saas_application',
    'SaaS application',
    'Software used as a service, run by the supplier on its own infrastructure.'
  ),
  builtIn(
    'paper_archive',
    'Paper archive',
    'Records kept on paper: a filing room, an offsite store, boxes in a basement.'
  ),
  builtIn(
    'device',
    'Device',
    'Laptops, phones, removable media or other equipment that holds information.'
  ),
  builtIn(
    'domain',
    'Domain',
    'A domain name the organisation has registered. It lapses, and may be taken by someone else, if it is not renewed.',
    true,
    ['registrar']
  ),
  builtIn(
    'certificate',
    'Certificate',
    'A TLS or code-signing certificate. Services that rely on it fail when it expires.',
    true,
    ['issuer', 'names']
  ),
  builtIn(
    'software_licence',
    'Software licence',
    'A right to use software for a term or a number of seats, paid for under a licence or subscription.',
    true,
    ['seats']
  ),
  builtIn(
    'other',
    'Other',
    'Anything that fits none of the other types. Consider adding a type of its own if there are several.'
  )
];

const BUILT_IN_KEYS = new Set(BUILT_IN_ASSET_TYPES.map((t) => t.key));

export function isBuiltInAssetType(key: string): boolean {
  return BUILT_IN_KEYS.has(key);
}

/**
 * The key a new type is stored under, from its name: lower case, words
 * joined by underscores. The same rule the database checks.
 */
export function assetTypeKeyFrom(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 't_$1')
    .slice(0, 40)
    .replace(/_+$/, '');
}

/** The typology: built-in types first, then the organisation's own by name. */
export function typology(
  own: ReadonlyArray<Omit<AssetTypeDef, 'builtIn' | 'fields'>>
): AssetTypeDef[] {
  return [
    ...BUILT_IN_ASSET_TYPES,
    ...[...own]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((t) => ({ ...t, fields: [], builtIn: false }))
  ];
}

/** A type's label, or its key where it is not found. */
export function typeLabel(
  types: ReadonlyArray<Pick<AssetTypeDef, 'key' | 'label'>>,
  key: string
): string {
  return types.find((t) => t.key === key)?.label ?? key;
}

/**
 * An asset's details as they will be stored: only the type's own fields,
 * empty ones left out. Refused with a message naming the field.
 */
export function cleanDetails(
  type: Pick<AssetTypeDef, 'fields'>,
  given: Record<string, unknown>
): { ok: true; details: AssetDetailValues } | { ok: false; message: string } {
  const details: Record<string, unknown> = {};
  for (const field of type.fields) {
    const raw = given[field];
    if (
      raw === undefined ||
      raw === null ||
      raw === '' ||
      (Array.isArray(raw) && raw.length === 0)
    )
      continue;
    const parsed = DETAIL_SCHEMAS[field].safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        message:
          DETAIL_FIELDS[field].kind === 'count'
            ? `Give the ${DETAIL_FIELDS[field].label.toLowerCase()} as a whole number.`
            : `The ${DETAIL_FIELDS[field].label.toLowerCase()} is too long.`
      };
    const value = parsed.data;
    if (Array.isArray(value)) {
      const list = [...new Set(value.filter(Boolean))];
      if (list.length) details[field] = list;
    } else if (value !== '') details[field] = value;
  }
  return { ok: true, details: details as AssetDetailValues };
}

/** The details as label and text, in the type's order, for a page or a spreadsheet. */
export function describeDetails(
  type: Pick<AssetTypeDef, 'fields'> | undefined,
  details: AssetDetailValues
): Array<{ label: string; value: string }> {
  return (type?.fields ?? []).flatMap((f) => {
    const v = details[f];
    if (v === undefined) return [];
    return [
      {
        label: DETAIL_FIELDS[f].label,
        value: Array.isArray(v) ? v.join(', ') : String(v)
      }
    ];
  });
}

/**
 * The types a form offers: every type in use, and the asset's own although
 * it has been retired, so editing the asset does not force a new one on it.
 */
export function offeredTypes(
  types: readonly AssetTypeDef[],
  current?: string
): Array<
  Pick<AssetTypeDef, 'key' | 'label' | 'definition' | 'hasExpiry' | 'fields'>
> {
  return types
    .filter((t) => !t.retiredAt || t.key === current)
    .map(({ key, label, definition, hasExpiry, fields }) => ({
      key,
      label,
      definition,
      hasExpiry,
      fields
    }));
}
