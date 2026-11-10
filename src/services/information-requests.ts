import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  dataSubjectRequests,
  entities,
  informationRequestDecisions,
  informationRequests,
  referenceCounters,
  tasks,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  allowsPublicInterestExtension,
  clockStartsAt,
  costLimit,
  exceedsCostLimit,
  exemptionsFor,
  feeLapsesAt,
  FOI_ACT_REGIMES,
  informationRequestClock,
  needsPublicInterestTest,
  OWN_DATA_PROVISIONS,
  REGIME,
  requestDeadline,
  responseDeadline,
  type FeePauses,
  type FoiAct,
  type FoiRegime,
  type InformationRequestClock,
  type Pause
} from '@/lib/foi/statutory';

import { recordRequest } from './data-subject-requests';
import type { Actor } from './templates';
import { assertEntityIn, assertMemberOf } from './tenancy-guards';

/**
 * The register of freedom of information requests.
 *
 * Modelled on the register of data subject requests. Nothing here decides
 * anything: it records the facts the clock runs from, refuses what the law
 * does not allow, and works out the deadline with `lib/foi/statutory.ts`. A
 * named person records each judgement.
 *
 * The requester's name and address stay out of the audit chain, as a data
 * subject's do: the chain outlives the request, and the reference finds it.
 */

export type InformationRequest = typeof informationRequests.$inferSelect;
export type InformationRequestDecision =
  typeof informationRequestDecisions.$inferSelect;
export type DecisionKind = InformationRequestDecision['kind'];

/**
 * How a request arrived. A FOIA or FOI(S)A request must be in writing (s.8);
 * an email, a letter, a web form and a social media message all are. An
 * environmental request need not be, so it can arrive by phone or in person.
 */
export const FOI_CHANNELS = [
  'email',
  'web_form',
  'post',
  'social_media',
  'phone',
  'in_person'
] as const;
export type FoiChannel = (typeof FOI_CHANNELS)[number];

const SPOKEN: readonly string[] = ['phone', 'in_person'];

export class InformationRequestRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InformationRequestRefused';
  }
}

const TEXT_LIMIT = 10_000;

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * Whether one date falls on an earlier day than another. The forms give dates
 * without a time, read as midnight, so a step taken the day a request arrived
 * would otherwise count as coming before it.
 */
function earlierDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) < b.toISOString().slice(0, 10);
}

/**
 * Retire a request's open deadline tasks: once it is answered or closed they
 * ask for nothing, and an overdue task supersedes the due-soon one.
 */
async function retireDeadlineTasks(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    organisationId: string;
    requestId: string;
    label: string;
    exceptKey?: string;
  }
) {
  await tx
    .update(tasks)
    .set({
      status: 'done',
      completedAt: new Date(),
      completedByLabel: input.label
    })
    .where(
      and(
        eq(tasks.organisationId, input.organisationId),
        eq(tasks.type, 'foi_deadline'),
        eq(tasks.subjectId, input.requestId),
        inArray(tasks.status, ['open', 'in_progress']),
        input.exceptKey ? ne(tasks.idempotencyKey, input.exceptKey) : undefined
      )
    );
}

function checkedRegimes(act: FoiAct, regimes: readonly string[]): FoiRegime[] {
  const allowed = FOI_ACT_REGIMES[act];
  if (regimes.some((r) => !(allowed as readonly string[]).includes(r)))
    throw new InformationRequestRefused(
      `This entity answers under the ${REGIME[allowed[0]].label}, so a request to it is handled under that or the ${REGIME[allowed[1]].label}.`
    );
  const chosen = allowed.filter((r) => regimes.includes(r));
  if (chosen.length === 0)
    throw new InformationRequestRefused(
      `Say whether it is a request under the ${REGIME[allowed[0]].label}, the ${REGIME[allowed[1]].label}, or both.`
    );
  return chosen;
}

function checkedChannel(channel: string, regimes: readonly FoiRegime[]) {
  if (!(FOI_CHANNELS as readonly string[]).includes(channel))
    throw new InformationRequestRefused('Say how the request arrived.');
  const written = regimes.filter((r) => REGIME[r].mustBeInWriting);
  if (SPOKEN.includes(channel) && written.length > 0)
    throw new InformationRequestRefused(
      `A request under the ${REGIME[written[0]].label} must be in writing (s.8). A spoken request counts only for environmental information. Record it as environmental, or help them put it in writing.`
    );
}

