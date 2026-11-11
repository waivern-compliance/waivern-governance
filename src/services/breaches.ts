import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  assessments,
  breachDecisions,
  breaches,
  entities,
  referenceCounters,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  clockFor,
  missingContent,
  mostUrgent,
  obligationsFor,
  pecrClockFor,
  pecrObligationsFor,
  reg5aApplies,
  type ControllerRole,
  type RiskLevel
} from '@/lib/breach/statutory';
import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import { isRegime, type Regime } from '@/lib/dpa2018/part3';
import { authorityByCode, isEeaState } from '@/lib/gdpr/authorities';
import {
  authoritiesToNotify,
  type NotifyTarget
} from '@/lib/gdpr/establishment';
import { effectiveLaws } from '@/lib/gdpr/regimes';

import { cleanRecordLaws } from './ropa';
import type { Actor } from './templates';
import {
  assertEntityIn,
  assertMemberOf,
  assertRecordIn
} from './tenancy-guards';

/**
 * The breach register, and the decisions taken about each entry.
 *
 * Article 33(5) requires every breach to be documented, not only the reported
 * ones — so a decision that a breach was not notifiable lives here with its
 * reasoning, rather than being represented by the absence of a notification.
 *
 * Nothing in this file decides anything. It works out which obligations are
 * engaged and how the seventy-two hours stands; a named person records each
 * judgement and why.
 */

export type Breach = typeof breaches.$inferSelect;
export type BreachDecision = typeof breachDecisions.$inferSelect;

/** The risk judgement, read off the decisions a person has recorded. */
function riskFrom(decisions: readonly BreachDecision[]): RiskLevel | null {
  const authority = decisions.find((d) => d.kind === 'supervisory_authority');
  const subjects = decisions.find((d) => d.kind === 'data_subjects');

  // High risk is evidenced by a data-subject decision existing at all: the
  // question is only reached under Article 34(1).
  if (subjects && subjects.outcome !== 'pending') return 'high_risk';
  if (!authority || authority.outcome === 'pending') return null;
  return authority.outcome === 'not_required' ? 'none' : 'risk';
}

export type LoadedBreach = {
  breach: Breach;
  entityName: string;
  ownerEmail: string | null;
  decisions: Array<BreachDecision & { decidedByEmail: string | null }>;
  risk: RiskLevel | null;
  obligations: ReturnType<typeof obligationsFor>;
  /** The most urgent of the authorities' clocks. */
  clock: ReturnType<typeof clockFor>;
  /** The laws the breach falls under: its own, within its entity's. */
  laws: DataProtectionLaw;
  /** Each authority to notify, with its own seventy-two hours. */
  authorityClocks: Array<{
    target: NotifyTarget;
    notified: BreachDecision | null;
    clock: ReturnType<typeof clockFor>;
  }>;
  outstandingContent: ReturnType<typeof missingContent>;
  /** Whether the entity is a public communications provider at all. */
  publicCommsProvider: boolean;
  /** PECR reg 5A, where it applies to this breach. */
  pecr: {
    obligations: ReturnType<typeof pecrObligationsFor>;
    clock: ReturnType<typeof pecrClockFor>;
  } | null;
};

/** The reg 5A clock for a breach, or null where reg 5A does not apply. */
function pecrClockOf(
  breach: Breach,
  provider: boolean,
  decisions: readonly BreachDecision[],
  now: Date
) {
  if (!reg5aApplies({ provider, serviceBreach: breach.pecrServiceBreach }))
    return null;
  const told = decisions.find(
    (d) => d.kind === 'pecr_commissioner' && d.outcome === 'done'
  );
  return pecrClockFor({
    discoveredAt: breach.discoveredAt,
    notifiedAt: told?.completedAt ?? null,
    now
  });
}

/** What `assemble` needs of the entity, selected alongside each breach. */
const ENTITY_LAW = {
  entityLaw: entities.dataProtectionLaw,
  euEstablishments: entities.euEstablishments,
  euMainEstablishment: entities.euMainEstablishment,
  euLeadAuthority: entities.euLeadAuthority
};

type EntityLaw = {
  entityLaw: DataProtectionLaw;
  euEstablishments: string[];
  euMainEstablishment: string | null;
  euLeadAuthority: string | null;
};

/**
 * Whether a notification decision concerns this authority. A decision names
 * its authority; one recorded before that was asked counts where there is only
 * one authority to tell. A placeholder (a German Land not yet chosen) is met
 * by a notification to any authority of its State.
 */
