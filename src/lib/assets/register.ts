import { outOfSupport, type AssetDetailValues } from './types';

/**
 * The information asset register: what an asset is, where it lives and how it
 * is classified.
 *
 * An asset is a system or repository - a database, a file share, a SaaS
 * application, a paper archive - never its contents. The processing register
 * records categories of personal data; this records where they are held, so
 * it describes systems and links to the processing, suppliers and risks that
 * concern them rather than copying them.
 *
 * No statute requires an asset register. UK public bodies keep one under the
 * NCSC's guidance and the Government Security Classifications, and other
 * organisations keep one to support their records under Article 30 and the
 * security they owe under Article 32. Nothing here calls it a legal duty.
 *
 * What kinds of asset it holds, the organisation's own among them, is the
 * typology in `types.ts`.
 */

/** Who runs the infrastructure it sits on. */
export const HOSTING_MODELS = [
  'on_premises',
  'saas',
  'cloud',
  'hybrid'
] as const;
export type HostingModel = (typeof HOSTING_MODELS)[number];

export const HOSTING_LABEL: Record<HostingModel, string> = {
  on_premises: 'On premises',
  saas: 'SaaS (run by the supplier)',
  cloud: 'Cloud (our own, on a provider)',
  hybrid: 'Hybrid'
};

/**
 * Classification schemes an organisation can choose from. The neutral set is
 * the default because most firms do not use the Government Security
 * Classifications, and a public body that does should not have to translate.
 * Keys are unique across schemes, so a stored classification always says
 * which scheme it came from.
 */
export const CLASSIFICATION_SCHEMES = {
  neutral: {
    name: 'Neutral',
    inSentence: 'neutral scheme',
    description:
      'Public, internal, confidential and restricted: a common four-level set for organisations without a scheme of their own.',
    levels: {
      public: 'Public',
      internal: 'Internal',
      confidential: 'Confidential',
      restricted: 'Restricted'
    }
  },
  uk_government: {
    name: 'Government Security Classifications',
    inSentence: 'Government Security Classifications',
    description:
      'Official, Official-Sensitive, Secret and Top Secret, as UK public bodies mark information under the Cabinet Office policy.',
    levels: {
      official: 'Official',
      official_sensitive: 'Official-Sensitive',
      secret: 'Secret',
      top_secret: 'Top Secret'
    }
  }
} as const;

export type ClassificationScheme = keyof typeof CLASSIFICATION_SCHEMES;
export type AssetClassification = {
  [
    S in ClassificationScheme
  ]: keyof (typeof CLASSIFICATION_SCHEMES)[S]['levels'];
}[ClassificationScheme];

export const DEFAULT_CLASSIFICATION_SCHEME: ClassificationScheme = 'neutral';

export function isHostingModel(value: unknown): value is HostingModel {
  return (HOSTING_MODELS as readonly unknown[]).includes(value);
}

export function isClassificationScheme(
  value: unknown
): value is ClassificationScheme {
  return typeof value === 'string' && value in CLASSIFICATION_SCHEMES;
}

/** A level of the given scheme. */
export function isClassificationIn(
  scheme: ClassificationScheme,
  value: unknown
): value is AssetClassification {
  return (
    typeof value === 'string' && value in CLASSIFICATION_SCHEMES[scheme].levels
  );
}

/** The label of a stored classification, from whichever scheme it belongs to. */
export function classificationLabel(value: string | null): string | null {
  if (!value) return null;
  for (const scheme of Object.values(CLASSIFICATION_SCHEMES)) {
    const levels: Record<string, string> = scheme.levels;
    if (value in levels) return levels[value];
  }
  return value;
}

/** The levels of a scheme, in order, for a form. */
export function levelsOf(scheme: ClassificationScheme) {
  return Object.entries(CLASSIFICATION_SCHEMES[scheme].levels) as Array<
    [AssetClassification, string]
  >;
}

export type AssetFacts = {
  ownerId: string | null;
  hosting: HostingModel | null;
  classification: string | null;
  retention: string | null;
  nextReviewAt: Date | null;
  retiredAt: Date | null;
  /** The type's own fields: an end of vendor support among them. */
  details?: AssetDetailValues;
};

export const ASSET_GAPS = [
  'out_of_support',
  'review_overdue',
  'no_owner',
  'unclassified',
  'no_location',
  'no_retention',
  'no_review_date'
] as const;
export type AssetGap = (typeof ASSET_GAPS)[number];

export const ASSET_GAP_WORDS: Record<AssetGap, string> = {
  out_of_support: 'Out of vendor support',
  review_overdue: 'Past its review date',
  no_owner: 'No information asset owner',
  unclassified: 'Not classified',
  no_location: 'Not said where it is hosted',
  no_retention: 'No retention recorded',
  no_review_date: 'No review date'
};

export function reviewOverdue(
  asset: Pick<AssetFacts, 'nextReviewAt' | 'retiredAt'>,
  now = new Date()
): boolean {
  return (
    !asset.retiredAt &&
    asset.nextReviewAt !== null &&
    asset.nextReviewAt.getTime() <= now.getTime()
  );
}

/** What the record does not yet say, most pressing first. A retired asset owes nothing. */
export function assetGaps(asset: AssetFacts, now = new Date()): AssetGap[] {
  if (asset.retiredAt) return [];
  const gaps: AssetGap[] = [];
  if (asset.details && outOfSupport(asset.details, now))
    gaps.push('out_of_support');
  if (reviewOverdue(asset, now)) gaps.push('review_overdue');
  if (!asset.ownerId) gaps.push('no_owner');
  if (!asset.classification) gaps.push('unclassified');
  if (!asset.hosting) gaps.push('no_location');
  if (!asset.retention?.trim()) gaps.push('no_retention');
  if (!asset.nextReviewAt) gaps.push('no_review_date');
  return gaps;
}

/** The register's filters. "none" asks for assets with nothing recorded. */
export type AssetFilter = {
  ownerId?: string;
  classification?: string;
  assetType?: string;
  overdue?: boolean;
  retired?: boolean;
};

export function matchesFilter(
  asset: AssetFacts & { assetType: string },
  filter: AssetFilter,
  now = new Date()
): boolean {
  if (!filter.retired && asset.retiredAt) return false;
  if (filter.ownerId) {
    if (
      filter.ownerId === 'none'
        ? asset.ownerId
        : asset.ownerId !== filter.ownerId
    )
      return false;
  }
  if (filter.classification) {
    if (
      filter.classification === 'none'
        ? asset.classification
        : asset.classification !== filter.classification
    )
      return false;
  }
  if (filter.assetType && asset.assetType !== filter.assetType) return false;
  if (filter.overdue && !reviewOverdue(asset, now)) return false;
  return true;
}
