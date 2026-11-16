import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db, withOrganisation } from '@/db/client';
import {
  documents,
  entities,
  memberships,
  referenceCounters,
  supplierContracts,
  supplierContractViewers,
  suppliers,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { can, type Grant } from '@/lib/rbac';
import {
  isCurrency,
  noticeBy,
  noticeState,
  type NoticeState
} from '@/lib/thirdparty/contracts';

import type { Actor } from './templates';
import { assertEntityIn } from './tenancy-guards';

/**
 * Commercial contracts with suppliers. See `lib/thirdparty/contracts.ts`.
 *
 * A contract's commercial terms - its value and its signed copy - are shown
 * only to whoever added it, the members they named, and those holding
 * `contract.confidential`. Nothing about the terms is written to the audit
 * trail beyond the fact that they changed, because the audit log is read by
 * auditors who may not see them. Everything else is read like any other
 * record, so the people who must act on a renewal always see it coming.
 */

export type Contract = typeof supplierContracts.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Who is asking: the commercial terms depend on it. */
export type ContractViewer = { userId: string; grants: readonly Grant[] };

export class ContractRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractRefused';
  }
}

export type ContractTerms = { value: string | null; currency: string | null };

export type ContractDetails = {
  title: string;
  ownerId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  noticeDays: number | null;
  autoRenews: boolean;
};

async function nextReference(tx: Tx, organisationId: string, year: number) {
  const rows = await tx.execute<{ next_value: number | string }>(sql`
    insert into ${referenceCounters} (organisation_id, prefix, year, next_value)
    values (${organisationId}, 'CON', ${year}, 1)
    on conflict (organisation_id, prefix, year)
      do update set next_value = ${referenceCounters}.next_value + 1
    returning next_value
  `);
  return `CON-${year}-${String(Number(rows[0]?.next_value ?? 1)).padStart(4, '0')}`;
}

/** Whether this viewer may see this contract's commercial terms. */
export function mayReadTerms(
  contract: Pick<Contract, 'createdBy' | 'entityId'>,
  named: ReadonlySet<string>,
  viewer: ContractViewer
): boolean {
  return (
    contract.createdBy === viewer.userId ||
    named.has(viewer.userId) ||
    can(viewer.grants, 'contract.confidential', contract.entityId)
  );
}

/** Whether this viewer may decide who sees the terms: whoever added it, or a holder of `contract.confidential`. */
function mayShare(
  contract: Pick<Contract, 'createdBy' | 'entityId'>,
  viewer: ContractViewer
): boolean {
  return (
    contract.createdBy === viewer.userId ||
    can(viewer.grants, 'contract.confidential', contract.entityId)
  );
}

function cleanDetails(d: ContractDetails): ContractDetails {
  const title = d.title.trim();
  if (!title) throw new ContractRefused('Give the contract a title.');
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt)
    throw new ContractRefused('It cannot end before it starts.');
  if (
    d.noticeDays !== null &&
    (!Number.isInteger(d.noticeDays) || d.noticeDays < 0)
  )
    throw new ContractRefused('The notice period is a whole number of days.');
  return { ...d, title };
}

function cleanTerms(t: ContractTerms): ContractTerms {
  const raw = t.value?.replace(/[,\s£$€]/g, '') ?? '';
  if (raw && !/^\d{1,14}(\.\d{1,2})?$/.test(raw))
    throw new ContractRefused(
      'Give the value as an amount, such as 120000 or 4500.50.'
    );
  const currency = t.currency?.trim().toUpperCase() || null;
  if (currency && !isCurrency(currency))
    throw new ContractRefused(
      'Give the currency as its three-letter code, such as GBP or EUR.'
    );
  if (raw && !currency)
    throw new ContractRefused('Say which currency the value is in.');
  return { value: raw || null, currency };
}

/** Members of the organisation who may be named now: active ones. */
async function assertActiveMembers(
  organisationId: string,
  userIds: readonly string[],
  tx: Tx
) {
  if (userIds.length === 0) return;
  const found = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organisationId, organisationId),
        eq(memberships.isActive, true),
        inArray(memberships.userId, [...userIds])
      )
    );
  if (found.length !== new Set(userIds).size)
    throw new ContractRefused(
      'Only current members of this organisation can be named.'
    );
}

