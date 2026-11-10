import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  dataSubjectRequests,
  entities,
  informationRequests,
  referenceCounters,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  FOI_ACT_REGIMES,
  informationRequestClock,
  REGIME,
  type FoiAct,
  type FoiRegime,
  type InformationRequestClock
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
  extendedForComplexity?: boolean;
  schoolDaysDeadline?: Date | null;
  commissionSetDeadline?: Date | null;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await lockedRequest(input.organisationId, input.requestId);
      const regimes =
        input.regimes === undefined
          ? before.regimes
          : checkedRegimes(before.act, input.regimes);
      if (input.regimes !== undefined) checkedChannel(before.channel, regimes);
      if (input.ownerId)
        await assertMemberOf(input.organisationId, input.ownerId);

      const extended =
        input.extendedForComplexity ?? before.extendedForComplexity;
      if (extended && !regimes.some((r) => r === 'eir' || r === 'eisr'))
        throw new InformationRequestRefused(
          'Only environmental information can be extended for complexity and volume (reg 7).'
        );
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
        extendedForComplexity: extended,
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
        'extendedForComplexity',
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
      if (input.at < before.receivedAt)
        throw new InformationRequestRefused(
          'That is before the request arrived.'
        );
      if (
        input.step === 'received' &&
        before.clarificationSoughtAt &&
        input.at < before.clarificationSoughtAt
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

function clockOf(row: InformationRequest, now = new Date()) {
  return informationRequestClock({
    regimes: row.regimes,
    receivedAt: row.receivedAt,
    profile: row.timeProfile,
    clarificationSoughtAt: row.clarificationSoughtAt,
    clarificationReceivedAt: row.clarificationReceivedAt,
    extendedForComplexity: row.extendedForComplexity,
    schoolDaysDeadline: row.schoolDaysDeadline,
    commissionSetDeadline: row.commissionSetDeadline,
    respondedAt: row.respondedAt,
    closedWithoutResponse:
      row.status === 'closed' || row.status === 'converted',
    now
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
      if (input.respondedAt < before.receivedAt)
        throw new InformationRequestRefused(
          'The response cannot come before the request.'
        );
      const clock = clockOf({ ...before, respondedAt: input.respondedAt });
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
          updatedAt: new Date()
        })
        .where(eq(informationRequests.id, before.id))
        .returning();
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
    return {
      ...row.request,
      entityName: row.entityName,
      entityCoveredFor: row.entityCoveredFor,
      ownerEmail: row.ownerEmail,
      convertedToReference: row.convertedToReference,
      clock: clockOf(row.request)
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
    const withClock = rows.map((r) => ({
      ...r.request,
      entityName: r.entityName,
      clock: clockOf(r.request, now)
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
