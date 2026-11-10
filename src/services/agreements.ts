import { and, asc, desc, eq } from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import {
  entities,
  entityAgreements,
  memberships,
  roleAssignments,
  termsAcceptances,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { currentDocument } from '@/lib/legal/documents';
import type { Grant } from '@/lib/rbac';

import type { Actor } from './templates';

/**
 * Accepting Waivern's terms and Data Processing Agreement, and whether anything
 * is still waiting to be accepted before somebody may work.
 *
 * Two acceptances, because two different parties are bound. Every person
 * accepts the terms for themselves (clause 1.3). Each legal entity, being a
 * controller of its own, accepts the terms and the Data Processing Agreement
 * through an owner who confirms they may bind it. Until both are in place for
 * the entities somebody can see, they may not work in them at all: a processor
 * holding a controller's records with no Article 28 contract is the position
 * this exists to prevent.
 *
 * What makes an acceptance stand up later is in the evidence kept: the exact
 * version and a SHA-256 of the text shown, the boxes ticked, who ticked them,
 * in what capacity, when and from where. The tables are append-only.
 *
 * Acceptance is needed once. A later version of either document binds by
 * notice instead (terms 12.1): see `agreement-notices.ts`.
 */

export class AgreementRefused extends Error {}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What the browser told us about where an acceptance came from. */
export type AcceptanceOrigin = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * What the person accepting for an entity ticked and typed. Each box is its own
 * statement, so none of them can be inferred from another, and the versions
 * are the ones on the page they read: if a document changed while it was open,
 * the acceptance is refused rather than recorded against text they never saw.
 */
export type EntityAgreementInput = AcceptanceOrigin & {
  acceptTerms: boolean;
  acceptDpa: boolean;
  confirmAuthority: boolean;
  signatoryName: string;
  signatoryPosition: string;
  termsVersion: string;
  dpaVersion: string;
};

const FIELD_LIMIT = 120;

function clean(value: string, what: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < 2) throw new AgreementRefused(`Give your ${what}.`);
  if (text.length > FIELD_LIMIT)
    throw new AgreementRefused(`Your ${what} is too long.`);
  return text;
}

function short(value: string | null | undefined, limit: number) {
  return value ? value.slice(0, limit) : null;
}

/**
 * Whether these grants let somebody bind this entity: an owner over the whole
 * organisation, or an owner confined to this entity. Owners are the people the
 * organisation has trusted with everything; a privacy administrator, however
 * senior, has not been given the organisation's signature.
 */
export function mayAcceptFor(
  grants: readonly Grant[],
  entityId: string
): boolean {
  return grants.some(
    (g) =>
      g.role === 'owner' &&
      (g.scope === 'organisation' || g.entityId === entityId)
  );
}

/**
 * Has this person accepted the terms for themselves? Any version will do: a
 * later version applies by notice under clause 12.1, without being accepted
 * again, so nobody is shut out when the terms change.
 */
export async function hasAcceptedTerms(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: termsAcceptances.id })
    .from(termsAcceptances)
    .where(eq(termsAcceptances.userId, userId))
    .limit(1);
  return row !== undefined;
}

export async function acceptTerms(
  input: AcceptanceOrigin & {
    userId: string;
    email: string;
    name: string | null;
    accepted: boolean;
    termsVersion: string;
  }
) {
  const terms = currentDocument('terms');
  if (!input.accepted)
    throw new AgreementRefused(
      'Tick the box to say you accept the Terms of Service.'
    );
  if (input.termsVersion !== terms.version)
    throw new AgreementRefused(
      'The Terms of Service changed while this page was open. Read the current version, then accept it.'
    );
  const [row] = await db
    .insert(termsAcceptances)
    .values({
      userId: input.userId,
      email: input.email.toLowerCase(),
      name: input.name,
      termsVersion: terms.version,
      termsSha256: terms.sha256,
      ipAddress: short(input.ipAddress, 64),
      userAgent: short(input.userAgent, 400)
    })
    // Accepted already, from another tab: the first acceptance is the evidence.
    .onConflictDoNothing({
      target: [termsAcceptances.userId, termsAcceptances.termsVersion]
    })
    .returning();
  if (row) return row;
  const [existing] = await db
    .select()
    .from(termsAcceptances)
    .where(
      and(
        eq(termsAcceptances.userId, input.userId),
        eq(termsAcceptances.termsVersion, terms.version)
      )
    );
  return existing;
}

