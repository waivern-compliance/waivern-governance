import { CE_EDITIONS } from './editions';
import { ceRequirement } from './requirements';
import type { CeEditionId, CeRequirement } from './types';

/**
 * A mitigation's `control_ref` naming a Cyber Essentials requirement:
 * `ce:v3.3:UAC.MFA_CLOUD`.
 *
 * `control_ref` stays free text, because it also holds references into an
 * organisation's own control framework and values brought in by an import.
 * This only recognises the ones that point at Cyber Essentials, so Govern can
 * show the requirement beside the mitigation.
 */
const PREFIX = 'ce';

export function formatControlRef(edition: CeEditionId, code: string): string {
  return `${PREFIX}:${edition}:${code}`;
}

export type CeControlRef = {
  edition: CeEditionId;
  requirement: CeRequirement;
};

/** The requirement a control reference names, or null if it names something else. */
export function parseControlRef(
  ref: string | null | undefined
): CeControlRef | null {
  const match = /^ce:(v\d+\.\d+):([A-Z]+\.[A-Z0-9_]+)$/.exec(ref?.trim() ?? '');
  if (!match) return null;
  const edition = CE_EDITIONS.find((e) => e.id === match[1]);
  const requirement = ceRequirement(match[2]);
  if (!edition || requirement?.pages[edition.id] === undefined) return null;
  return { edition: edition.id, requirement };
}

/**
 * What a mitigation shows beside a control reference that names a Cyber
 * Essentials requirement: the requirement in words, and where to read it.
 */
export function describeControlRef(
  ref: string | null | undefined
): { text: string; href: string } | null {
  const parsed = parseControlRef(ref);
  if (!parsed) return null;
  return {
    text: `Cyber Essentials ${parsed.edition}: ${parsed.requirement.summary}`,
    href: `/app/cyber-essentials/requirements?edition=${parsed.edition}#${parsed.requirement.code}`
  };
}