async function nextReference(organisationId: string, year: number) {
  const rows = await db.execute<{ next_value: number | string }>(sql`
    insert into ${referenceCounters} (organisation_id, prefix, year, next_value)
    values (${organisationId}, 'FOI', ${year}, 1)
    on conflict (organisation_id, prefix, year)
      do update set next_value = ${referenceCounters}.next_value + 1
    returning next_value
  `);
  return `FOI-${year}-${String(Number(rows[0]?.next_value ?? 1)).padStart(4, '0')}`;
}

/** Record a request as it arrived, by whatever channel. */
export async function recordInformationRequest(input: {
  organisationId: string;
  entityId: string;
  /**
   * The regimes, or what kind of information it is where the caller does not
   * know the entity's Act: environmental information goes under the
   * environmental regulations. Defaults to the Act's own regime.
   */
  regimes?: readonly string[];
  kind?: 'general' | 'environmental' | 'both';
  channel: string;
  receivedAt: Date;
  description: string;
  requesterName: string;
  correspondenceAddress?: string | null;
  pseudonymous?: boolean;
  preferredMeans?: string | null;
  ownerId?: string | null;
  actor: Actor;
}) {
  const description = clean(input.description);
  const requesterName = clean(input.requesterName);
  if (!requesterName)
    throw new InformationRequestRefused(
      'Record who is asking. A request needs a name to be answered.'
    );
  if (!description)
    throw new InformationRequestRefused(
      'Record what information they asked for, in their words.'
    );
  if (description.length > TEXT_LIMIT)
    throw new InformationRequestRefused(
      'The description is too long to keep here. Keep the request where it arrived and summarise it.'
    );
  if (input.receivedAt.getTime() > Date.now() + 60_000)
    throw new InformationRequestRefused(
      'A request cannot arrive in the future. Record when it actually arrived.'
    );

  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEntityIn(input.organisationId, input.entityId);
      if (input.ownerId)
        await assertMemberOf(input.organisationId, input.ownerId);
      const [entity] = await db
        .select({
          name: entities.name,
          act: entities.foiAct,
          profile: entities.foiTimeProfile
        })
        .from(entities)
        .where(eq(entities.id, input.entityId));
      if (!entity.act)
        throw new InformationRequestRefused(
          `${entity.name} is not recorded as answering freedom of information requests. Set which Act applies on the Organisation page first.`
        );
      const [main, environmental] = FOI_ACT_REGIMES[entity.act];
      const regimes = checkedRegimes(
        entity.act,
        input.regimes ??
          (input.kind === 'environmental'
            ? [environmental]
            : input.kind === 'both'
              ? [main, environmental]
              : [main])
      );
      checkedChannel(input.channel, regimes);
      const reference = await nextReference(
        input.organisationId,
        new Date().getUTCFullYear()
      );

      const [row] = await db
        .insert(informationRequests)
        .values({
          organisationId: input.organisationId,
          entityId: input.entityId,
          reference,
          act: entity.act,
          regimes,
          timeProfile: entity.profile,
          channel: input.channel,
          receivedAt: input.receivedAt,
          description,
          requesterName,
          correspondenceAddress: clean(input.correspondenceAddress),
          pseudonymous: input.pseudonymous ?? false,
          preferredMeans: clean(input.preferredMeans),
          ownerId: input.ownerId ?? null
        })
        .returning();

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.entityId,
        action: 'foi.recorded',
        subjectType: 'information_request',
        subjectId: row.id,
        after: {
          reference,
          act: entity.act,
          regimes,
          channel: input.channel,
          receivedAt: input.receivedAt.toISOString(),
          timeProfile: entity.profile
        }
      });
      return row;
    })
  );
}

async function lockedRequest(organisationId: string, requestId: string) {
  const [row] = await db
    .select()
    .from(informationRequests)
    .where(
      and(
        eq(informationRequests.id, requestId),
        eq(informationRequests.organisationId, organisationId)
      )
    )
    .for('update');
  if (!row) throw new InformationRequestRefused('No such request.');
  return row;
}

function stillOpen(row: InformationRequest) {
  if (row.status !== 'open')
    throw new InformationRequestRefused(
      row.status === 'converted'
        ? 'This request became a subject access request, and is handled there.'
        : 'This request has been answered or closed.'
    );
}

/**
 * Correct or complete what was recorded. Each change to what the clock runs
 * from is checked against the regimes it applies to.
 */
