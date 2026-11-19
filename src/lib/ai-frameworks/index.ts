import {
  GENERAL_CATEGORIES,
  generalCategory
} from '@/lib/risk/general-categories';
import type { TreatmentSuggestion } from '@/lib/risk/treatment-library';

import { NIST_AI_RMF } from './nist-pack';
import type { AiFrameworkId, AiFrameworkPack, RiskCategoryDef } from './types';
import { UK_DSIT } from './uk-dsit';

export type { AiFrameworkId, AiFrameworkPack, RiskCategoryDef } from './types';

/**
 * The AI governance frameworks an organisation may follow, and the one it
 * follows unless it chooses otherwise.
 *
 * The organisation's choice decides what it is offered: which categories a new
 * risk may be filed under, which appetite statements may be written, which
 * treatments are suggested. What it already holds is read across every
 * framework, so a risk filed under one framework still reads correctly after
 * the organisation moves to another.
 */
export const AI_FRAMEWORKS: Record<AiFrameworkId, AiFrameworkPack> = {
  uk_dsit: UK_DSIT,
  nist_ai_rmf: NIST_AI_RMF
};

export const DEFAULT_AI_FRAMEWORK: AiFrameworkId = 'uk_dsit';

export function isAiFramework(value: unknown): value is AiFrameworkId {
  return typeof value === 'string' && value in AI_FRAMEWORKS;
}

/** The pack for a stored value, or the default for one we do not know. */
export function frameworkPack(id: string | null | undefined): AiFrameworkPack {
  return isAiFramework(id)
    ? AI_FRAMEWORKS[id]
    : AI_FRAMEWORKS[DEFAULT_AI_FRAMEWORK];
}

const ALL_CATEGORIES = new Map<string, RiskCategoryDef>([
  ...Object.values(AI_FRAMEWORKS).flatMap((p) =>
    p.categories.map((c) => [c.value, c] as const)
  ),
  ...GENERAL_CATEGORIES.map((c) => [c.value, c] as const)
]);

/** Every category Govern knows: each framework's, then those offered whatever the framework. */
export const KNOWN_CATEGORIES: readonly RiskCategoryDef[] = [
  ...ALL_CATEGORIES.values()
];

/**
 * The categories an organisation files risk under: its framework's, then
 * those offered whatever the framework, such as cyber security.
 */
export function categoriesOffered(
  pack: AiFrameworkPack
): readonly RiskCategoryDef[] {
  return [...pack.categories, ...GENERAL_CATEGORIES];
}

/**
 * A category some framework defines, whether or not the organisation follows
 * it now, or one offered whatever the framework (`GENERAL_CATEGORIES`).
 */
export function isKnownCategory(value: unknown): value is string {
  return typeof value === 'string' && ALL_CATEGORIES.has(value);
}

/** How a stored category reads on screen — the label where we know it, as written where we do not. */
export function categoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALL_CATEGORIES.get(value)?.label ?? value;
}

type TreatmentSource = AiFrameworkPack['treatmentSource'];

/** Every source of treatment suggestions: each framework, and each general category. */
const SOURCES: ReadonlyArray<{
  treatments: readonly TreatmentSuggestion[];
  treatmentSource: TreatmentSource;
}> = [...Object.values(AI_FRAMEWORKS), ...GENERAL_CATEGORIES];

/** Every treatment suggested anywhere, by key, so a chosen one is found after a switch. */
const ALL_TREATMENTS = new Map(
  SOURCES.flatMap((p) => p.treatments.map((t) => [t.key, t] as const))
);

export function suggestionByKey(key: unknown) {
  return typeof key === 'string' ? (ALL_TREATMENTS.get(key) ?? null) : null;
}

/** Where a treatment suggestion comes from, whichever framework the organisation follows now. */
export function sourceOfSuggestion(key: unknown): TreatmentSource | null {
  if (typeof key !== 'string') return null;
  return (
    SOURCES.find((p) => p.treatments.some((t) => t.key === key))
      ?.treatmentSource ?? null
  );
}

/**
 * The treatments offered beside a risk, and where they come from: a general
 * category's own, such as Cyber Essentials' for cyber security, or else the
 * organisation's framework's.
 */
export function treatmentsFor(
  category: string | null | undefined,
  pack: AiFrameworkPack
): { treatments: readonly TreatmentSuggestion[]; source: TreatmentSource } {
  const general = generalCategory(category);
  return general
    ? { treatments: general.treatments, source: general.treatmentSource }
    : { treatments: pack.treatments, source: pack.treatmentSource };
}