function concerns(
  d: Pick<BreachDecision, 'authorityCode'>,
  t: NotifyTarget,
  only: boolean
): boolean {
  if (!d.authorityCode) return only;
  if (t.code) return d.authorityCode === t.code;
  const a = authorityByCode(d.authorityCode);
  return Boolean(a && a.law === 'eu' && t.country && a.country === t.country);
}

/** The authorities a breach must be notified to, under its laws. */
export function targetsOf(breach: Breach, entity: EntityLaw): NotifyTarget[] {
  return authoritiesToNotify({
    laws: effectiveLaws(entity.entityLaw, breach.laws),
    establishment: entity,
    affectedStates: breach.affectedStates,
    part3: breach.regime === 'dpa_part3'
  });
}

function assemble(
  breach: Breach,
  entityName: string,
  ownerEmail: string | null,
  decisions: Array<BreachDecision & { decidedByEmail: string | null }>,
  provider: boolean,
  entity: EntityLaw,
  now = new Date()
): LoadedBreach {
  const pecrClock = pecrClockOf(breach, provider, decisions, now);
  const risk = riskFrom(decisions);
  const role = breach.controllerRole as ControllerRole;
  // Articles 33 and 34 read the same in both laws, so the risk judgement, and
  // a judgement that notification is not required, is shared by every authority.
  const notRequired = decisions.some(
    (d) => d.kind === 'supervisory_authority' && d.outcome === 'not_required'
  );
  const targets = targetsOf(breach, entity);
  const authorityClocks = targets.map((target) => {
    const notified =
      decisions.find(
        (d) =>
          d.kind === 'supervisory_authority' &&
          d.outcome === 'done' &&
          concerns(d, target, targets.length === 1)
      ) ?? null;
    return {
      target,
      notified,
      clock: clockFor({
        role,
        discoveredAt: breach.discoveredAt,
        notifiedAt: notified?.completedAt ?? null,
        notRequired,
        now,
        regime: breach.regime
      })
    };
  });

  return {
    breach,
    entityName,
    ownerEmail,
    decisions,
    risk,
    obligations: obligationsFor({
      role,
      risk,
      discoveredAt: breach.discoveredAt,
      dataUnintelligible: breach.dataUnintelligible,
      regime: breach.regime,
      authorities: targets
    }),
    clock:
      mostUrgent(authorityClocks.map((c) => c.clock)) ??
      clockFor({
        role,
        discoveredAt: breach.discoveredAt,
        notRequired,
        now,
        regime: breach.regime
      }),
    laws: effectiveLaws(entity.entityLaw, breach.laws),
    authorityClocks,
    outstandingContent: missingContent(breach),
    publicCommsProvider: provider,
    pecr: pecrClock
      ? {
          obligations: pecrObligationsFor({
            discoveredAt: breach.discoveredAt
          }),
          clock: pecrClock
        }
      : null
  };
}

async function nextReference(organisationId: string, year: number) {
  const rows = await db.execute<{ next_value: number | string }>(sql`
    insert into ${referenceCounters} (organisation_id, prefix, year, next_value)
    values (${organisationId}, 'BR', ${year}, 1)
    on conflict (organisation_id, prefix, year)
      do update set next_value = ${referenceCounters}.next_value + 1
    returning next_value
  `);
  return `BR-${year}-${String(Number(rows[0]?.next_value ?? 1)).padStart(4, '0')}`;
}

/** Part 3 only on a competent authority's entity; the default follows the entity. */
async function checkedRegime(
  executor: Pick<typeof db, 'select'>,
  entityId: string,
  regime: string | undefined
): Promise<Regime> {
  const [entity] = await executor
    .select({
      competentAuthority: entities.competentAuthority,
      defaultRegime: entities.defaultRegime
    })
    .from(entities)
    .where(eq(entities.id, entityId));
  const chosen =
    regime ?? (entity?.competentAuthority ? entity.defaultRegime : 'gdpr');
  if (!isRegime(chosen)) throw new Error('Choose the regime.');
  if (chosen === 'dpa_part3' && !entity?.competentAuthority) {
    throw new Error(
      'Part 3 is for a competent authority. Mark the entity as one on the Organisation page first.'
    );
  }
  return chosen;
}