export async function updateInformationRequest(input: {
  organisationId: string;
  requestId: string;
  regimes?: readonly string[];
  description?: string;
  correspondenceAddress?: string | null;
  pseudonymous?: boolean;
  preferredMeans?: string | null;
  ownerId?: string | null;
  schoolDaysDeadline?: Date | null;
  commissionSetDeadline?: Date | null;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await lockedRequest(input.organisationId, input.requestId);
      // An answered request's record is what it was answered on: changing its
      // regimes or deadlines now would rewrite whether it was on time.
      stillOpen(before);
      const regimes =
        input.regimes === undefined
          ? before.regimes
          : checkedRegimes(before.act, input.regimes);
      if (input.regimes !== undefined) checkedChannel(before.channel, regimes);
      if (input.ownerId)
        await assertMemberOf(input.organisationId, input.ownerId);

      const commission =
        input.commissionSetDeadline === undefined
          ? before.commissionSetDeadline
          : input.commissionSetDeadline;
      if (commission && before.act !== 'foia')
        throw new InformationRequestRefused(
          'Only the Information Commission sets a later day, and only under FOIA.'
        );
      const school =
        input.schoolDaysDeadline === undefined
          ? before.schoolDaysDeadline
          : input.schoolDaysDeadline;
      if (school && before.timeProfile !== 'school')
        throw new InformationRequestRefused(
          'A school-days date applies only where the entity is a school.'
        );
      let description = before.description;
      if (input.description !== undefined) {
        const d = clean(input.description);
        if (!d)
          throw new InformationRequestRefused(
            'Keep a description of what was asked for.'
          );
        description = d;
      }

      const next = {
        regimes,
        description,
        correspondenceAddress:
          input.correspondenceAddress === undefined
            ? before.correspondenceAddress
            : clean(input.correspondenceAddress),
        pseudonymous: input.pseudonymous ?? before.pseudonymous,
        preferredMeans:
          input.preferredMeans === undefined
            ? before.preferredMeans
            : clean(input.preferredMeans),
        ownerId: input.ownerId === undefined ? before.ownerId : input.ownerId,
        schoolDaysDeadline: school,
        commissionSetDeadline: commission
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
        (k) => JSON.stringify(next[k]) !== JSON.stringify(before[k])
      );
      if (changed.length === 0) return before;

      const [after] = await db
        .update(informationRequests)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(informationRequests.id, before.id))
        .returning();
      // Which fields changed, and the values of those that move the clock. The
      // requester's address and the description stay out of the chain.
      const clockFields = [
        'regimes',
        'schoolDaysDeadline',
        'commissionSetDeadline'
      ] as const;
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'foi.updated',
        subjectType: 'information_request',
        subjectId: before.id,
        before: Object.fromEntries(
          clockFields
            .filter((k) => changed.includes(k))
            .map((k) => [k, before[k]])
        ),
        after: {
          changed,
          ...Object.fromEntries(
            clockFields
              .filter((k) => changed.includes(k))
              .map((k) => [k, next[k]])
          )
        }
      });
      return after;
    })
  );
}

/**
 * Record asking the requester for more to identify what they want (FOIA
 * s.1(3), EIR reg 9(2) and their Scottish equivalents), or their answer. The
 * count starts again from the answer, so the two dates are kept, not a pause.
 */
export async function recordClarification(input: {
  organisationId: string;
  requestId: string;
  step: 'sought' | 'received';
  at: Date;
  actor: Actor;
}) {
  if (input.at.getTime() > Date.now() + 60_000)
    throw new InformationRequestRefused('That date is in the future.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await lockedRequest(input.organisationId, input.requestId);
      stillOpen(before);
      if (input.step === 'received' && !before.clarificationSoughtAt)
        throw new InformationRequestRefused(
          'Record asking for clarification before recording the answer.'
        );
      if (earlierDay(input.at, before.receivedAt))
        throw new InformationRequestRefused(
          'That is before the request arrived.'
        );
      if (
        input.step === 'received' &&
        before.clarificationSoughtAt &&
        earlierDay(input.at, before.clarificationSoughtAt)
      )
        throw new InformationRequestRefused(
          'The answer cannot come before the question.'
        );
      const set =
        input.step === 'sought'
          ? { clarificationSoughtAt: input.at, clarificationReceivedAt: null }
          : { clarificationReceivedAt: input.at };
      const [after] = await db
        .update(informationRequests)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(informationRequests.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action:
          input.step === 'sought'
            ? 'foi.clarification_sought'
            : 'foi.clarification_received',
        subjectType: 'information_request',
        subjectId: before.id,
        after: { at: input.at.toISOString() }
      });
      return after;
    })
  );
}

/**
 * Fee notice to payment, per regime, read off the decisions. An unpaid notice
 * leaves `to` null; a lapsed one ends the pause, and the request with it.
 */