/**
 * The entities of this organisation that have never accepted the documents.
 * As for a person, any version counts: later ones apply by notice (terms 12.1,
 * Data Processing Agreement 9.7).
 */
async function entitiesWithoutAgreement(organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const all = await db
      .select({
        id: entities.id,
        name: entities.name,
        legalEntityRef: entities.legalEntityRef
      })
      .from(entities)
      .where(eq(entities.organisationId, organisationId))
      .orderBy(asc(entities.name));
    const accepted = await db
      .select({ entityId: entityAgreements.entityId })
      .from(entityAgreements)
      .where(eq(entityAgreements.organisationId, organisationId));
    const done = new Set(accepted.map((a) => a.entityId));
    return all.filter((e) => !done.has(e.id));
  });
}

export type PendingEntity = {
  id: string;
  name: string;
  legalEntityRef: string | null;
  /** Whether this person may accept for it. */
  mayAccept: boolean;
  /** Who can, for somebody who cannot: its owners' names and addresses. */
  owners: Array<{ name: string | null; email: string }>;
};

export type AgreementStatus = {
  termsAccepted: boolean;
  pendingEntities: PendingEntity[];
  /** Nothing outstanding: this person may work. */
  clear: boolean;
};

/**
 * What stands between this person and their work in this organisation.
 *
 * Only the entities they can see count. Somebody confined to one entity is
 * not held up by another they will never open; somebody whose access spans the
 * organisation is held up by every entity, because every list they see draws
 * on all of them.
 */
export async function agreementStatus(input: {
  userId: string;
  organisationId: string;
  grants: readonly Grant[];
}): Promise<AgreementStatus> {
  const [termsAccepted, unaccepted] = await Promise.all([
    hasAcceptedTerms(input.userId),
    entitiesWithoutAgreement(input.organisationId)
  ]);
  // Any grant at all, whatever it allows: a contributor who only answers
  // assessments still puts the entity's records in front of themselves.
  const visible = input.grants.some((g) => g.scope === 'organisation')
    ? null
    : input.grants.flatMap((g) => (g.scope === 'entity' ? [g.entityId] : []));
  const blocking = unaccepted.filter(
    (e) => visible === null || visible.includes(e.id)
  );
  const owners = blocking.length
    ? await ownersOf(
        input.organisationId,
        blocking.map((e) => e.id)
      )
    : [];
  const pendingEntities = blocking.map((e) => ({
    ...e,
    mayAccept: mayAcceptFor(input.grants, e.id),
    owners: owners
      .filter((o) => o.entityId === null || o.entityId === e.id)
      .map(({ name, email }) => ({ name, email }))
  }));
  return {
    termsAccepted,
    pendingEntities,
    clear: termsAccepted && pendingEntities.length === 0
  };
}

/** The owners who could accept for these entities, organisation-wide ones first. */
async function ownersOf(organisationId: string, entityIds: string[]) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        name: users.name,
        email: users.email,
        scope: roleAssignments.scope,
        entityId: roleAssignments.entityId
      })
      .from(roleAssignments)
      .innerJoin(memberships, eq(memberships.id, roleAssignments.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organisationId, organisationId),
          eq(memberships.isActive, true),
          eq(roleAssignments.role, 'owner')
        )
      )
      .orderBy(asc(roleAssignments.scope), asc(users.email));
    return rows.filter(
      (r) => r.entityId === null || entityIds.includes(r.entityId)
    );
  });
}

/**
 * Record an entity's acceptance, inside a transaction already open for its
 * organisation. Shared by accepting for an existing entity and by adding a new
 * one, so an entity added on the hosted service never exists for a moment
 * without its agreement.
 */