async function supplierOf(tx: Tx, organisationId: string, supplierId: string) {
  const [row] = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organisationId, organisationId)
      )
    );
  if (!row)
    throw new ContractRefused('No such third party in this organisation.');
  return row;
}

async function loadForWrite(tx: Tx, id: string, organisationId: string) {
  const [row] = await tx
    .select()
    .from(supplierContracts)
    .where(
      and(
        eq(supplierContracts.id, id),
        eq(supplierContracts.organisationId, organisationId)
      )
    )
    .for('update');
  if (!row) throw new ContractRefused('No such contract.');
  if (row.endedAt)
    throw new ContractRefused('This contract has ended. It is kept as it was.');
  return row;
}

async function namedFor(tx: Tx | typeof db, contractIds: string[]) {
  if (contractIds.length === 0) return new Map<string, Set<string>>();
  const rows = await tx
    .select({
      contractId: supplierContractViewers.contractId,
      userId: supplierContractViewers.userId
    })
    .from(supplierContractViewers)
    .where(inArray(supplierContractViewers.contractId, contractIds));
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = map.get(r.contractId) ?? new Set<string>();
    set.add(r.userId);
    map.set(r.contractId, set);
  }
  return map;
}

const owner = alias(users, 'contract_owner');

async function rowsFor(
  where: ReturnType<typeof and>,
  viewer: ContractViewer,
  now: Date
) {
  const rows = await db
    .select({
      contract: supplierContracts,
      supplierName: suppliers.name,
      entityName: entities.name,
      ownerEmail: owner.email
    })
    .from(supplierContracts)
    .innerJoin(suppliers, eq(suppliers.id, supplierContracts.supplierId))
    .innerJoin(entities, eq(entities.id, supplierContracts.entityId))
    .leftJoin(owner, eq(owner.id, supplierContracts.ownerId))
    .where(where)
    .orderBy(asc(supplierContracts.reference));
  const named = await namedFor(
    db,
    rows.map((r) => r.contract.id)
  );
  return rows.map((r) => {
    const names = named.get(r.contract.id) ?? new Set<string>();
    const termsVisible = mayReadTerms(r.contract, names, viewer);
    return {
      ...r,
      // The terms leave the service only for those who may see them.
      contract: termsVisible
        ? r.contract
        : { ...r.contract, value: null, currency: null },
      termsVisible,
      mayShare: mayShare(r.contract, viewer),
      noticeBy: noticeBy(r.contract),
      notice: noticeState(r.contract, now) as NoticeState
    };
  });
}

export type ContractRow = Awaited<ReturnType<typeof rowsFor>>[number];

/**
 * Every contract in the entities the viewer can see, with the terms of those
 * they may see.
 *
 * @param entityIds the entities visible, or null for all of them
 */
export async function contractRegister(
  organisationId: string,
  entityIds: string[] | null,
  viewer: ContractViewer,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    if (entityIds !== null && entityIds.length === 0) return [];
    return rowsFor(
      entityIds === null
        ? eq(supplierContracts.organisationId, organisationId)
        : and(
            eq(supplierContracts.organisationId, organisationId),
            inArray(supplierContracts.entityId, entityIds)
          ),
      viewer,
      now
    );
  });
}

/** One supplier's contracts, in the entities the viewer can see. */
export async function contractsFor(
  organisationId: string,
  supplierId: string,
  entityIds: string[] | null,
  viewer: ContractViewer,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    if (entityIds !== null && entityIds.length === 0) return [];
    return rowsFor(
      and(
        eq(supplierContracts.organisationId, organisationId),
        eq(supplierContracts.supplierId, supplierId),
        entityIds === null
          ? undefined
          : inArray(supplierContracts.entityId, entityIds)
      ),
      viewer,
      now
    );
  });
}

