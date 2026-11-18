import { CE_REQUIREMENTS } from './requirements';
import { CE_SCOPE_RULES } from './scope';
import type {
  CeEdition,
  CeEditionId,
  CeRequirement,
  CeScopeRule
} from './types';

/**
 * Each edition of the requirements and the question set that goes with it.
 *
 * NCSC and IASME review the scheme every year: the requirements get a new
 * version number and the question set a new name. Adding an edition is a code
 * change here, a page for each requirement in `requirements.ts`, and a
 * crosswalk entry; nothing in the database changes shape.
 *
 * `effectiveFrom` is the first day new assessment accounts use the edition.
 * Accounts opened before it had six months to finish on the previous one
 * (IASME, "Changes to Cyber Essentials for April 2026", 12 February 2026).
 */
export const CE_EDITIONS: readonly CeEdition[] = [
  {
    id: 'v3.2',
    questionSet: 'Willow',
    effectiveFrom: '2025-04-28',
    plusSpecification: 'v3.2',
    requirementsUrl:
      'https://www.ncsc.gov.uk/files/cyber-essentials-requirements-for-it-infrastructure-v3-2.pdf',
    autoFail: []
  },
  {
    id: 'v3.3',
    questionSet: 'Danzell',
    effectiveFrom: '2026-04-27',
    // NCSC published no v3.3 Plus test specification; IASME still points
    // Danzell assessments at v3.2.
    plusSpecification: 'v3.2',
    requirementsUrl:
      'https://www.ncsc.gov.uk/files/cyber-essentials-requirements-for-it-infrastructure-v3-3.pdf',
    // Danzell marks the 14-day patching questions as automatic fails, and IASME
    // marks a cloud service without MFA, where MFA is available, the same way.
    autoFail: [
      { code: 'SUM.CRITICAL_14_DAYS', questions: ['A6.4', 'A6.5'] },
      { code: 'UAC.MFA_CLOUD', questions: ['A7.16', 'A7.17'] }
    ]
  }
];

export const CE_PLUS_SPECIFICATION_URL =
  'https://www.ncsc.gov.uk/sites/default/files/2026-05/cyber-essentials-plus-test-specification-v3-2%20english.pdf';

const BY_ID = new Map(CE_EDITIONS.map((e) => [e.id, e]));

export function ceEdition(id: CeEditionId): CeEdition {
  const edition = BY_ID.get(id);
  if (!edition) throw new Error(`Unknown Cyber Essentials edition: ${id}`);
  return edition;
}

/** The edition a new assessment account opened on `at` would use. */
export function editionInForce(at: Date): CeEdition {
  const day = at.toISOString().slice(0, 10);
  const started = CE_EDITIONS.filter((e) => e.effectiveFrom <= day);
  return started.at(-1) ?? CE_EDITIONS[0];
}

/** The requirements an edition holds, in the order NCSC sets them out. */
export function requirementsOf(id: CeEditionId): CeRequirement[] {
  return CE_REQUIREMENTS.filter((r) => r.pages[id] !== undefined);
}

/** The scope rules an edition holds. */
export function scopeRulesOf(id: CeEditionId): CeScopeRule[] {
  return CE_SCOPE_RULES.filter((r) => r.pages[id] !== undefined);
}

/** Whether failing this requirement fails the whole assessment in this edition. */
export function isAutoFail(id: CeEditionId, code: string): boolean {
  return ceEdition(id).autoFail.some((a) => a.code === code);
}