export function feePausesOf(
  decisions: readonly InformationRequestDecision[]
): FeePauses {
  const out: Partial<Record<FoiRegime, Pause[]>> = {};
  for (const d of [...decisions].sort(
    (a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime()
  )) {
    if (!d.regime) continue;
    const pauses = (out[d.regime] ??= []);
    if (d.kind === 'fees_notice')
      pauses.push({ from: d.effectiveAt, to: null });
    if (d.kind === 'fee_paid' || d.kind === 'fee_lapsed') {
      const open = pauses.find((p) => p.to === null);
      if (open) open.to = d.effectiveAt;
    }
  }
  return out;
}

/** Whether a fee is awaited under a regime. */
export function feeAwaited(
  decisions: readonly InformationRequestDecision[],
  regime: FoiRegime
): boolean {
  return (feePausesOf(decisions)[regime] ?? []).some((p) => p.to === null);
}

/** The latest date given for deciding the public interest (FOIA s.10(3)). */
export function publicInterestDateOf(
  decisions: readonly InformationRequestDecision[]
): Date | null {
  const dates = decisions
    .filter((d) => d.kind === 'public_interest_extension')
    .map((d) => new Date(String(d.detail.estimatedDate)))
    .filter((d) => !Number.isNaN(d.getTime()));
  return dates.length > 0 ? dates.reduce((a, b) => (b > a ? b : a)) : null;
}

/** The kinds that refuse some or all of what was asked, and so need a refusal notice. */
const REFUSING: readonly DecisionKind[] = [
  'exemption',
  'neither_confirm_nor_deny',
  'cost_limit',
  'vexatious',
  'repeated'
];

export function refuses(decisions: readonly InformationRequestDecision[]) {
  return decisions.some((d) => REFUSING.includes(d.kind));
}

function clockOf(
  row: InformationRequest,
  decisions: readonly InformationRequestDecision[],
  now = new Date()
) {
  return informationRequestClock({
    regimes: row.regimes,
    receivedAt: row.receivedAt,
    profile: row.timeProfile,
    clarificationSoughtAt: row.clarificationSoughtAt,
    clarificationReceivedAt: row.clarificationReceivedAt,
    extendedForComplexity: row.extendedForComplexity,
    schoolDaysDeadline: row.schoolDaysDeadline,
    commissionSetDeadline: row.commissionSetDeadline,
    feePauses: feePausesOf(decisions),
    publicInterestDate: publicInterestDateOf(decisions),
    respondedAt: row.respondedAt,
    closedWithoutResponse:
      row.status === 'closed' || row.status === 'converted',
    now
  });
}

/**
 * The ordinary deadline, before any public interest extension: for one regime
 * where given, otherwise for the request. Null while clarification is awaited,
 * because nothing is owed and no time is running.
 */
function ordinaryDeadline(
  row: InformationRequest,
  decisions: readonly InformationRequestDecision[],
  regime?: FoiRegime
): Date | null {
  const startsAt = clockStartsAt(row);
  if (!startsAt) return null;
  const common = {
    startsAt,
    profile: row.timeProfile,
    extendedForComplexity: row.extendedForComplexity,
    schoolDaysDeadline: row.schoolDaysDeadline,
    commissionSetDeadline: row.commissionSetDeadline
  };
  const pauses = feePausesOf(decisions);
  return regime
    ? responseDeadline({ ...common, regime, feePauses: pauses[regime] ?? [] })
    : requestDeadline({ ...common, regimes: row.regimes, feePauses: pauses });
}

async function decisionsOf(
  organisationId: string,
  requestIds: string[]
): Promise<Map<string, InformationRequestDecision[]>> {
  const out = new Map<string, InformationRequestDecision[]>();
  if (requestIds.length === 0) return out;
  const rows = await db
    .select()
    .from(informationRequestDecisions)
    .where(
      and(
        eq(informationRequestDecisions.organisationId, organisationId),
        inArray(informationRequestDecisions.requestId, requestIds)
      )
    )
    .orderBy(asc(informationRequestDecisions.decidedAt));
  for (const row of rows) {
    const list = out.get(row.requestId) ?? [];
    list.push(row);
    out.set(row.requestId, list);
  }
  return out;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Record a decision or step, with its reason. Each kind is checked against
 * what the regimes allow; nothing is decided here.
 */
export async function recordInformationRequestDecision(input: {
  organisationId: string;
  requestId: string;
  kind: DecisionKind;
  regime?: FoiRegime | null;
  provision?: string | null;
  detail?: Record<string, unknown>;
  rationale: string;
  effectiveAt?: Date;
  actor: Actor;
}) {
  const rationale = clean(input.rationale);
  if (!rationale)
    throw new InformationRequestRefused(
      'Record why. The reason is what the requester, a reviewer or the regulator will ask for.'
    );
  const effectiveAt = input.effectiveAt ?? new Date();
  if (effectiveAt.getTime() > Date.now() + 60_000)
    throw new InformationRequestRefused('That date is in the future.');

  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await lockedRequest(input.organisationId, input.requestId);
      stillOpen(before);
      if (earlierDay(effectiveAt, before.receivedAt))
        throw new InformationRequestRefused(
          'That is before the request arrived.'
        );
      const regime = input.regime ?? before.regimes[0];
      if (!before.regimes.includes(regime))
        throw new InformationRequestRefused(
          `This request is not under the ${REGIME[regime].label}. Correct the record first if it should be.`
        );
      const existing =
        (await decisionsOf(input.organisationId, [before.id])).get(before.id) ??
        [];
      const detail: Record<string, unknown> = { ...(input.detail ?? {}) };
      let provision = clean(input.provision);
      // The time this regime's part has. While clarification is awaited no time
      // runs, so nothing done meanwhile can be late.
      const ordinary = ordinaryDeadline(before, existing, regime);
      const late = (at: Date) => ordinary !== null && at > ordinary;
      const environmental = regime === 'eir' || regime === 'eisr';

      switch (input.kind) {
        case 'held': {
          if (!['held', 'not_held', 'part_held'].includes(text(detail.held)))
            throw new InformationRequestRefused(
              'Say whether the information is held, not held, or held in part.'
            );
          break;
        }
        case 'neither_confirm_nor_deny': {
          if (!provision)
            throw new InformationRequestRefused(
              'Name the provision that removes the duty to confirm or deny.'
            );
          break;
        }
        case 'exemption': {
          const exemption = exemptionsFor(regime).find(
            (e) => e.provision === provision
          );
          if (!exemption)
            throw new InformationRequestRefused(
              `Choose an exemption from the ${REGIME[regime].label}.`
            );
          if (OWN_DATA_PROVISIONS.includes(exemption.provision))
            throw new InformationRequestRefused(
              "The requester's own personal data is a subject access request. Convert the request instead of refusing it."
            );
          if (exemption.notForEmissions && detail.emissions !== false)
            throw new InformationRequestRefused(
              `${exemption.provision} cannot withhold information on emissions. Confirm the information is not about emissions.`
            );
          if (needsPublicInterestTest(exemption)) {
            if (!text(detail.factorsFor) || !text(detail.factorsAgainst))
              throw new InformationRequestRefused(
                environmental
                  ? 'Every exception needs the public interest test, weighed with a presumption in favour of disclosure. Record the factors on each side.'
                  : 'A qualified exemption needs the public interest test. Record the factors for disclosure and for withholding.'
              );
            detail.factorsFor = text(detail.factorsFor);
            detail.factorsAgainst = text(detail.factorsAgainst);
          }
          detail.absolute = exemption.absolute;
          detail.title = exemption.title;
          break;
        }
        case 'public_interest_extension': {
          if (!allowsPublicInterestExtension(regime))
            throw new InformationRequestRefused(
              `Only FOIA allows more time to weigh the public interest. Under the ${REGIME[regime].label} it is weighed within the ordinary time.`
            );
          const exemption = exemptionsFor(regime).find(
            (e) => e.provision === provision
          );
          if (!exemption || exemption.absolute)
            throw new InformationRequestRefused(
              'Name the qualified exemption whose public interest test needs the time.'
            );
          const estimated = new Date(text(detail.estimatedDate));
          if (
            Number.isNaN(estimated.getTime()) ||
            (ordinary !== null && estimated <= ordinary)
          )
            throw new InformationRequestRefused(
              'Give the date the refusal notice says the decision is expected by, after the ordinary deadline.'
            );
          if (late(effectiveAt))
            throw new InformationRequestRefused(
              'The refusal notice saying the public interest is still being weighed was due by the ordinary deadline (s.17(2)). Record the response as late instead.'
            );
          detail.estimatedDate = estimated.toISOString();
          break;
        }
        case 'complexity_extension': {
          if (!environmental)
            throw new InformationRequestRefused(
              'Only environmental information can be extended for complexity and volume (reg 7).'
            );
          if (late(effectiveAt))
            throw new InformationRequestRefused(
              'The requester had to be told within the first twenty working days (reg 7(2)). It is too late to extend.'
            );
          provision = 'reg 7';
          break;
        }
        case 'fees_notice': {
          const amount = Number(detail.amount);
          if (!Number.isFinite(amount) || amount <= 0)
            throw new InformationRequestRefused('Give the amount asked for.');
          if (feeAwaited(existing, regime))
            throw new InformationRequestRefused(
              'A fee is already awaited. Record it paid or lapsed first.'
            );
          if (late(effectiveAt))
            throw new InformationRequestRefused(
              'A fees notice has to be given within the time for responding.'
            );
          detail.amount = amount;
          detail.lapsesAt = feeLapsesAt(regime, effectiveAt).toISOString();
          provision = regime === 'foia' || regime === 'foisa' ? 's.9' : 'reg 8';
          break;
        }
        case 'fee_paid':
        case 'fee_lapsed': {
          const open = [...existing]
            .reverse()
            .find((d) => d.kind === 'fees_notice' && d.regime === regime);
          if (!open || !feeAwaited(existing, regime))
            throw new InformationRequestRefused(
              `No fee is awaited under the ${REGIME[regime].label}.`
            );
          if (earlierDay(effectiveAt, open.effectiveAt))
            throw new InformationRequestRefused(
              'That is before the fees notice.'
            );
          if (
            input.kind === 'fee_lapsed' &&
            effectiveAt < new Date(String(open.detail.lapsesAt))
          )
            throw new InformationRequestRefused(
              'The time to pay has not run out yet.'
            );
          break;
        }
        case 'cost_limit': {
          if (environmental)
            throw new InformationRequestRefused(
              'The environmental regulations have no cost limit. Where the cost makes a request manifestly unreasonable, record the reg 12(4)(b) exception instead.'
            );
          const hours = Number(detail.estimatedHours);
          if (!Number.isFinite(hours) || hours <= 0)
            throw new InformationRequestRefused(
              'Give the estimate in hours, counting only determining whether it is held, locating, retrieving and extracting it.'
            );
          const central = detail.centralGovernment === true;
          if (!exceedsCostLimit(regime, hours, { centralGovernment: central }))
            throw new InformationRequestRefused(
              `${hours} hours is within the limit of ${costLimit(regime, { centralGovernment: central })?.hours} hours, so the request must be answered.`
            );
          detail.estimatedHours = hours;
          detail.centralGovernment = central;
          detail.aggregated = detail.aggregated === true;
          provision = 's.12';
          break;
        }
        case 'vexatious':
        case 'repeated': {
          if (environmental)
            throw new InformationRequestRefused(
              'The environmental regulations have no vexatious or repeated request provision. Record the reg 12(4)(b) exception (manifestly unreasonable) instead.'
            );
          provision = input.kind === 'vexatious' ? 's.14(1)' : 's.14(2)';
          break;
        }
        case 'transferred':
        case 'advice':
          break;
      }

      const [row] = await tx
        .insert(informationRequestDecisions)
        .values({
          organisationId: input.organisationId,
          requestId: before.id,
          kind: input.kind,
          regime,
          provision,
          detail,
          rationale,
          effectiveAt,
          decidedBy: input.actor.actorUserId ?? null,
          decidedByLabel: input.actor.actorLabel
        })
        .returning();
      if (
        input.kind === 'complexity_extension' &&
        !before.extendedForComplexity
      )
        await tx
          .update(informationRequests)
          .set({ extendedForComplexity: true, updatedAt: new Date() })
          .where(eq(informationRequests.id, before.id));
      // An unpaid fee ends the duty to comply (FOIA s.9(2), EIR reg 8(4)), so
      // nothing more is owed on that part. Where it was the only part, the
      // request closes.
      if (input.kind === 'fee_lapsed' && before.regimes.length === 1) {
        await tx
          .update(informationRequests)
          .set({
            status: 'closed',
            closedAt: new Date(),
            closureRationale: `The fee was not paid in time, so no response is owed. ${rationale}`,
            updatedAt: new Date()
          })
          .where(eq(informationRequests.id, before.id));
        await retireDeadlineTasks(tx, {
          organisationId: input.organisationId,
          requestId: before.id,
          label: input.actor.actorLabel
        });
      }
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'foi.decision_recorded',
        subjectType: 'information_request',
        subjectId: before.id,
        after: {
          decisionId: row.id,
          kind: row.kind,
          regime,
          provision,
          effectiveAt: effectiveAt.toISOString()
        }
      });
      return row;
    })
  );
}

