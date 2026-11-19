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
  },
  quantity: {
    label: 'How many',
    hint: 'Where this asset is a group of alike devices, such as one laptop build, how many there are.',
    kind: 'count'
  },
  ownership: {
    label: 'Owned by',
    hint: 'Who owns the device. A Cyber Essentials scope turns on it.',
    kind: 'choice',
    choices: {
      organisation: 'The organisation',
      byod: 'Its user (their own device)',
      third_party: 'A supplier, contractor or customer'
    }
  },
  userRole: {
    label: 'Used by',
    hint: "Who uses it. Students' own devices are outside a Cyber Essentials scope; staff, volunteers' and trustees' are not.",
    kind: 'choice',
    choices: {
      staff: 'Staff',
      volunteer: 'Volunteers',
      trustee: 'Trustees',
      research_assistant: 'Research assistants',
      student: 'Students',
      contractor: 'Contractors'
    }
  },
  operatingSystem: {
    label: 'Operating system or firmware',
    hint: 'With its version, such as Windows 11 23H2 or FortiOS 7.4.',
    kind: 'text'
  },
  supportedUntil: {
    label: 'Supported until',
    hint: 'When its vendor stops issuing security updates for it.',
    kind: 'date'
  },
  cloudModel: {
    label: 'Cloud service model',
    hint: 'Where it runs on a cloud provider: who configures what depends on it.',
    kind: 'choice',
    choices: {
      iaas: 'Infrastructure as a service',
      paas: 'Platform as a service',
      saas: 'Software as a service'
    }
  }
} as const;
export type DetailField = keyof typeof DETAIL_FIELDS;

type ChoiceField = {
  [F in DetailField]: (typeof DETAIL_FIELDS)[F] extends { kind: 'choice' }
    ? F
    : never;
}[DetailField];
type ChoiceOf<F extends ChoiceField> =
  keyof (typeof DETAIL_FIELDS)[F]['choices'] & string;

export type DeviceOwnership = ChoiceOf<'ownership'>;
export type DeviceUserRole = ChoiceOf<'userRole'>;
export type CloudModel = ChoiceOf<'cloudModel'>;

/** A choice field's values as a schema, for the form and the import alike. */
export const choiceOf = <F extends ChoiceField>(field: F) =>
  z.enum(
    Object.keys(DETAIL_FIELDS[field].choices) as [ChoiceOf<F>, ...ChoiceOf<F>[]]
  );

const text = z.string().trim().max(200);
const DETAIL_SCHEMAS = {
  registrar: text,
  issuer: text,
  names: z.array(text).max(100),
  seats: z.number().int().min(1).max(10_000_000),
  quantity: z.number().int().min(1).max(10_000_000),
  ownership: choiceOf('ownership'),
  userRole: choiceOf('userRole'),
  operatingSystem: text,
  supportedUntil: z.iso.date(),
  cloudModel: choiceOf('cloudModel')
} satisfies Record<DetailField, z.ZodType>;

export type AssetDetailValues = {
  registrar?: string;
  issuer?: string;
  names?: string[];
  seats?: number;
  quantity?: number;
  ownership?: DeviceOwnership;
  userRole?: DeviceUserRole;
  operatingSystem?: string;
  /** A day, as `2027-10-14`. */
  supportedUntil?: string;
  cloudModel?: CloudModel;
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
    'An application the organisation runs or has run for it, such as an HR or case management system.',
    false,
    ['cloudModel']
  ),
  builtIn(
    'database',
    'Database',
    'A store of structured records that more than one system or team reads from.',
    false,
    ['cloudModel']
  ),
  builtIn(
    'file_share',
    'File share',
    'Shared folders or document libraries, on a server or in the cloud.',
    false,
    ['cloudModel']
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
    'Laptops, desktops, tablets, phones, removable media or other equipment people use that holds information. Record alike devices as one asset with how many there are.',
    false,
    ['ownership', 'userRole', 'quantity', 'operatingSystem', 'supportedUntil']
  ),
  builtIn(
    'server',
    'Server',
    'A physical or virtual server the organisation runs, on its premises or on a cloud provider it configures itself.',
    false,
    ['quantity', 'operatingSystem', 'supportedUntil', 'cloudModel']
  ),
  builtIn(
    'network_device',
    'Network device',
    'A firewall, router, switch or wireless access point. One the organisation supplies to a home worker counts.',
    false,
    ['ownership', 'quantity', 'operatingSystem', 'supportedUntil']
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
    ['seats', 'supportedUntil']
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
    if (!parsed.success) return { ok: false, message: refusalFor(field) };
    const value = parsed.data;
    if (Array.isArray(value)) {
      const list = [...new Set(value.filter(Boolean))];
      if (list.length) details[field] = list;
    } else if (value !== '') details[field] = value;
  }
  return { ok: true, details: details as AssetDetailValues };
}

const REFUSAL: Partial<Record<DetailField, string>> = {
  quantity: 'Give how many there are as a whole number.',
  ownership: 'Choose who owns it from the list.',
  userRole: 'Choose who uses it from the list.',
  supportedUntil:
    'Give the date its support ends as a day, such as 2027-10-14.',
  cloudModel: 'Choose the cloud service model from the list.'
};

function refusalFor(field: DetailField): string {
  const { label, kind } = DETAIL_FIELDS[field];
  return (
    REFUSAL[field] ??
    (kind === 'count'
      ? `Give the ${label.toLowerCase()} as a whole number.`
      : `The ${label.toLowerCase()} is too long.`)
  );
}

/** A detail's value as words: a choice's label, a day in full. */
function detailText(field: DetailField, value: unknown): string {
  const def = DETAIL_FIELDS[field];
  if (Array.isArray(value)) return value.join(', ');
  if (def.kind === 'choice')
    return (
      (def.choices as Record<string, string>)[String(value)] ?? String(value)
    );
  if (def.kind === 'date')
    return new Date(`${String(value)}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });
  return String(value);
}

/**
 * Whether its vendor has stopped issuing security updates for it. Unsupported
 * software is out of a Cyber Essentials scope only by being removed from it.
 */
export function outOfSupport(details: AssetDetailValues, at: Date): boolean {
  return (
    details.supportedUntil !== undefined &&
    details.supportedUntil < at.toISOString().slice(0, 10)
  );
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
        value: detailText(f, v)
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
