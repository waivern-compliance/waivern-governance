import {
  and,
  count,
  countDistinct,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql
} from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  aiIncidents,
  aiUseCaseRequests,
  aiUseCases,
  assessments,
  dpas,
  entities,
  frameworkProfileItems,
  memberships,
  processingActivities,
  riskAppetites,
  suppliers,
  tasks,
  templates,
  templateVersions
} from '@/db/schema';
import {
  PROGRAMME_STEPS,
  type Programme,
  type Stage,
  type Step
} from '@/lib/guidance/steps';
import { requireSession } from '@/lib/session';

import { OPEN as OPEN_INCIDENTS } from './ai-incidents';
import { programmeScope, type ProgrammeScope } from './programme-scope';
import { EXPIRING_WITHIN_DAYS } from './third-party';

/**
 * The guide, and how far through it this organisation actually is.
 *
 * Progress is measured, never remembered. A checklist that stores its own
 * ticks tells you what somebody clicked; this reads the registers, so it tells
 * you what exists. That matters because the people this is for are precisely
 * the people who cannot tell whether a step is really finished — and a guide
 * that congratulates them for a box they ticked would be worse than none.
 */

export type Mode = 'off' | Stage;

export type StepState = Step & {
  done: boolean;
  /** What was counted, said in the words of the step rather than as a number. */
  measure: string;
};

export type Guidance = {
  /** Whose steps these are: the privacy programme's, or AI governance alone. */
  programme: Programme;
  /** Whether to show each step's NIST AI RMF function beside it. */
  functions: boolean;
  mode: Mode;
  /** Whether the mode was chosen by this person or derived from the registers. */
  chosen: boolean;
  stage: Stage;
  steps: StepState[];
  remaining: number;
};

/**
 * One count per register.
 *
 * Written as separate typed queries rather than one hand-rolled block of SQL.
 * The first version was the latter, and it silently produced `where  = $1` for
 * the one table whose organisation is reached through a parent — a class of
 * mistake the query builder cannot make.
 */