/** One contract, with who is named to see its terms when the viewer may see them. */
export async function loadContract(
  id: string,
  organisationId: string,
  viewer: ContractViewer,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    const [row] = await rowsFor(
      and(
        eq(supplierContracts.id, id),
        eq(supplierContracts.organisationId, organisationId)
      ),
      viewer,
      now
    );
    if (!row) return null;
    const named = row.termsVisible
      ? await db
          .select({ id: users.id, email: users.email })
          .from(supplierContractViewers)
          .innerJoin(users, eq(users.id, supplierContractViewers.userId))
          .where(eq(supplierContractViewers.contractId, id))
          .orderBy(asc(users.email))
      : [];
    return { ...row, named };
  });
}

export async function createContract(input: {
  organisationId: string;
  entityId: string;
  supplierId: string;
  details: ContractDetails;
  terms: ContractTerms;
  /** Members allowed to see the terms, besides whoever adds it. */
  viewerIds: readonly string[];
  actor: Actor;
}) {
  if (!input.actor.actorUserId)
    throw new ContractRefused('A contract is added by a named person.');
  const details = cleanDetails(input.details);
  const terms = cleanTerms(input.terms);
  const viewerIds = [...new Set(input.viewerIds)];
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEntityIn(input.organisationId, input.entityId, tx);
      const supplier = await supplierOf(
        tx,
        input.organisationId,
        input.supplierId
      );
      if (details.ownerId)
        await assertActiveMembers(input.organisationId, [details.ownerId], tx);
      await assertActiveMembers(input.organisationId, viewerIds, tx);
      const reference = await nextReference(
        tx,
        input.organisationId,
        new Date().getUTCFullYear()
      );
      const [row] = await tx
        .insert(supplierContracts)
        .values({
          organisationId: input.organisationId,
          entityId: input.entityId,
          supplierId: supplier.id,
          reference,
          ...details,
          ...terms,
          createdBy: input.actor.actorUserId
        })
        .returning();
      if (viewerIds.length > 0)
        await tx.insert(supplierContractViewers).values(
          viewerIds.map((userId) => ({
            organisationId: input.organisationId,
            contractId: row.id,
            userId
          }))
        );
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.entityId,
        action: 'supplier_contract.created',
        subjectType: 'supplier_contract',
        subjectId: row.id,
        after: {
          reference,
          supplier: supplier.id,
          ...audited(row),
          termsRecorded: terms.value !== null,
          viewers: viewerIds
        }
      });
      return row;
    })
  );
}

/** What the audit trail records of a contract: never its terms. */
function audited(row: Contract) {
  return {
    title: row.title,
    ownerId: row.ownerId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    noticeDays: row.noticeDays,
    autoRenews: row.autoRenews
  };
}

/**
 * Change a contract. Its terms change only when given, and only by someone
 * who may see them: a person who cannot see the value must not be able to
 * overwrite it unseen.
 */
export async function updateContract(input: {
  id: string;
  organisationId: string;
  details: ContractDetails;
  terms?: ContractTerms;
  viewer: ContractViewer;
  actor: Actor;
}) {
  const details = cleanDetails(input.details);
  const terms = input.terms ? cleanTerms(input.terms) : undefined;
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.id, input.organisationId);
      if (terms) {
        const named = (await namedFor(tx, [before.id])).get(before.id);
        if (!mayReadTerms(before, named ?? new Set(), input.viewer))
          throw new ContractRefused(
            'You may not see or change this contract’s commercial terms.'
          );
      }
      if (details.ownerId && details.ownerId !== before.ownerId)
        await assertActiveMembers(input.organisationId, [details.ownerId], tx);
      const [after] = await tx
        .update(supplierContracts)
        .set({ ...details, ...(terms ?? {}), updatedAt: new Date() })
        .where(eq(supplierContracts.id, input.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'supplier_contract.updated',
        subjectType: 'supplier_contract',
        subjectId: input.id,
        before: audited(before),
        after: {
          ...audited(after),
          termsChanged:
            terms !== undefined &&
            (before.value !== after.value || before.currency !== after.currency)
        }
      });
      return after;
    })
  );
}