/**
 * Open requests whose time is close or gone, for the sweep to raise as tasks.
 */
export async function informationRequestsNeedingAttention(
  organisationId: string
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select()
      .from(informationRequests)
      .where(
        and(
          eq(informationRequests.organisationId, organisationId),
          eq(informationRequests.status, 'open')
        )
      );
    const decisions = await decisionsOf(
      organisationId,
      rows.map((r) => r.id)
    );
    const now = new Date();
    return rows
      .map((request) => {
        const own = decisions.get(request.id) ?? [];
        return {
          request,
          publicInterestDate: publicInterestDateOf(own),
          clock: clockOf(request, own, now)
        };
      })
      .filter(
        (r) => r.clock.state === 'due_soon' || r.clock.state === 'overdue'
      );
  });
}

/**
 * Record the response: what was sent and when. A late one needs the reason,
 * because the requester can complain about the delay alone.
 */
export async function respondToInformationRequest(input: {
  organisationId: string;
  requestId: string;
  respondedAt: Date;
  summary: string;
  link?: string | null;
  lateReason?: string | null;
  published?: boolean | null;
  /** The refusal notice says everything its regime requires. */
  refusalNoticeChecked?: boolean;
  actor: Actor;
}) {
  const summary = clean(input.summary);
  if (!summary)
    throw new InformationRequestRefused(
      'Say what the response was: released in full, in part, refused, or not held.'
    );
  if (input.respondedAt.getTime() > Date.now() + 60_000)
    throw new InformationRequestRefused(
      'A response cannot be sent in the future.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await lockedRequest(input.organisationId, input.requestId);
      stillOpen(before);
      if (earlierDay(input.respondedAt, before.receivedAt))
        throw new InformationRequestRefused(
          'The response cannot come before the request.'
        );
      const decisions =
        (await decisionsOf(input.organisationId, [before.id])).get(before.id) ??
        [];
      if (refuses(decisions) && !input.refusalNoticeChecked)
        throw new InformationRequestRefused(
          'Something was refused, so the response is a refusal notice. Confirm it says everything the law requires: the list is beside the form.'
        );
      const clock = clockOf(
        { ...before, respondedAt: input.respondedAt },
        decisions
      );
      const lateReason = clean(input.lateReason);
      if (clock.state === 'late' && !lateReason)
        throw new InformationRequestRefused(
          'The response was after the deadline. Record why, as the requester can complain about the delay.'
        );
      const [after] = await db
        .update(informationRequests)
        .set({
          status: 'responded',
          respondedAt: input.respondedAt,
          responseSummary: summary,
          responseLink: clean(input.link),
          lateReason: clock.state === 'late' ? lateReason : null,
          published: input.published ?? null,
          refusalNoticeChecked: refuses(decisions)
            ? (input.refusalNoticeChecked ?? false)
            : null,
          updatedAt: new Date()
        })
        .where(eq(informationRequests.id, before.id))
        .returning();
      await retireDeadlineTasks(tx, {
        organisationId: input.organisationId,
        requestId: before.id,
        label: input.actor.actorLabel
      });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'foi.responded',
        subjectType: 'information_request',
        subjectId: before.id,
        after: {
          respondedAt: input.respondedAt.toISOString(),
          onTime: clock.state === 'met',
          published: input.published ?? null
        }
      });
      return after;
    })
  );
}

