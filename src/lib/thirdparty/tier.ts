/**
 * How much a supplier matters, and what the register suggests from what it
 * already records.
 *
 * A person sets the tier. The suggestion is there so the choice starts from
 * the facts, and so departing from it has to be explained: a critical supplier
 * filed as low because nobody looked is the failure this exists to prevent.
 * Later releases read the tier to decide how deep due diligence goes and how
 * often a supplier is reviewed.
 */

export const SUPPLIER_TIERS = ['critical', 'high', 'medium', 'low'] as const;
export type SupplierTier = (typeof SUPPLIER_TIERS)[number];

export const TIER_LABEL: Record<SupplierTier, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

export function isSupplierTier(value: unknown): value is SupplierTier {
  return (SUPPLIER_TIERS as readonly unknown[]).includes(value);
}

/** Classification levels that make a supplier holding them critical, or high. */
const CRITICAL_LEVELS: ReadonlySet<string> = new Set([
  'restricted',
  'secret',
  'top_secret'
]);
const HIGH_LEVELS: ReadonlySet<string> = new Set([
  'confidential',
  'official_sensitive'
]);

export type TierFacts = {
  /** Classifications of the information assets in use that are linked to it. */
  assetClassifications: readonly string[];
  /** Processing activities with special category data that it receives or hosts. */
  specialCategoryActivities: number;
  role: string;
  aiInvolvement: string | null;
};

export type TierRecommendation = {
  tier: SupplierTier;
  /** Why, in the words shown beside the suggestion. */
  reasons: string[];
};

/** The tier the facts point to, and every fact that pointed there. */
export function recommendTier(facts: TierFacts): TierRecommendation {
  const reasons: Array<[SupplierTier, string]> = [];
  const critical = facts.assetClassifications.filter((c) =>
    CRITICAL_LEVELS.has(c)
  ).length;
  if (critical > 0)
    reasons.push([
      'critical',
      `Hosts or supports ${critical} information asset${critical === 1 ? '' : 's'} at the highest classification`
    ]);
  if (facts.specialCategoryActivities > 0)
    reasons.push([
      'high',
      `Receives or holds special category data for ${facts.specialCategoryActivities} processing activit${facts.specialCategoryActivities === 1 ? 'y' : 'ies'}`
    ]);
  const high = facts.assetClassifications.filter((c) =>
    HIGH_LEVELS.has(c)
  ).length;
  if (high > 0)
    reasons.push([
      'high',
      `Hosts or supports ${high} confidential information asset${high === 1 ? '' : 's'}`
    ]);
  if (facts.role === 'processor' || facts.role === 'both')
    reasons.push(['medium', 'Processes personal data for us']);
  if (
    facts.aiInvolvement === 'in_delivery' ||
    facts.aiInvolvement === 'ai_product'
  )
    reasons.push(['medium', 'Uses or supplies AI']);
  const tier =
    SUPPLIER_TIERS.find((t) => reasons.some(([r]) => r === t)) ?? 'low';
  return {
    tier,
    reasons:
      reasons.length > 0
        ? reasons.map(([, why]) => why)
        : ['Nothing recorded points above low']
  };
}