/** The breach's laws, within its entity's; Part 3 only under UK law. */
async function checkedLaws(
  executor: Pick<typeof db, 'select'>,
  entityId: string,
  laws: string | undefined,
  regime: Regime
): Promise<DataProtectionLaw> {
  const [entity] = await executor
    .select({ name: entities.name, law: entities.dataProtectionLaw })
    .from(entities)
    .where(eq(entities.id, entityId));
  return cleanRecordLaws(entity, laws, regime);
}

/** EEA member State codes, upper case, once each; anything else is refused. */
function cleanStates(states: readonly string[]): string[] {
  const codes = [...new Set(states.map((s) => s.trim().toUpperCase()))].filter(
    Boolean
  );
  const unknown = codes.filter((c) => !isEeaState(c));
  if (unknown.length > 0)
    throw new Error(`Not an EEA member State: ${unknown.join(', ')}.`);
  return codes.sort();
}

export async function recordBreach(input: {
  organisationId: string;
  entityId: string;
  title: string;
  description: string;
  controllerRole?: ControllerRole;
  /** When the organisation became aware. Starts the seventy-two hours. */
  discoveredAt: Date;
  occurredAt?: Date | null;
  categories?: string[];
  ownerId?: string | null;
  /** UK GDPR or Part 3; defaults from the entity. */
  regime?: Regime;
  /** Defaults to the entity's law; must be within it. */
  laws?: string;
  /** EEA member States where affected people live. */
  affectedStates?: string[];
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    await assertEntityIn(input.organisationId, input.entityId);
    if (input.ownerId)
      await assertMemberOf(input.organisationId, input.ownerId);
    const regime = await checkedRegime(db, input.entityId, input.regime);
    const laws = await checkedLaws(db, input.entityId, input.laws, regime);
    const affectedStates = cleanStates(input.affectedStates ?? []);
    const reference = await nextReference(
      input.organisationId,
      new Date().getUTCFullYear()
    );

    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(breaches)
        .values({
          organisationId: input.organisationId,
          entityId: input.entityId,
          reference,
          title: input.title,
          description: input.description,
          controllerRole: input.controllerRole ?? 'controller',
          regime,
          laws,
          affectedStates,
          discoveredAt: input.discoveredAt,
          occurredAt: input.occurredAt ?? null,
          categories: input.categories ?? [],
          ownerId: input.ownerId ?? null
        })
        .returning();

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.entityId,
        action: 'breach.recorded',
        subjectType: 'breach',
        subjectId: row.id,
        after: {
          reference,
          discoveredAt: input.discoveredAt.toISOString(),
          role: row.controllerRole,
          laws
        }
      });
      return row;
    });
  });
}

export async function updateBreach(input: {
  breachId: string;
  organisationId: string;
  changes: Partial<{
    title: string;
    description: string;
    controllerRole: string;
    occurredAt: Date | null;
    containedAt: Date | null;
    categories: string[];
    subjectCategories: string[];
    dataCategories: string[];
    subjectsAffected: number | null;
    recordsAffected: number | null;
    specialCategory: boolean | null;
    likelyConsequences: string;
    measuresTaken: string;
    dataUnintelligible: boolean | null;
    pecrServiceBreach: boolean | null;
    status: Breach['status'];
    ownerId: string | null;
    regime: string;
    laws: string;
    affectedStates: string[];
  }>;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    if (input.changes.title !== undefined && !input.changes.title.trim()) {
      throw new Error('Say what happened: a breach needs a title.');
    }
    if (input.changes.ownerId)
      await assertMemberOf(input.organisationId, input.changes.ownerId);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(breaches)
        .where(
          and(
            eq(breaches.id, input.breachId),
            eq(breaches.organisationId, input.organisationId)
          )
        );
      if (!before) throw new Error('No such breach');
      const {
        regime: regimeChange,
        laws: lawsChange,
        affectedStates: statesChange,
        ...rest
      } = input.changes;
      const regime =
        regimeChange !== undefined
          ? await checkedRegime(tx, before.entityId, regimeChange)
          : undefined;
      const laws =
        lawsChange !== undefined || regime !== undefined
          ? await checkedLaws(
              tx,
              before.entityId,
              lawsChange ?? before.laws,
              regime ?? before.regime
            )
          : before.laws;
      const affectedStates =
        statesChange !== undefined
          ? cleanStates(statesChange)
          : before.affectedStates;

      const [after] = await tx
        .update(breaches)
        .set({
          ...rest,
          ...(regime ? { regime } : {}),
          laws,
          affectedStates,
          updatedAt: new Date()
        })
        .where(eq(breaches.id, input.breachId))
        .returning();

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'breach.updated',
        subjectType: 'breach',
        subjectId: input.breachId,
        before: {
          changed: Object.keys(input.changes),
          ...(regime && regime !== before.regime
            ? { regime: before.regime }
            : {}),
          ...(laws !== before.laws ? { laws: before.laws } : {})
        },
        after: {
          reference: after.reference,
          ...(regime && regime !== before.regime ? { regime } : {}),
          ...(laws !== before.laws ? { laws } : {})
        }
      });
      return after;
    });
  });
}

