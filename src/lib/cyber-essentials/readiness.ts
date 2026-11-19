import type { assessmentStatus } from '@/db/schema/enums';
import type {
  RequirementOutcome,
  RequirementStatus
} from '@/lib/templates/requirements';
import type { TemplateDefinition } from '@/lib/templates/schema';

import {
  CE_EDITIONS,
  isAutoFail,
  requirementsOf,
  scopeRulesOf
} from './editions';
import { CE_THEMES } from './requirements';
import type { CeEditionId, CeThemeId } from './types';

/**
 * A scope's status per requirement, read from its latest submitted readiness
 * assessment (decision 2). Not stored anywhere: the answers are versioned and
 * pinned to the template they were given against, so reading them again
 * always gives the status they said.
 *
 * `not_asked` is a requirement of the edition that no question in the
 * template tested, so nothing is known about it either way.
 */
export type ReadinessStatus = RequirementStatus | 'not_asked';

export const READINESS_STATUS_LABEL: Record<ReadinessStatus, string> = {
  met: 'Met',
  not_met: 'Not met',
  not_applicable: 'Not applicable',
  unknown: 'Not answered',
  not_asked: 'Not asked'
};

const FRAMEWORK = 'cyber_essentials:';

/** What a readiness template's scoring names as the edition it asks against. */
export function readinessFramework(edition: CeEditionId): string {
  return `${FRAMEWORK}${edition}`;
}

/**
 * The edition a readiness template asks against, or null for a template that
 * tests no Cyber Essentials edition. A scope is assessed only with a template
 * of its own edition, and an assessment is read against the edition it was
 * answered for, even if the scope has moved on since.
 */
export function editionAnswered(
  definition: TemplateDefinition
): CeEditionId | null {
  const { scoring } = definition;
  if (scoring.method !== 'requirements') return null;
  if (!scoring.framework.startsWith(FRAMEWORK)) return null;
  const id = scoring.framework.slice(FRAMEWORK.length);
  return CE_EDITIONS.find((e) => e.id === id)?.id ?? null;
}

type AssessmentStatus = (typeof assessmentStatus.enumValues)[number];

/**
 * Where a submitted readiness assessment stands with the board or director
 * who signs it off. Its answers say the same either way; who has accepted
 * them does not.
 */
export const SIGN_OFF: Partial<Record<AssessmentStatus, string>> = {
  in_review: 'awaiting sign-off',
  returned: 'returned for more work',
  approved: 'signed off',
  rejected: 'rejected at sign-off',
  superseded: 'since reassessed'
};

export type ReadinessRow = {
  code: string;
  summary: string;
  page: number;
  status: ReadinessStatus;
  /** The edition fails the whole assessment on this requirement. */
  autoFail: boolean;
  questions: RequirementOutcome['questions'];
};

export type ReadinessGroup = {
  id: CeThemeId | 'scope';
  label: string;
  rows: ReadinessRow[];
};

export type Readiness = {
  groups: ReadinessGroup[];
  counts: Record<ReadinessStatus, number>;
  /** A question that fails the whole assessment was not met. */
  autoFailed: boolean;
};

/** The edition's scope rules, then each theme's requirements, with their status. */
export function readinessOf(
  edition: CeEditionId,
  outcomes: readonly RequirementOutcome[]
): Readiness {
  const byCode = new Map(outcomes.map((o) => [o.code, o]));
  const row = (r: {
    code: string;
    summary: string;
    pages: Partial<Record<CeEditionId, number>>;
  }): ReadinessRow => {
    const outcome = byCode.get(r.code);
    return {
      code: r.code,
      summary: r.summary,
      page: r.pages[edition]!,
      status: outcome?.status ?? 'not_asked',
      autoFail: isAutoFail(edition, r.code),
      questions: outcome?.questions ?? []
    };
  };
  const requirements = requirementsOf(edition);
  const groups: ReadinessGroup[] = [
    { id: 'scope', label: 'Scope', rows: scopeRulesOf(edition).map(row) },
    ...CE_THEMES.map((t) => ({
      id: t.id,
      label: t.label,
      rows: requirements.filter((r) => r.theme === t.id).map(row)
    }))
  ];
  const counts: Record<ReadinessStatus, number> = {
    met: 0,
    not_met: 0,
    not_applicable: 0,
    unknown: 0,
    not_asked: 0
  };
  for (const r of groups.flatMap((g) => g.rows)) counts[r.status] += 1;
  return {
    groups,
    counts,
    // As the assessment's own outcome decided it, from its questions.
    autoFailed: outcomes.some((o) => o.autoFailed)
  };
}

/** The counts in words, naming the requirements nothing is known about too. */
export function countsSummary(counts: Readiness['counts']): string {
  return [
    `${counts.met} met`,
    `${counts.not_met} not met`,
    `${counts.not_applicable} not applicable`,
    counts.unknown ? `${counts.unknown} not answered` : null,
    counts.not_asked ? `${counts.not_asked} not asked by the template` : null
  ]
    .filter(Boolean)
    .join(', ');
}
