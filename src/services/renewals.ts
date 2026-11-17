import { and, eq, inArray, isNotNull, isNull, like, ne, or } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  entities,
  informationAssets,
  supplierContracts,
  suppliers,
  tasks
} from '@/db/schema';
import {
  needsAttention,
  noticeBy,
  noticeState,
  reminderKey,
  reminderKeyPatterns,
  type NoticeState,
  type RenewalDates,
  type RenewalSubject
} from '@/lib/renewals';

/**
 * Renewals across the registers: supplier contracts, and assets whose type
 * carries an expiry date. See `lib/renewals.ts`.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Close a record's open renewal reminders that no longer apply: all of them
 * once it has ended or been retired, otherwise any but the one its dates
 * call for now. A reminder for a notice date that has moved would otherwise
 * sit open and overdue.
 */
export async function retireRenewalReminders(
  tx: Tx,
  organisationId: string,
  subject: RenewalSubject,
  record: RenewalDates & { id: string },
  label: string,
  now = new Date()
) {
  const keep = record.endedAt ? null : reminderKey(subject, record, now);
  await tx
    .update(tasks)
    .set({
      status: record.endedAt ? 'done' : 'cancelled',
      completedAt: now,
      completedByLabel: label
    })
    .where(
      and(
        eq(tasks.organisationId, organisationId),
        or(
          ...reminderKeyPatterns(subject, record.id).map((p) =>
            like(tasks.idempotencyKey, p)
          )
        ),
        inArray(tasks.status, ['open', 'in_progress']),
        keep ? ne(tasks.idempotencyKey, keep) : undefined
      )
    );
}

/** An asset's renewal dates, in the shape contracts have. */
export function assetRenewal(asset: {
  id: string;
  expiresAt: Date | null;
  noticeDays: number | null;
  autoRenews: boolean;
  retiredAt: Date | null;
}): RenewalDates & { id: string } {
  return {
    id: asset.id,
    endsAt: asset.expiresAt,
    noticeDays: asset.noticeDays,
    autoRenews: asset.autoRenews,
    endedAt: asset.retiredAt
  };
}

export type Renewal = {
  subject: RenewalSubject;
  id: string;
  reference: string;
  title: string;
  /** The supplier for a contract; the entity for an asset. */
  context: string;
  endsAt: Date;
  noticeBy: Date;
  notice: NoticeState;
};

/**
 * Contracts and assets whose notice date is near or past, or which have
 * renewed without a new end date, soonest first: the governance overview's
 * renewals. Dates only, never a contract's terms.
 *
 * @param entityIds the entities visible, or null for all of them
 */
export async function upcomingRenewals(
  organisationId: string,
  entityIds: string[] | null,
  now = new Date()
): Promise<Renewal[]> {
  return withOrganisation(organisationId, async () => {
    if (entityIds !== null && entityIds.length === 0) return [];
    const [contracts, assets] = await Promise.all([
      db
        .select({
          contract: supplierContracts,
          supplierName: suppliers.name
        })
        .from(supplierContracts)
        .innerJoin(suppliers, eq(suppliers.id, supplierContracts.supplierId))
        .where(
          and(
            eq(supplierContracts.organisationId, organisationId),
            isNull(supplierContracts.endedAt),
            isNotNull(supplierContracts.endsAt),
            entityIds === null
              ? undefined
              : inArray(supplierContracts.entityId, entityIds)
          )
        ),
      db
        .select({ asset: informationAssets, entityName: entities.name })
        .from(informationAssets)
        .innerJoin(entities, eq(entities.id, informationAssets.entityId))
        .where(
          and(
            eq(informationAssets.organisationId, organisationId),
            isNull(informationAssets.retiredAt),
            isNotNull(informationAssets.expiresAt),
            entityIds === null
              ? undefined
              : inArray(informationAssets.entityId, entityIds)
          )
        )
    ]);
    const renewals: Renewal[] = [
      ...contracts.map(({ contract, supplierName }) => ({
        subject: 'contract' as const,
        id: contract.id,
        reference: contract.reference,
        title: contract.title,
        context: supplierName,
        dates: contract
      })),
      ...assets.map(({ asset, entityName }) => ({
        subject: 'asset' as const,
        id: asset.id,
        reference: asset.reference,
        title: asset.name,
        context: entityName,
        dates: assetRenewal(asset)
      }))
    ].flatMap(({ dates, ...r }) => {
      const notice = noticeState(dates, now);
      return needsAttention(notice)
        ? [{ ...r, endsAt: dates.endsAt!, noticeBy: noticeBy(dates)!, notice }]
        : [];
    });
    return renewals.sort((a, b) => a.noticeBy.getTime() - b.noticeBy.getTime());
  });
}