export async function recordEntityAgreement(
  tx: Tx,
  input: EntityAgreementInput & {
    organisationId: string;
    entity: { id: string; name: string; legalEntityRef: string | null };
    user: { id: string; email: string };
    actor: Actor;
  }
) {
  const terms = currentDocument('terms');
  const dpa = currentDocument('dpa');
  if (!input.acceptTerms)
    throw new AgreementRefused(
      `Tick the box to accept the Terms of Service for ${input.entity.name}.`
    );
  if (!input.acceptDpa)
    throw new AgreementRefused(
      `Tick the box to accept the Data Processing Agreement for ${input.entity.name}.`
    );
  if (!input.confirmAuthority)
    throw new AgreementRefused(
      `Tick the box to confirm you have authority to bind ${input.entity.name}. If you do not, ask somebody who does.`
    );
  if (input.termsVersion !== terms.version || input.dpaVersion !== dpa.version)
    throw new AgreementRefused(
      'The terms or the Data Processing Agreement changed while this page was open. Read the current versions, then accept them.'
    );
  const signatoryName = clean(input.signatoryName, 'full name');
  const signatoryPosition = clean(input.signatoryPosition, 'position');

  const [row] = await tx
    .insert(entityAgreements)
    .values({
      organisationId: input.organisationId,
      entityId: input.entity.id,
      entityName: input.entity.name,
      legalEntityRef: input.entity.legalEntityRef,
      termsVersion: terms.version,
      termsSha256: terms.sha256,
      dpaVersion: dpa.version,
      dpaSha256: dpa.sha256,
      acceptedBy: input.user.id,
      acceptedByEmail: input.user.email.toLowerCase(),
      acceptedByName: signatoryName,
      acceptedByPosition: signatoryPosition,
      authorityConfirmed: true,
      ipAddress: short(input.ipAddress, 64),
      userAgent: short(input.userAgent, 400)
    })
    // Another owner got there first, or this one from another tab: theirs is
    // the acceptance, and nothing new happened to audit.
    .onConflictDoNothing({
      target: [
        entityAgreements.entityId,
        entityAgreements.termsVersion,
        entityAgreements.dpaVersion
      ]
    })
    .returning();
  if (!row) {
    const [existing] = await tx
      .select()
      .from(entityAgreements)
      .where(
        and(
          eq(entityAgreements.entityId, input.entity.id),
          eq(entityAgreements.termsVersion, terms.version),
          eq(entityAgreements.dpaVersion, dpa.version)
        )
      );
    return existing;
  }
  await appendAuditEvent(tx, {
    ...input.actor,
    organisationId: input.organisationId,
    action: 'entity.agreements_accepted',
    subjectType: 'entity',
    subjectId: input.entity.id,
    entityId: input.entity.id,
    after: {
      agreementId: row.id,
      termsVersion: terms.version,
      termsSha256: terms.sha256,
      dpaVersion: dpa.version,
      dpaSha256: dpa.sha256,
      signatoryName,
      signatoryPosition,
      authorityConfirmed: true
    }
  });
  return row;
}

/** Accept the current documents for an entity that already exists. */
export async function acceptForEntity(
  input: EntityAgreementInput & {
    organisationId: string;
    entityId: string;
    grants: readonly Grant[];
    user: { id: string; email: string };
    actor: Actor;
  }
) {
  if (!mayAcceptFor(input.grants, input.entityId))
    throw new AgreementRefused(
      'Only an owner can accept the terms and the Data Processing Agreement for a legal entity.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const [entity] = await tx
        .select({
          id: entities.id,
          name: entities.name,
          legalEntityRef: entities.legalEntityRef
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, input.entityId),
            eq(entities.organisationId, input.organisationId)
          )
        );
      if (!entity)
        throw new AgreementRefused(
          'No such legal entity in this organisation.'
        );
      return recordEntityAgreement(tx, { ...input, entity });
    })
  );
}

/** Every acceptance for an organisation's entities, newest first. */
export async function agreementsOf(organisationId: string) {
  return withOrganisation(organisationId, () =>
    db
      .select()
      .from(entityAgreements)
      .where(eq(entityAgreements.organisationId, organisationId))
      .orderBy(desc(entityAgreements.acceptedAt))
  );
}