export class RationaleRequired extends Error {
  constructor() {
    super('A breach decision needs its reasoning recorded');
    this.name = 'RationaleRequired';
  }
}

/**
 * Record a decision, statutory or otherwise.
 *
 * Appended rather than updated. A controller that first judged a breach not
 * notifiable and then changed its mind has taken two decisions, and the
 * register should show both — the sequence is the evidence of how the
 * judgement developed.
 */
export async function recordDecision(input: {
  organisationId: string;
  breachId: string;
  kind: BreachDecision['kind'];
  outcome: BreachDecision['outcome'];
  statutoryBasis?: string | null;
  rationale: string;
  recipient?: string | null;
  /** For a supervisory authority decision: which authority. */
  authorityCode?: string | null;
  externalRef?: string | null;
  dueAt?: Date | null;
  completedAt?: Date | null;
  lateReason?: string | null;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    const rationale = input.rationale.trim();
    if (!rationale) throw new RationaleRequired();

    return db.transaction(async (tx) => {
      const [breach] = await tx
        .select()
        .from(breaches)
        .where(
          and(
            eq(breaches.id, input.breachId),
            eq(breaches.organisationId, input.organisationId)
          )
        );
      if (!breach) throw new Error('No such breach');

      // Each authority is its own notification. Where there is more than one
      // to tell, a notification says which; "not required" is a judgement
      // about the risk, so it covers them all.
      const authorityCode =
        input.kind === 'supervisory_authority'
          ? input.authorityCode || null
          : null;
      if (authorityCode && !authorityByCode(authorityCode))
        throw new Error('Choose a supervisory authority from the list.');
      if (
        input.kind === 'supervisory_authority' &&
        input.outcome !== 'not_required' &&
        !authorityCode
      ) {
        const [entity] = await tx
          .select(ENTITY_LAW)
          .from(entities)
          .where(eq(entities.id, breach.entityId));
        if (targetsOf(breach, entity).length > 1)
          throw new Error(
            'This breach is owed to more than one authority. Say which one this decision concerns.'
          );
      }

      const [row] = await tx
        .insert(breachDecisions)
        .values({
          organisationId: input.organisationId,
          breachId: input.breachId,
          kind: input.kind,
          outcome: input.outcome,
          statutoryBasis: input.statutoryBasis ?? null,
          rationale,
          recipient: input.recipient ?? null,
          authorityCode,
          externalRef: input.externalRef ?? null,
          dueAt: input.dueAt ?? null,
          completedAt: input.completedAt ?? null,
          lateReason: input.lateReason ?? null,
          decidedBy: input.actor.actorUserId ?? null,
          decidedByLabel: input.actor.actorLabel
        })
        .returning();

      // Once the authority has been told, under either regime, the breach is
      // past assessment.
      if (
        (input.kind === 'supervisory_authority' ||
          input.kind === 'pecr_commissioner') &&
        input.outcome === 'done'
      ) {
        await tx
          .update(breaches)
          .set({ status: 'notified', updatedAt: new Date() })
          .where(eq(breaches.id, input.breachId));
      }

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: breach.entityId,
        action: 'breach.decision_recorded',
        subjectType: 'breach',
        subjectId: input.breachId,
        after: {
          decision: row.id,
          kind: input.kind,
          outcome: input.outcome,
          basis: input.statutoryBasis ?? null,
          ...(authorityCode ? { authority: authorityCode } : {}),
          // The reasoning goes in the chain, not only the outcome: a regulator
          // asking why will be asking about this sentence.
          rationale
        }
      });
      return row;
    });
  });
}