/** Close a request that is owed no response: withdrawn, or a duplicate. */
export async function closeInformationRequest(input: {
  organisationId: string;
  requestId: string;
  rationale: string;
  actor: Actor;
}) {
  const rationale = clean(input.rationale);
  if (!rationale)
    throw new InformationRequestRefused(
      'Say why no response is owed. A request that is refused still gets a refusal notice: record that as the response instead.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await lockedRequest(input.organisationId, input.requestId);
      stillOpen(before);
      const [after] = await db
        .update(informationRequests)
        .set({
          status: 'closed',
          closedAt: new Date(),
          closureRationale: rationale,
          updatedAt: new Date()
        })
        .where(eq(informationRequests.id, before.id))
        .returning();
      await retireDeadlineTasks(tx, {
        organisationId: input.organisationId,
        requestId: before.id,
        label: input.actor.actorLabel
      });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'foi.closed',
        subjectType: 'information_request',
        subjectId: before.id,
        after: { rationale }
      });
      return after;
    })
  );
}

/**
 * Turn a request for the requester's own personal data into a subject access
 * request. It is exempt from FOI (FOIA s.40(1), FOI(S)A s.38(1)(a)) and the
 * s.45 code says to handle it as a subject access request. The new request
 * keeps the date this one arrived, so the month runs from then, and the two
 * records point at each other.
 */
