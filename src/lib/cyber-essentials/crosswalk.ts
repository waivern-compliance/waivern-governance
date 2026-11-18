import { CE_REQUIREMENTS } from './requirements';
import { CE_SCOPE_RULES } from './scope';
import type { CeEditionId } from './types';

/**
 * How a requirement in one edition carries into the next.
 *
 * Codes stay the same while a requirement means the same thing, so most of the
 * crosswalk is implicit: a code held by both editions carries straight across.
 * `RENAMED` is for a requirement whose code changes because its meaning was
 * split or merged; `CHANGED` names the codes whose wording moved between two
 * editions, so whoever answered against the old wording looks again.
 */
type Step = `${CeEditionId}>${CeEditionId}`;

const RENAMED: Partial<Record<Step, Readonly<Record<string, string>>>> = {
  // v3.3 changed no requirement codes.
  'v3.2>v3.3': {}
};

const CHANGED: Partial<Record<Step, readonly string[]>> = {
  // Scope wording only; the technical requirements were unchanged.
  'v3.2>v3.3': [
    'SCOPE.SUBSET_SEGREGATED',
    'SCOPE.INTERNET_CONNECTED',
    'SCOPE.CLOUD_INCLUDED',
    'SCOPE.WEB_APPLICATIONS'
  ]
};

const inEdition = (code: string, edition: CeEditionId) =>
  [...CE_REQUIREMENTS, ...CE_SCOPE_RULES].some(
    (r) => r.code === code && r.pages[edition] !== undefined
  );

/**
 * The code a requirement has in a later edition, or null if that edition
 * dropped it.
 */
export function carryForward(
  code: string,
  from: CeEditionId,
  to: CeEditionId
): string | null {
  const next = RENAMED[`${from}>${to}`]?.[code] ?? code;
  return inEdition(next, to) ? next : null;
}

/** Whether the requirement's wording changed between two editions. */
export function changedBetween(
  code: string,
  from: CeEditionId,
  to: CeEditionId
): boolean {
  return CHANGED[`${from}>${to}`]?.includes(code) ?? false;
}