export async function closeBreach(input: {
  breachId: string;
  organisationId: string;
  rationale: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    const rationale = input.rationale.trim();
    if (!rationale) throw new RationaleRequired();

    return db.transaction(async (tx) => {
      const [breach] = await tx
        .select()
        .from(breaches)
        .where(
          and(
            eq(breaches.id, input.breachId),
            eq(breaches.organisationId, input.organisationId)
          )
        );
      if (!breach) throw new Error('No such breach');

      const [after] = await tx
        .update(breaches)
        .set({
          status: 'closed',
          closedAt: new Date(),
          closureRationale: rationale
        })
        .where(eq(breaches.id, input.breachId))
        .returning();

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: breach.entityId,
        action: 'breach.closed',
        subjectType: 'breach',
        subjectId: input.breachId,
        after: { reference: after.reference, rationale }
      });
      return after;
    });
  });
}

async function decisionsFor(breachIds: string[]) {
  if (breachIds.length === 0) return [];
  return db
    .select({ decision: breachDecisions, decidedByEmail: users.email })
    .from(breachDecisions)
    .leftJoin(users, eq(users.id, breachDecisions.decidedBy))
    .where(inArray(breachDecisions.breachId, breachIds))
    .orderBy(asc(breachDecisions.decidedAt));
}

export async function loadBreach(
  breachId: string,
  organisationId: string
): Promise<
  | (LoadedBreach & {
      competentAuthority: boolean;
      entityLaw: DataProtectionLaw;
    })
  | null
> {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select({
        breach: breaches,
        entityName: entities.name,
        provider: entities.publicCommsProvider,
        competentAuthority: entities.competentAuthority,
        ownerEmail: users.email,
        ...ENTITY_LAW
      })
      .from(breaches)
      .innerJoin(entities, eq(entities.id, breaches.entityId))
      .leftJoin(users, eq(users.id, breaches.ownerId))
      .where(
        and(
          eq(breaches.id, breachId),
          eq(breaches.organisationId, organisationId)
        )
      );
    if (!row) return null;

    const decisions = (await decisionsFor([breachId])).map((d) => ({
      ...d.decision,
      decidedByEmail: d.decidedByEmail
    }));
    return {
      ...assemble(
        row.breach,
        row.entityName,
        row.ownerEmail,
        decisions,
        row.provider,
        row
      ),
      // Whether Part 3 can be chosen for this breach.
      competentAuthority: row.competentAuthority,
      entityLaw: row.entityLaw
    };
  });
}

export async function breachRegister(
  organisationId: string,
  entityIds: string[] | null
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        breach: breaches,
        entityName: entities.name,
        provider: entities.publicCommsProvider,
        ownerEmail: users.email,
        ...ENTITY_LAW
      })
      .from(breaches)
      .innerJoin(entities, eq(entities.id, breaches.entityId))
      .leftJoin(users, eq(users.id, breaches.ownerId))
      .where(
        entityIds === null
          ? eq(breaches.organisationId, organisationId)
          : and(
              eq(breaches.organisationId, organisationId),
              inArray(breaches.entityId, entityIds)
            )
      )
      .orderBy(desc(breaches.discoveredAt));

    const all = await decisionsFor(rows.map((r) => r.breach.id));
    const byBreach = new Map<
      string,
      Array<BreachDecision & { decidedByEmail: string | null }>
    >();
    for (const { decision, decidedByEmail } of all) {
      const list = byBreach.get(decision.breachId) ?? [];
      list.push({ ...decision, decidedByEmail });
      byBreach.set(decision.breachId, list);
    }

    const now = new Date();
    const loaded = rows.map((r) =>
      assemble(
        r.breach,
        r.entityName,
        r.ownerEmail,
        byBreach.get(r.breach.id) ?? [],
        r.provider,
        r,
        now
      )
    );

    return {
      total: loaded.length,
      open: loaded.filter((b) => b.breach.status !== 'closed').length,
      // The number that matters at a glance: a clock running out.
      urgent: loaded.filter((b) =>
        [b.clock.state, b.pecr?.clock.state].some(
          (s) => s === 'overdue' || s === 'due_soon'
        )
      ).length,
      unassessed: loaded.filter(
        (b) => b.risk === null && b.breach.status !== 'closed'
      ).length,
      notified: loaded.filter((b) =>
        b.decisions.some(
          (d) =>
            (d.kind === 'supervisory_authority' ||
              d.kind === 'pecr_commissioner') &&
            d.outcome === 'done'
        )
      ).length,
      rows: loaded
    };
  });
}

/**
 * Breaches whose clock is running out or already past. Used by the sweep.
 *
 * One entry per clock: a provider's breach in providing its service can have
 * the Article 33 and the PECR reg 5A seventy-two hours running side by side.
 */