export async function convertToSubjectAccessRequest(input: {
  organisationId: string;
  requestId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await lockedRequest(input.organisationId, input.requestId);
      stillOpen(before);
      const dsr = await recordRequest({
        organisationId: input.organisationId,
        entityId: before.entityId,
        rights: ['access'],
        channel: before.channel,
        receivedAt: before.receivedAt,
        description: before.description,
        requesterName: before.requesterName,
        requesterContact: before.correspondenceAddress,
        ownerId: before.ownerId,
        actor: input.actor
      });
      const [after] = await db
        .update(informationRequests)
        .set({
          status: 'converted',
          convertedToRequestId: dsr.id,
          closedAt: new Date(),
          closureRationale: `For the requester's own personal data, so handled as subject access request ${dsr.reference}.`,
          updatedAt: new Date()
        })
        .where(eq(informationRequests.id, before.id))
        .returning();
      await retireDeadlineTasks(tx, {
        organisationId: input.organisationId,
        requestId: before.id,
        label: input.actor.actorLabel
      });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'foi.converted_to_dsr',
        subjectType: 'information_request',
        subjectId: before.id,
        after: {
          dataSubjectRequestId: dsr.id,
          dataSubjectRequestReference: dsr.reference
        }
      });
      return { request: after, dataSubjectRequest: dsr };
    })
  );
}