/** Name who may see the terms. Only whoever added it, or a holder of `contract.confidential`. */
export async function setContractViewers(input: {
  id: string;
  organisationId: string;
  userIds: readonly string[];
  viewer: ContractViewer;
  actor: Actor;
}) {
  const userIds = [...new Set(input.userIds)];
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const contract = await loadForWrite(tx, input.id, input.organisationId);
      if (!mayShare(contract, input.viewer))
        throw new ContractRefused(
          'Only whoever added the contract, or someone who may see every contract’s terms, can change who sees them.'
        );
      const before = [
        ...((await namedFor(tx, [contract.id])).get(contract.id) ?? [])
      ];
      // Somebody already named stays named even if they have since left, so
      // saving the list unchanged does not fail; only new names must be current.
      await assertActiveMembers(
        input.organisationId,
        userIds.filter((u) => !before.includes(u)),
        tx
      );
      await tx
        .delete(supplierContractViewers)
        .where(eq(supplierContractViewers.contractId, contract.id));
      if (userIds.length > 0)
        await tx.insert(supplierContractViewers).values(
          userIds.map((userId) => ({
            organisationId: input.organisationId,
            contractId: contract.id,
            userId
          }))
        );
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: contract.entityId,
        action: 'supplier_contract.viewers_set',
        subjectType: 'supplier_contract',
        subjectId: contract.id,
        before: { viewers: before.sort() },
        after: { viewers: [...userIds].sort() }
      });
    })
  );
}

/** No longer in force: kept, and owes no more reminders. */
export async function endContract(input: {
  id: string;
  organisationId: string;
  reason: string;
  actor: Actor;
}) {
  const reason = input.reason.trim();
  if (!reason)
    throw new ContractRefused(
      'Say why it ended: expired, terminated, or replaced by another.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.id, input.organisationId);
      const endedAt = new Date();
      const [after] = await tx
        .update(supplierContracts)
        .set({ endedAt, endedReason: reason, updatedAt: endedAt })
        .where(eq(supplierContracts.id, input.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'supplier_contract.ended',
        subjectType: 'supplier_contract',
        subjectId: input.id,
        after: { endedAt, reason }
      });
      return after;
    })
  );
}

/**
 * For a stored file: true or false when it is attached to a contract, by
 * whether this viewer may see that contract's terms; null when it is not a
 * contract's, and the usual record access decides.
 */
export async function mayReadContractDocument(
  organisationId: string,
  documentId: string,
  viewer: ContractViewer
): Promise<boolean | null> {
  return withOrganisation(organisationId, async () => {
    const [doc] = await db
      .select({
        subjectType: documents.subjectType,
        subjectId: documents.subjectId
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organisationId, organisationId)
        )
      );
    if (!doc || doc.subjectType !== 'supplier_contract') return null;
    return mayReadContractTerms(organisationId, doc.subjectId, viewer);
  });
}

/** Whether this viewer may see one contract's terms. False for a contract not in this organisation. */
export async function mayReadContractTerms(
  organisationId: string,
  contractId: string,
  viewer: ContractViewer
): Promise<boolean> {
  return withOrganisation(organisationId, async () => {
    const [contract] = await db
      .select({
        id: supplierContracts.id,
        createdBy: supplierContracts.createdBy,
        entityId: supplierContracts.entityId
      })
      .from(supplierContracts)
      .where(
        and(
          eq(supplierContracts.id, contractId),
          eq(supplierContracts.organisationId, organisationId)
        )
      );
    if (!contract) return false;
    const named = (await namedFor(db, [contract.id])).get(contract.id);
    return mayReadTerms(contract, named ?? new Set(), viewer);
  });
}

/** Contracts in force whose notice date is near or past. For the sweep. */
export async function contractsNeedingNotice(
  organisationId: string,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select()
      .from(supplierContracts)
      .where(
        and(
          eq(supplierContracts.organisationId, organisationId),
          isNull(supplierContracts.endedAt)
        )
      );
    return rows
      .map((contract) => ({
        contract,
        noticeBy: noticeBy(contract),
        notice: noticeState(contract, now)
      }))
      .filter((r) => r.notice === 'due_soon' || r.notice === 'passed');
  });
}
