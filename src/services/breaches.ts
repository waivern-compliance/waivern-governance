import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  assessments,
  breachDecisions,
  breaches,
  entities,
  tasks,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  clockFor,
  clockStart,
  isBreachClassification,
  missingContent,
  mostUrgent,
  obligationsFor,
  pecrClockFor,
  pecrObligationsFor,
  reg5aApplies,
  type BreachClassification,
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
import { nextReference } from '@/lib/references';

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
  breach: Pick<
    Breach,
    'classification' | 'discoveredAt' | 'awareAt' | 'pecrServiceBreach'
  >,
  provider: boolean,
  decisions: ReadonlyArray<
    Pick<BreachDecision, 'kind' | 'outcome' | 'completedAt'>
  >,
  now: Date
) {
  if (
    breach.classification === 'near_miss' ||
    !reg5aApplies({ provider, serviceBreach: breach.pecrServiceBreach })
  )
    return null;
  const told = decisions.find(
    (d) => d.kind === 'pecr_commissioner' && d.outcome === 'done'
  );
  return pecrClockFor({
    discoveredAt: clockStart(breach),
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

export type EntityLaw = {
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
export function concerns(
  d: Pick<BreachDecision, 'authorityCode'>,
  t: NotifyTarget,
  only: boolean
): boolean {
  if (!d.authorityCode) return only;
  if (t.code) return d.authorityCode === t.code;
  // A placeholder: met by an EU authority of its State, or, where the State
  // is not known either (a lead authority not yet recorded, no affected
  // States ticked), by the EU authority the person chose.
  const a = authorityByCode(d.authorityCode);
  if (!a || a.law !== 'eu' || t.law !== 'eu') return false;
  return t.country ? a.country === t.country : true;
}

/** Whether every authority owed a notification has had one. */
export function everyAuthorityTold(
  targets: readonly NotifyTarget[],
  decisions: ReadonlyArray<
    Pick<BreachDecision, 'kind' | 'outcome' | 'authorityCode'>
  >
): boolean {
  return targets.every((t) =>
    decisions.some(
      (d) =>
        d.kind === 'supervisory_authority' &&
        d.outcome === 'done' &&
        concerns(d, t, targets.length === 1)
    )
  );
}

/** The authorities a breach must be notified to, under its laws. */
export function targetsOf(
  breach: Pick<Breach, 'laws' | 'affectedStates' | 'regime'>,
  entity: EntityLaw
): NotifyTarget[] {
  return authoritiesToNotify({
    laws: effectiveLaws(entity.entityLaw, breach.laws),
    establishment: entity,
    affectedStates: breach.affectedStates,
    part3: breach.regime === 'dpa_part3'
  });
}

/**
 * Whether any of a breach's clocks, Article 33 to each authority owed or PECR
 * reg 5A, is already past. For a breach brought in from another platform,
 * before it is written: the sweep will raise a task for it at once.
 */
export function anyClockOverdue(input: {
  breach: Pick<
    Breach,
    | 'classification'
    | 'controllerRole'
    | 'discoveredAt'
    | 'awareAt'
    | 'regime'
    | 'pecrServiceBreach'
  >;
  decisions: ReadonlyArray<
    Pick<BreachDecision, 'kind' | 'outcome' | 'authorityCode' | 'completedAt'>
  >;
  /** The authorities it is owed to, from {@link targetsOf}. */
  targets: readonly NotifyTarget[];
  provider: boolean;
  now: Date;
}): boolean {
  const { breach, decisions, targets, now } = input;
  if (breach.classification === 'near_miss') return false;
  const notRequired = decisions.some(
    (d) => d.kind === 'supervisory_authority' && d.outcome === 'not_required'
  );
  const clock = (notifiedAt: Date | null) =>
    clockFor({
      role: breach.controllerRole as ControllerRole,
      discoveredAt: clockStart(breach),
      notifiedAt,
      notRequired,
      now,
      regime: breach.regime
    });
  const clocks = targets.length
    ? targets.map((t) =>
        clock(
          decisions.find(
            (d) =>
              d.kind === 'supervisory_authority' &&
              d.outcome === 'done' &&
              concerns(d, t, targets.length === 1)
          )?.completedAt ?? null
        )
      )
    : [clock(null)];
  const pecr = pecrClockOf(breach, input.provider, decisions, now);
  return [...clocks, pecr].some((c) => c?.state === 'overdue');
}

/** A near miss compromised no personal data, so no clock runs. */
const NEAR_MISS_CLOCK = {
  state: 'not_applicable',
  words:
    'A near miss: no personal data was compromised, so nobody is owed a notification'
} as const;

/**
 * The notifications only a breach can owe. A near miss may still be reported
 * to an insurer or another organisation, as anything worth telling them.
 */
const STATUTORY_KINDS: ReadonlyArray<BreachDecision['kind']> = [
  'supervisory_authority',
  'data_subjects',
  'processor_to_controller',
  'pecr_commissioner',
  'pecr_subscribers'
];

function assemble(
  breach: Breach,
  entityName: string,
  ownerEmail: string | null,
  decisions: Array<BreachDecision & { decidedByEmail: string | null }>,
  provider: boolean,
  entity: EntityLaw,
  now = new Date()
): LoadedBreach {
  if (breach.classification === 'near_miss')
    return {
      breach,
      entityName,
      ownerEmail,
      decisions,
      risk: null,
      obligations: [],
      clock: NEAR_MISS_CLOCK,
      laws: effectiveLaws(entity.entityLaw, breach.laws),
      authorityClocks: [],
      outstandingContent: [],
      publicCommsProvider: provider,
      pecr: null
    };
  const started = clockStart(breach);
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
        discoveredAt: started,
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
      discoveredAt: started,
      dataUnintelligible: breach.dataUnintelligible,
      regime: breach.regime,
      authorities: targets
    }),
    clock:
      mostUrgent(authorityClocks.map((c) => c.clock)) ??
      clockFor({
        role,
        discoveredAt: started,
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
          obligations: pecrObligationsFor({ discoveredAt: started }),
          clock: pecrClock
        }
      : null
  };
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
  /** A breach unless said otherwise. */
  classification?: BreachClassification;
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
    const classification = input.classification ?? 'breach';
    if (!isBreachClassification(classification))
      throw new Error('Say whether it is a breach or a near miss.');
    const regime = await checkedRegime(db, input.entityId, input.regime);
    const laws = await checkedLaws(db, input.entityId, input.laws, regime);
    const affectedStates = cleanStates(input.affectedStates ?? []);
    const reference = await nextReference(
      db,
      input.organisationId,
      'BR',
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
          classification,
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
          classification,
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
      if (
        breach.classification === 'near_miss' &&
        STATUTORY_KINDS.includes(input.kind)
      )
        throw new Error(
          'A near miss owes no notification. If personal data was compromised after all, reclassify it as a breach first.'
        );

      // Each authority is its own notification. Where there is more than one
      // to tell, a notification says which, and it must be one the breach's
      // laws owe. Anything short of a notification ("not required", "still
      // deciding") is a judgement about the breach, so it may cover them all.
      const authorityCode =
        input.kind === 'supervisory_authority'
          ? input.authorityCode || null
          : null;
      if (authorityCode && !authorityByCode(authorityCode))
        throw new Error('Choose a supervisory authority from the list.');
      const [entity] = await tx
        .select(ENTITY_LAW)
        .from(entities)
        .where(eq(entities.id, breach.entityId));
      const targets = targetsOf(breach, entity);
      if (input.kind === 'supervisory_authority') {
        if (input.outcome === 'done' && !authorityCode && targets.length > 1)
          throw new Error(
            'This breach is owed to more than one authority. Say which one it was notified to.'
          );
        if (
          authorityCode &&
          !targets.some((t) => concerns({ authorityCode }, t, false))
        )
          throw new Error(
            "That authority is not one this breach is owed to under its laws. Check the breach's laws and affected States."
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

      // Once the authorities have been told, under either regime, the breach
      // is past assessment: every one owed, under each of its laws, or the
      // Commissioner under PECR.
      const told =
        input.outcome === 'done' &&
        (input.kind === 'pecr_commissioner' ||
          (input.kind === 'supervisory_authority' &&
            // Read after the insert, so this decision is among them.
            everyAuthorityTold(
              targets,
              await tx
                .select({
                  kind: breachDecisions.kind,
                  outcome: breachDecisions.outcome,
                  authorityCode: breachDecisions.authorityCode
                })
                .from(breachDecisions)
                .where(eq(breachDecisions.breachId, input.breachId))
            )));
      if (told) {
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

/**
 * Change a breach to a near miss, or back, with the reasoning.
 *
 * A near miss found to be a breach starts its seventy-two hours on awareness
 * of that. Regulators are likely to count from the original discovery, where
 * the facts were there to be seen, so that is the default and a later date
 * has to be chosen. A breach found to be a near miss stops its clocks, and
 * its open deadline tasks are retired; any notification already made stays
 * on the record.
 */
export async function reclassifyBreach(input: {
  breachId: string;
  organisationId: string;
  classification: BreachClassification;
  rationale: string;
  /**
   * For a near miss becoming a breach: when the organisation became aware it
   * was one. Absent means from its discovery.
   */
  awareAt?: Date | null;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    const rationale = input.rationale.trim();
    if (!isBreachClassification(input.classification))
      throw new Error('Say whether it is a breach or a near miss.');
    if (!rationale)
      throw new Error(
        'Record why it is being reclassified. The change of view is part of the record.'
      );

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
      if (breach.classification === input.classification)
        throw new Error(
          input.classification === 'near_miss'
            ? 'It is already recorded as a near miss.'
            : 'It is already recorded as a breach.'
        );

      const now = new Date();
      const toBreach = input.classification === 'breach';
      const awareAt = toBreach ? (input.awareAt ?? null) : null;
      if (awareAt && awareAt < breach.discoveredAt)
        throw new Error(
          'It cannot have been known to be a breach before it was discovered. Count from discovery instead.'
        );
      if (awareAt && awareAt > now)
        throw new Error(
          'When it became known to be a breach cannot be in the future.'
        );

      const [after] = await tx
        .update(breaches)
        .set({
          classification: input.classification,
          awareAt,
          reclassifiedAt: now,
          reclassificationRationale: rationale,
          updatedAt: now
        })
        .where(eq(breaches.id, input.breachId))
        .returning();

      // A near miss raises no deadline, so one raised while it was counted a
      // breach asks for nothing now. The sweep raises them but never takes
      // them down.
      if (!toBreach)
        await tx
          .update(tasks)
          .set({
            status: 'done',
            completedAt: now,
            completedByLabel: input.actor.actorLabel
          })
          .where(
            and(
              eq(tasks.organisationId, input.organisationId),
              eq(tasks.type, 'breach_deadline'),
              eq(tasks.subjectId, input.breachId),
              inArray(tasks.status, ['open', 'in_progress'])
            )
          );

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: breach.entityId,
        action: 'breach.reclassified',
        subjectType: 'breach',
        subjectId: input.breachId,
        before: { classification: breach.classification },
        after: {
          reference: after.reference,
          classification: input.classification,
          ...(toBreach
            ? {
                clockFrom: (awareAt ?? breach.discoveredAt).toISOString()
              }
            : {}),
          rationale
        }
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
      nearMisses: loaded.filter((b) => b.breach.classification === 'near_miss')
        .length,
      // The number that matters at a glance: a clock running out.
      urgent: loaded.filter((b) =>
        [b.clock.state, b.pecr?.clock.state].some(
          (s) => s === 'overdue' || s === 'due_soon'
        )
      ).length,
      unassessed: loaded.filter(
        (b) =>
          b.risk === null &&
          b.breach.status !== 'closed' &&
          b.breach.classification === 'breach'
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