export async function breachesNeedingAttention(organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const open = await db
      .select({
        breach: breaches,
        entityName: entities.name,
        provider: entities.publicCommsProvider,
        ...ENTITY_LAW
      })
      .from(breaches)
      .innerJoin(entities, eq(entities.id, breaches.entityId))
      .where(
        and(
          eq(breaches.organisationId, organisationId),
          isNull(breaches.closedAt)
        )
      );
    if (open.length === 0) return [];

    const all = await decisionsFor(open.map((o) => o.breach.id));
    const byBreach = new Map<
      string,
      Array<BreachDecision & { decidedByEmail: string | null }>
    >();
    for (const { decision, decidedByEmail } of all) {
      const list = byBreach.get(decision.breachId) ?? [];
      list.push({ ...decision, decidedByEmail });
      byBreach.set(decision.breachId, list);
    }

    const now = new Date();
    return open
      .flatMap((row) => {
        const { breach, entityName, provider } = row;
        const loaded = assemble(
          breach,
          entityName,
          null,
          byBreach.get(breach.id) ?? [],
          provider,
          row,
          now
        );
        // The most urgent authority's clock: one breach owed to two
        // authorities is one item to act on, not two.
        const article33 = {
          breach,
          entityName,
          regime: 'article_33' as const,
          clock: loaded.clock
        };
        return loaded.pecr
          ? [
              article33,
              {
                breach,
                entityName,
                regime: 'pecr_5a' as const,
                clock: loaded.pecr.clock
              }
            ]
          : [article33];
      })
      .filter(
        (b) => b.clock.state === 'overdue' || b.clock.state === 'due_soon'
      );
  });
}

/**
 * Start a severity assessment against a breach, or attach an existing one.
 *
 * Optional by design. A small breach settled in an afternoon does not need a
 * structured assessment, and requiring one would push people to record the
 * breach later — which is the one thing that must not happen, since the
 * seventy-two hours runs from awareness whatever anybody is doing about it.
 *
 * Linking does not decide anything. The assessment's band becomes a suggestion
 * on the breach; the Article 33 and Article 34 decisions remain acts a named
 * person records with their reasoning.
 */
export async function linkAssessment(input: {
  breachId: string;
  organisationId: string;
  assessmentId: string | null;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    return db.transaction(async (tx) => {
      const [breach] = await tx
        .select()
        .from(breaches)
        .where(
          and(
            eq(breaches.id, input.breachId),
            eq(breaches.organisationId, input.organisationId)
          )
        );
      if (!breach) throw new Error('No such breach');
      if (input.assessmentId)
        await assertRecordIn(
          input.organisationId,
          'assessment',
          input.assessmentId,
          tx
        );

      await tx
        .update(breaches)
        .set({
          assessmentId: input.assessmentId,
          // Recording an assessment is the act of assessing, so the status
          // follows unless it has already moved past that.
          ...(input.assessmentId && breach.status === 'discovered'
            ? { status: 'assessing' as const }
            : {}),
          updatedAt: new Date()
        })
        .where(eq(breaches.id, input.breachId));

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: breach.entityId,
        action: input.assessmentId
          ? 'breach.assessment_linked'
          : 'breach.assessment_unlinked',
        subjectType: 'breach',
        subjectId: input.breachId,
        after: { assessment: input.assessmentId }
      });
    });
  });
}

/**
 * What a linked severity assessment suggests, if there is one.
 *
 * Read from the assessment's own scoring rather than copied onto the breach: a
 * copy drifts from the judgement somebody signed, and the band is meaningful
 * only alongside the answers that produced it.
 */
export async function severitySuggestion(breach: Breach) {
  if (!breach.assessmentId) return null;

  const [row] = await db
    .select({
      reference: assessments.reference,
      status: assessments.status,
      band: assessments.scoreBand,
      tier: assessments.scoreTier,
      score: assessments.scoreValue
    })
    .from(assessments)
    .where(
      and(
        eq(assessments.id, breach.assessmentId),
        eq(assessments.organisationId, breach.organisationId)
      )
    );
  if (!row) return null;

  // The band maps onto the statutory questions, but only as a proposal.
  const suggests: RiskLevel | null =
    row.tier === null
      ? null
      : row.tier === 'low'
        ? 'none'
        : row.tier === 'medium'
          ? 'risk'
          : 'high_risk';

  return { ...row, suggests };
}