export type LoadedInformationRequest = InformationRequest & {
  decisions: InformationRequestDecision[];
  ordinaryDeadline: Date | null;
  entityName: string;
  entityCoveredFor: string | null;
  ownerEmail: string | null;
  convertedToReference: string | null;
  clock: InformationRequestClock;
};

/** One request, with its clock. Null where it is not this organisation's. */
export async function loadInformationRequest(
  requestId: string,
  organisationId: string
): Promise<LoadedInformationRequest | null> {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select({
        request: informationRequests,
        entityName: entities.name,
        entityCoveredFor: entities.foiCoveredFor,
        ownerEmail: users.email,
        convertedToReference: dataSubjectRequests.reference
      })
      .from(informationRequests)
      .innerJoin(entities, eq(entities.id, informationRequests.entityId))
      .leftJoin(users, eq(users.id, informationRequests.ownerId))
      .leftJoin(
        dataSubjectRequests,
        eq(dataSubjectRequests.id, informationRequests.convertedToRequestId)
      )
      .where(
        and(
          eq(informationRequests.id, requestId),
          eq(informationRequests.organisationId, organisationId)
        )
      );
    if (!row) return null;
    const own =
      (await decisionsOf(organisationId, [row.request.id])).get(
        row.request.id
      ) ?? [];
    return {
      ...row.request,
      entityName: row.entityName,
      entityCoveredFor: row.entityCoveredFor,
      ownerEmail: row.ownerEmail,
      convertedToReference: row.convertedToReference,
      decisions: own,
      ordinaryDeadline: ordinaryDeadline(row.request, own),
      clock: clockOf(row.request, own)
    };
  });
}

/**
 * The register: every request the caller may see, newest first, with its
 * clock, and the counts that matter. `entityIds` null means all entities.
 */
export async function informationRequestRegister(
  organisationId: string,
  entityIds: string[] | null
) {
  return withOrganisation(organisationId, async () => {
    if (entityIds && entityIds.length === 0)
      return { total: 0, open: 0, dueSoon: 0, overdue: 0, rows: [] };
    const rows = await db
      .select({ request: informationRequests, entityName: entities.name })
      .from(informationRequests)
      .innerJoin(entities, eq(entities.id, informationRequests.entityId))
      .where(
        and(
          eq(informationRequests.organisationId, organisationId),
          entityIds
            ? inArray(informationRequests.entityId, entityIds)
            : undefined
        )
      )
      .orderBy(desc(informationRequests.receivedAt));
    const now = new Date();
    const decisions = await decisionsOf(
      organisationId,
      rows.map((r) => r.request.id)
    );
    const withClock = rows.map((r) => ({
      ...r.request,
      entityName: r.entityName,
      clock: clockOf(r.request, decisions.get(r.request.id) ?? [], now)
    }));
    return {
      total: withClock.length,
      open: withClock.filter((r) => r.status === 'open').length,
      dueSoon: withClock.filter((r) => r.clock.state === 'due_soon').length,
      overdue: withClock.filter((r) => r.clock.state === 'overdue').length,
      rows: withClock
    };
  });
}

/** The freedom of information request a subject access request was converted from, if any. */
export async function convertedFrom(
  dataSubjectRequestId: string,
  organisationId: string
): Promise<{ id: string; reference: string } | null> {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select({
        id: informationRequests.id,
        reference: informationRequests.reference
      })
      .from(informationRequests)
      .where(
        and(
          eq(informationRequests.organisationId, organisationId),
          eq(informationRequests.convertedToRequestId, dataSubjectRequestId)
        )
      );
    return row ?? null;
  });
}