async function tally(organisationId: string) {
  const now = new Date();
  const horizon = new Date(now.getTime() + EXPIRING_WITHIN_DAYS * 86_400_000);
  const rows = async (query: Promise<Array<{ n: number }>>) =>
    (await query)[0]?.n ?? 0;
  const n = { n: count() };

  const [
    entityCount,
    people,
    published,
    activities,
    supplierCount,
    agreements,
    uncovered,
    untriaged,
    expiring,
    ai,
    all,
    approved,
    scheduled,
    overdueReviews,
    overdueTasks,
    openTasks,
    aiTemplates,
    approvedAppetites,
    aiActive,
    aiWithoutSupplier,
    aiAssessed,
    profileTargets,
    intakeWaiting,
    openIncidents
  ] = await Promise.all([
    rows(
      db
        .select(n)
        .from(entities)
        .where(eq(entities.organisationId, organisationId))
    ),
    rows(
      db
        .select(n)
        .from(memberships)
        .where(eq(memberships.organisationId, organisationId))
    ),
    rows(
      db
        .select(n)
        .from(templateVersions)
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        .where(
          and(
            eq(templates.organisationId, organisationId),
            eq(templateVersions.status, 'published')
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(processingActivities)
        .where(eq(processingActivities.organisationId, organisationId))
    ),
    rows(
      db
        .select(n)
        .from(suppliers)
        .where(eq(suppliers.organisationId, organisationId))
    ),
    rows(
      db
        .select(n)
        .from(dpas)
        .where(
          and(eq(dpas.organisationId, organisationId), isNull(dpas.archivedAt))
        )
    ),
    // A third party with no live agreement is the Article 28 gap this step is
    // really about, so it is counted rather than inferred from two totals.
    rows(
      db
        .select(n)
        .from(suppliers)
        .where(
          and(
            eq(suppliers.organisationId, organisationId),
            notExists(
              db
                .select({ one: sql`1` })
                .from(dpas)
                .where(
                  and(
                    eq(dpas.supplierId, suppliers.id),
                    isNull(dpas.archivedAt)
                  )
                )
            )
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(suppliers)
        .where(
          and(
            eq(suppliers.organisationId, organisationId),
            isNotNull(suppliers.sourceConnectionId),
            isNull(suppliers.reviewedAt)
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(dpas)
        .where(
          and(
            eq(dpas.organisationId, organisationId),
            isNull(dpas.archivedAt),
            isNotNull(dpas.expiresAt),
            lte(dpas.expiresAt, horizon)
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(aiUseCases)
        .where(eq(aiUseCases.organisationId, organisationId))
    ),
    rows(
      db
        .select(n)
        .from(assessments)
        .where(eq(assessments.organisationId, organisationId))
    ),
    rows(
      db
        .select(n)
        .from(assessments)
        .where(
          and(
            eq(assessments.organisationId, organisationId),
            eq(assessments.status, 'approved')
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(assessments)
        .where(
          and(
            eq(assessments.organisationId, organisationId),
            eq(assessments.status, 'approved'),
            isNotNull(assessments.reviewDueAt)
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(assessments)
        .where(
          and(
            eq(assessments.organisationId, organisationId),
            eq(assessments.status, 'approved'),
            lt(assessments.reviewDueAt, now)
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(tasks)
        .where(
          and(
            eq(tasks.organisationId, organisationId),
            ne(tasks.status, 'done'),
            lt(tasks.dueAt, now)
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(tasks)
        .where(
          and(
            eq(tasks.organisationId, organisationId),
            ne(tasks.status, 'done')
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(templateVersions)
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        .where(
          and(
            eq(templates.organisationId, organisationId),
            eq(templates.kind, 'ai_risk'),
            eq(templateVersions.status, 'published')
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(riskAppetites)
        .where(
          and(
            eq(riskAppetites.organisationId, organisationId),
            eq(riskAppetites.status, 'approved')
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(aiUseCases)
        .where(
          and(
            eq(aiUseCases.organisationId, organisationId),
            ne(aiUseCases.lifecycleStage, 'retired')
          )
        )
    ),
    // The register's own rule for a bought-in system (`suppliedByThirdParty`).
    rows(
      db
        .select(n)
        .from(aiUseCases)
        .where(
          and(
            eq(aiUseCases.organisationId, organisationId),
            ne(aiUseCases.lifecycleStage, 'retired'),
            isNull(aiUseCases.supplierId),
            or(
              inArray(aiUseCases.provenance, [
                'third_party_api',
                'embedded_vendor'
              ]),
              inArray(aiUseCases.deploymentPattern, [
                'public_web_app',
                'embedded',
                'public_api'
              ])
            )
          )
        )
    ),
    rows(
      db
        .select({ n: countDistinct(assessments.subjectId) })
        .from(assessments)
        .innerJoin(
          templateVersions,
          eq(templateVersions.id, assessments.templateVersionId)
        )
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        // Retired systems need nothing, as on the register, so they count on
        // neither side of "every system has an approved assessment".
        .innerJoin(aiUseCases, eq(aiUseCases.id, assessments.subjectId))
        .where(
          and(
            eq(assessments.organisationId, organisationId),
            eq(assessments.subjectType, 'ai_use_case'),
            eq(assessments.status, 'approved'),
            eq(templates.kind, 'ai_risk'),
            ne(aiUseCases.lifecycleStage, 'retired')
          )
        )
    ),
    db
      .select({ code: frameworkProfileItems.code })
      .from(frameworkProfileItems)
      .where(
        and(
          eq(frameworkProfileItems.organisationId, organisationId),
          eq(frameworkProfileItems.framework, 'nist_ai_rmf'),
          isNotNull(frameworkProfileItems.targetStatus)
        )
      ),
    rows(
      db
        .select(n)
        .from(aiUseCaseRequests)
        .where(
          and(
            eq(aiUseCaseRequests.organisationId, organisationId),
            eq(aiUseCaseRequests.status, 'submitted')
          )
        )
    ),
    rows(
      db
        .select(n)
        .from(aiIncidents)
        .where(
          and(
            eq(aiIncidents.organisationId, organisationId),
            inArray(aiIncidents.status, OPEN_INCIDENTS)
          )
        )
    )
  ]);

  return {
    entities: entityCount,
    people,
    published,
    activities,
    suppliers: supplierCount,
    agreements,
    uncovered,
    untriaged,
    expiring,
    ai,
    assessments: all,
    approved,
    scheduled,
    overdueReviews,
    overdueTasks,
    openTasks,
    aiTemplates,
    approvedAppetites,
    aiWithoutSupplier,
    aiActive,
    aiAssessed,
    // Functions with at least one target set: "GOVERN 1.1" files under GOVERN.
    functionsTargeted: new Set(profileTargets.map((r) => r.code.split(' ')[0]))
      .size,
    intakeWaiting,
    openIncidents
  };
}

type Tally = Awaited<ReturnType<typeof tally>>;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Whether each step is finished, and the sentence that says why.
 *
 * The measure is always a fact about the registers, phrased so somebody can
 * check it themselves. "3 activities recorded" invites a look; "step complete"
 * invites trust the platform has not earned.
 */
function measure(step: Step, t: Tally): { done: boolean; measure: string } {
  switch (step.id) {
    case 'entities':
      return {
        done: t.entities > 0,
        measure: `${plural(t.entities, 'entity', 'entities')} recorded`
      };
    case 'people':
      return {
        done: t.people > 1,
        measure: `${plural(t.people, 'person', 'people')} with access`
      };
    case 'templates':
      return {
        done: t.published > 0,
        measure: `${plural(t.published, 'template')} published`
      };
    case 'activities':
      return {
        done: t.activities > 0,
        measure: `${plural(t.activities, 'activity', 'activities')} recorded`
      };
    case 'third-parties':
      return {
        done: t.suppliers > 0 && t.uncovered === 0,
        measure:
          t.suppliers === 0
            ? 'no third parties recorded'
            : `${plural(t.suppliers, 'third party', 'third parties')}, ${t.uncovered} without an agreement`
      };
    case 'ai':
      return {
        done: t.ai > 0,
        measure: `${plural(t.ai, 'AI system')} recorded`
      };
    case 'assessments':
      return {
        done: t.approved > 0,
        measure: `${plural(t.assessments, 'assessment')}, ${t.approved} approved`
      };
    case 'reviews':
      return {
        done: t.approved > 0 && t.scheduled === t.approved,
        measure:
          t.approved === 0
            ? 'nothing approved yet'
            : `${t.scheduled} of ${plural(t.approved, 'approved assessment')} have a review date`
      };

    case 'tasks':
      return {
        done: t.overdueTasks === 0,
        measure: `${plural(t.openTasks, 'open task')}, ${t.overdueTasks} overdue`
      };
    case 'due-reviews':
      return {
        done: t.overdueReviews === 0,
        measure: `${plural(t.overdueReviews, 'assessment')} past a review date`
      };
    case 'expiring':
      return {
        done: t.expiring === 0,
        measure: `${plural(t.expiring, 'agreement')} expiring within six months`
      };
    case 'untriaged':
      return {
        done: t.untriaged === 0,
        measure: `${plural(t.untriaged, 'third party', 'third parties')} never reviewed`
      };
    case 'records-current':
      return {
        done: t.activities > 0,
        measure: `${plural(t.activities, 'activity', 'activities')} recorded`
      };
    case 'risks':
      // Deliberately never marked done: "no open risk" is a snapshot, and a
      // tick would suggest risk work is a thing you finish.
      return {
        done: false,
        measure: 'an ongoing judgement, not a box to tick'
      };
    case 'breach':
    case 'requests':
    case 'complaints':
      return { done: false, measure: 'read it before you need it' };
    case 'cookies':
      return { done: false, measure: 'kept current as the sites change' };
    case 'marketing':
      return {
        done: false,
        measure: 'kept current as campaigns start and stop'
      };
    case 'evidence':
    case 'ai-evidence':
      return { done: false, measure: 'worth doing before somebody asks' };

    case 'ai-entities':
      return {
        done: t.entities > 0,
        measure: `${plural(t.entities, 'entity', 'entities')} recorded`
      };
    case 'ai-people':
      return {
        done: t.people > 1,
        measure: `${plural(t.people, 'person', 'people')} with access`
      };
    case 'ai-appetite':
      return {
        done: t.approvedAppetites > 0,
        measure: `${plural(t.approvedAppetites, 'appetite statement')} approved`
      };
    case 'ai-templates':
      return {
        done: t.aiTemplates > 0,
        measure: `${plural(t.aiTemplates, 'AI template')} published`
      };
    case 'ai-register':
      return {
        done: t.ai > 0,
        measure: `${plural(t.ai, 'AI system')} recorded`
      };
    case 'ai-suppliers':
      return {
        done: t.ai > 0 && t.aiWithoutSupplier === 0,
        measure:
          t.ai === 0
            ? 'no AI systems recorded'
            : `${plural(t.aiWithoutSupplier, 'bought-in system')} without a supplier`
      };
    case 'ai-assessments':
      return {
        done: t.aiActive > 0 && t.aiAssessed >= t.aiActive,
        measure: `${t.aiAssessed} of ${plural(t.aiActive, 'system')} in use with an approved assessment`
      };
    case 'ai-profile':
      return {
        done: t.functionsTargeted === 4,
        measure: `targets set in ${t.functionsTargeted} of 4 functions`
      };
    case 'ai-intake':
      return {
        done: t.intakeWaiting === 0,
        measure: `${plural(t.intakeWaiting, 'proposal')} waiting for a decision`
      };
    case 'ai-changes':
    case 'ai-testing':
      return { done: false, measure: 'the register flags what is outstanding' };
    case 'ai-incidents':
      return {
        done: t.openIncidents === 0,
        measure: `${plural(t.openIncidents, 'open incident')}`
      };
    case 'ai-reviews':
      return {
        done: t.overdueReviews === 0,
        measure: `${plural(t.overdueReviews, 'assessment')} past a review date`
      };
    default:
      return { done: false, measure: '' };
  }
}

/**
 * Which stage an organisation is in, when nobody has said.
 *
 * Derived from whether the registers hold anything, rather than asked. A new
 * organisation should be guided without somebody first discovering that a
 * guide exists.
 */
export function derivedStage(
  t: Pick<Tally, 'activities' | 'approved'> &
    Partial<Pick<Tally, 'ai' | 'aiAssessed'>>,
  programme: Programme = 'privacy'
): Stage {
  // AI governance alone keeps no processing register, so its stage is read
  // from the AI register instead, or it would never leave setting up.
  if (programme === 'ai')
    return (t.ai ?? 0) > 0 && (t.aiAssessed ?? 0) > 0 ? 'maintain' : 'setup';
  return t.activities > 0 && t.approved > 0 ? 'maintain' : 'setup';
}

export async function guidanceFor(input: {
  organisationId: string;
  chosen: Mode | null;
  /** Passed by a page that has already worked it out. */
  scope?: ProgrammeScope;
}): Promise<Guidance> {
  return withOrganisation(input.organisationId, async () => {
    const [t, scope] = await Promise.all([
      tally(input.organisationId),
      input.scope ?? programmeScope(input.organisationId)
    ]);
    // An organisation with any entity under data protection law is guided
    // through the privacy programme, which has AI in it; one with none is
    // guided through AI governance alone.
    const programme: Programme = scope.privacy ? 'privacy' : 'ai';
    const nist = scope.aiFramework === 'nist_ai_rmf';
    const stage =
      input.chosen && input.chosen !== 'off'
        ? input.chosen
        : derivedStage(t, programme);
    const steps = PROGRAMME_STEPS[programme][stage]
      .filter((step) => scope.ukLaw || !step.ukLaw)
      .filter((step) => scope.eprivacy || !step.eprivacy)
      .filter((step) => nist || !step.nist)
      .map((step) => ({ ...step, ...measure(step, t) }));

    return {
      programme,
      functions: programme === 'ai' && nist,
      mode: input.chosen ?? stage,
      chosen: input.chosen !== null,
      stage,
      steps,
      remaining: steps.filter((s) => !s.done).length
    };
  });
}

/** A person's own choice. Grants nothing, so it needs no capability. */
export async function setOwnGuidance(mode: Mode) {
  if (!['off', 'setup', 'maintain'].includes(mode))
    throw new Error('No such guidance mode');
  const active = await requireSession();

  await db
    .update(memberships)
    .set({ guidance: mode })
    .where(
      and(
        eq(memberships.organisationId, active.membership.organisationId),
        eq(memberships.userId, active.userId)
      )
    );
}
