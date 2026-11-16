import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql
} from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  entities,
  informationAssetActivities,
  informationAssetRisks,
  informationAssets,
  informationAssetSuppliers,
  organisations,
  processingActivities,
  referenceCounters,
  risks,
  suppliers,
  users
} from '@/db/schema';
import {
  assetGaps,
  CLASSIFICATION_SCHEMES,
  DEFAULT_CLASSIFICATION_SCHEME,
  isAssetType,
  isClassificationIn,
  isClassificationScheme,
  isHostingModel,
  type AssetClassification,
  type AssetType,
  type ClassificationScheme,
  type HostingModel
} from '@/lib/assets/register';
import { appendAuditEvent } from '@/lib/audit';

import type { Actor } from './templates';
import { assertEntityIn, assertMemberOf } from './tenancy-guards';

/**
 * The information asset register. See `lib/assets/register.ts` for what an
 * asset is and why it holds no content.
 */

export type InformationAsset = typeof informationAssets.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class AssetRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetRefused';
  }
}

/** What an asset can be linked to. */
export const LINK_KINDS = ['activity', 'supplier', 'risk'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export function isLinkKind(value: unknown): value is LinkKind {
  return (LINK_KINDS as readonly unknown[]).includes(value);
}

async function nextReference(tx: Tx, organisationId: string, year: number) {
  const rows = await tx.execute<{ next_value: number | string }>(sql`
    insert into ${referenceCounters} (organisation_id, prefix, year, next_value)
    values (${organisationId}, 'IA', ${year}, 1)
    on conflict (organisation_id, prefix, year)
      do update set next_value = ${referenceCounters}.next_value + 1
    returning next_value
  `);
  return `IA-${year}-${String(Number(rows[0]?.next_value ?? 1)).padStart(4, '0')}`;
}

async function loadForWrite(tx: Tx, id: string, organisationId: string) {
  const [row] = await tx
    .select()
    .from(informationAssets)
    .where(
      and(
        eq(informationAssets.id, id),
        eq(informationAssets.organisationId, organisationId)
      )
    )
    .for('update');
  if (!row) throw new AssetRefused('No such information asset.');
  if (row.retiredAt)
    throw new AssetRefused(
      'This asset has been retired. It is kept as it was.'
    );
  return row;
}

/** The scheme the organisation classifies on. */
export async function classificationSchemeOf(
  organisationId: string,
  executor: Pick<typeof db, 'select'> = db
): Promise<ClassificationScheme> {
  return withOrganisation(organisationId, async () => {
    const [org] = await executor
      .select({ scheme: organisations.assetClassificationScheme })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    return isClassificationScheme(org?.scheme)
      ? org.scheme
      : DEFAULT_CLASSIFICATION_SCHEME;
  });
}

/** How many assets carry a classification, which fixes the scheme. */
export async function classifiedAssetCount(
  organisationId: string,
  executor: Pick<typeof db, 'select'> = db
) {
  return withOrganisation(organisationId, async () => {
    const [row] = await executor
      .select({ n: sql<number>`count(*)::int` })
      .from(informationAssets)
      .where(
        and(
          eq(informationAssets.organisationId, organisationId),
          isNotNull(informationAssets.classification)
        )
      );
    return Number(row?.n ?? 0);
  });
}

/**
 * Choose the classification scheme. Refused once any asset is classified:
 * reclassifying is a decision for people, not a conversion.
 */
export async function setClassificationScheme(input: {
  organisationId: string;
  scheme: string;
  actor: Actor;
}) {
  const scheme = input.scheme;
  if (!isClassificationScheme(scheme))
    throw new AssetRefused('Choose one of the schemes offered.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const [org] = await tx
        .select()
        .from(organisations)
        .where(eq(organisations.id, input.organisationId))
        .for('update');
      if (!org) throw new AssetRefused('No such organisation.');
      if (org.assetClassificationScheme === scheme) return org;
      const classified = await classifiedAssetCount(input.organisationId, tx);
      if (classified > 0)
        throw new AssetRefused(
          `${classified} asset${classified === 1 ? ' is' : 's are'} already classified on the ${CLASSIFICATION_SCHEMES[org.assetClassificationScheme].inSentence}. Clear their classifications first if you mean to reclassify.`
        );
      const [updated] = await tx
        .update(organisations)
        .set({ assetClassificationScheme: scheme, updatedAt: new Date() })
        .where(eq(organisations.id, input.organisationId))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'organisation.asset_classification_scheme_set',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: { scheme: org.assetClassificationScheme },
        after: { scheme }
      });
      return updated;
    })
  );
}

async function linksOf(ids: string[]) {
  if (ids.length === 0) return { activities: [], suppliers: [], risks: [] };
  const [activityRows, supplierRows, riskRows] = await Promise.all([
    db
      .select({
        assetId: informationAssetActivities.assetId,
        id: processingActivities.id,
        reference: processingActivities.reference,
        name: processingActivities.name
      })
      .from(informationAssetActivities)
      .innerJoin(
        processingActivities,
        eq(processingActivities.id, informationAssetActivities.activityId)
      )
      .where(inArray(informationAssetActivities.assetId, ids))
      .orderBy(asc(processingActivities.reference)),
    db
      .select({
        assetId: informationAssetSuppliers.assetId,
        id: suppliers.id,
        name: suppliers.name
      })
      .from(informationAssetSuppliers)
      .innerJoin(
        suppliers,
        eq(suppliers.id, informationAssetSuppliers.supplierId)
      )
      .where(inArray(informationAssetSuppliers.assetId, ids))
      .orderBy(asc(suppliers.name)),
    db
      .select({
        assetId: informationAssetRisks.assetId,
        id: risks.id,
        reference: risks.reference,
        title: risks.title,
        status: risks.status,
        residualTier: risks.residualTier,
        inherentTier: risks.inherentTier
      })
      .from(informationAssetRisks)
      .innerJoin(risks, eq(risks.id, informationAssetRisks.riskId))
      .where(inArray(informationAssetRisks.assetId, ids))
      .orderBy(asc(risks.reference))
  ]);
  return {
    activities: activityRows,
    suppliers: supplierRows,
    risks: riskRows
  };
}

async function rowsFor(where: ReturnType<typeof and>, now: Date) {
  const rows = await db
    .select({
      asset: informationAssets,
      entityName: entities.name,
      ownerEmail: users.email
    })
    .from(informationAssets)
    .innerJoin(entities, eq(entities.id, informationAssets.entityId))
    .leftJoin(users, eq(users.id, informationAssets.ownerId))
    .where(where)
    .orderBy(asc(informationAssets.reference));
  const links = await linksOf(rows.map((r) => r.asset.id));
  return rows.map((r) => {
    const mine = <T extends { assetId: string }>(list: T[]) =>
      list.filter((l) => l.assetId === r.asset.id);
    return {
      ...r,
      activities: mine(links.activities),
      suppliers: mine(links.suppliers),
      risks: mine(links.risks),
      gaps: assetGaps(r.asset, now)
    };
  });
}

export type AssetRow = Awaited<ReturnType<typeof rowsFor>>[number];

/**
 * Every asset the viewer can see, retired ones included; the page filters.
 *
 * @param entityIds the entities visible, or null for all of them
 */
export async function assetRegister(
  organisationId: string,
  entityIds: string[] | null,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    if (entityIds !== null && entityIds.length === 0) return [];
    return rowsFor(
      entityIds === null
        ? eq(informationAssets.organisationId, organisationId)
        : and(
            eq(informationAssets.organisationId, organisationId),
            inArray(informationAssets.entityId, entityIds)
          ),
      now
    );
  });
}

export async function loadAsset(
  id: string,
  organisationId: string,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    const [row] = await rowsFor(
      and(
        eq(informationAssets.id, id),
        eq(informationAssets.organisationId, organisationId)
      ),
      now
    );
    return row ?? null;
  });
}

/**
 * The assets linked to a processing activity, supplier or risk, for the
 * reverse links on those pages: only those in entities the viewer can see.
 */
export async function assetsFor(
  organisationId: string,
  about: { activityId: string } | { supplierId: string } | { riskId: string },
  entityIds: string[] | null
) {
  return withOrganisation(organisationId, async () => {
    if (entityIds !== null && entityIds.length === 0) return [];
    const linked =
      'activityId' in about
        ? db
            .select({ id: informationAssetActivities.assetId })
            .from(informationAssetActivities)
            .where(
              and(
                eq(informationAssetActivities.organisationId, organisationId),
                eq(informationAssetActivities.activityId, about.activityId)
              )
            )
        : 'supplierId' in about
          ? db
              .select({ id: informationAssetSuppliers.assetId })
              .from(informationAssetSuppliers)
              .where(
                and(
                  eq(informationAssetSuppliers.organisationId, organisationId),
                  eq(informationAssetSuppliers.supplierId, about.supplierId)
                )
              )
          : db
              .select({ id: informationAssetRisks.assetId })
              .from(informationAssetRisks)
              .where(
                and(
                  eq(informationAssetRisks.organisationId, organisationId),
                  eq(informationAssetRisks.riskId, about.riskId)
                )
              );
    return db
      .select({
        id: informationAssets.id,
        reference: informationAssets.reference,
        name: informationAssets.name,
        assetType: informationAssets.assetType,
        retiredAt: informationAssets.retiredAt
      })
      .from(informationAssets)
      .where(
        and(
          eq(informationAssets.organisationId, organisationId),
          inArray(informationAssets.id, linked),
          entityIds === null
            ? undefined
            : inArray(informationAssets.entityId, entityIds)
        )
      )
      .orderBy(asc(informationAssets.reference));
  });
}

/** What can be linked to an asset: its entity's activities and risks, and any supplier. */
export async function linkOptions(organisationId: string, entityId: string) {
  return withOrganisation(organisationId, async () => {
    const [activityRows, supplierRows, riskRows] = await Promise.all([
      db
        .select({
          id: processingActivities.id,
          label: sql<string>`${processingActivities.reference} || ' ' || ${processingActivities.name}`
        })
        .from(processingActivities)
        .where(
          and(
            eq(processingActivities.organisationId, organisationId),
            eq(processingActivities.entityId, entityId)
          )
        )
        .orderBy(asc(processingActivities.reference)),
      db
        .select({ id: suppliers.id, label: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.organisationId, organisationId))
        .orderBy(asc(suppliers.name)),
      db
        .select({
          id: risks.id,
          label: sql<string>`${risks.reference} || ' ' || ${risks.title}`
        })
        .from(risks)
        .where(
          and(
            eq(risks.organisationId, organisationId),
            eq(risks.entityId, entityId)
          )
        )
        .orderBy(asc(risks.reference))
    ]);
    return {
      activity: activityRows,
      supplier: supplierRows,
      risk: riskRows
    } satisfies Record<LinkKind, Array<{ id: string; label: string }>>;
  });
}

export type AssetDetails = {
  name: string;
  description: string | null;
  assetType: string;
  ownerId: string | null;
  hosting: string | null;
  hostedBy: string | null;
  region: string | null;
  countries: readonly string[];
  classification: string | null;
  retention: string | null;
  nextReviewAt: Date | null;
};

/** The details as they will be stored, or a refusal saying what is wrong. */
async function clean(
  organisationId: string,
  d: AssetDetails,
  tx: Tx
): Promise<{
  name: string;
  description: string | null;
  assetType: AssetType;
  ownerId: string | null;
  hosting: HostingModel | null;
  hostedBy: string | null;
  region: string | null;
  countries: string[];
  classification: AssetClassification | null;
  retention: string | null;
  nextReviewAt: Date | null;
}> {
  const name = d.name.trim();
  if (!name) throw new AssetRefused('Give the asset a name.');
  if (!isAssetType(d.assetType))
    throw new AssetRefused('Choose what kind of asset it is.');
  if (d.hosting && !isHostingModel(d.hosting))
    throw new AssetRefused('Choose where it is hosted from the list.');
  if (d.ownerId) await assertMemberOf(organisationId, d.ownerId, tx);
  let classification: AssetClassification | null = null;
  if (d.classification) {
    const scheme = await classificationSchemeOf(organisationId, tx);
    if (!isClassificationIn(scheme, d.classification))
      throw new AssetRefused(
        `That is not a level of the ${CLASSIFICATION_SCHEMES[scheme].inSentence}, which this organisation uses.`
      );
    classification = d.classification;
  }
  return {
    name,
    description: d.description?.trim() || null,
    assetType: d.assetType,
    ownerId: d.ownerId || null,
    hosting: (d.hosting || null) as HostingModel | null,
    hostedBy: d.hostedBy?.trim() || null,
    region: d.region?.trim() || null,
    countries: [...new Set(d.countries.map((c) => c.trim()).filter(Boolean))],
    classification,
    retention: d.retention?.trim() || null,
    nextReviewAt: d.nextReviewAt
  };
}

const AUDITED = [
  'name',
  'assetType',
  'ownerId',
  'hosting',
  'hostedBy',
  'region',
  'countries',
  'classification',
  'retention',
  'nextReviewAt'
] as const;

function audited(row: Partial<InformationAsset>) {
  return Object.fromEntries(AUDITED.map((k) => [k, row[k] ?? null]));
}

export async function createAsset(input: {
  organisationId: string;
  entityId: string;
  details: AssetDetails;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEntityIn(input.organisationId, input.entityId, tx);
      const details = await clean(input.organisationId, input.details, tx);
      const reference = await nextReference(
        tx,
        input.organisationId,
        new Date().getUTCFullYear()
      );
      const [row] = await tx
        .insert(informationAssets)
        .values({
          organisationId: input.organisationId,
          entityId: input.entityId,
          reference,
          ...details
        })
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.entityId,
        action: 'information_asset.created',
        subjectType: 'information_asset',
        subjectId: row.id,
        after: { reference, ...audited(row) }
      });
      return row;
    })
  );
}

export async function updateAsset(input: {
  id: string;
  organisationId: string;
  details: AssetDetails;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.id, input.organisationId);
      const details = await clean(input.organisationId, input.details, tx);
      const [after] = await tx
        .update(informationAssets)
        .set({ ...details, updatedAt: new Date() })
        .where(eq(informationAssets.id, input.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'information_asset.updated',
        subjectType: 'information_asset',
        subjectId: input.id,
        before: audited(before),
        after: audited(after)
      });
      return after;
    })
  );
}

/** Reviewed today, with when it is next due. */
export async function recordAssetReview(input: {
  id: string;
  organisationId: string;
  nextReviewAt: Date;
  actor: Actor;
}) {
  if (input.nextReviewAt.getTime() <= Date.now())
    throw new AssetRefused('The next review must be in the future.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.id, input.organisationId);
      const reviewedAt = new Date();
      const [after] = await tx
        .update(informationAssets)
        .set({
          lastReviewedAt: reviewedAt,
          nextReviewAt: input.nextReviewAt,
          updatedAt: reviewedAt
        })
        .where(eq(informationAssets.id, input.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'information_asset.reviewed',
        subjectType: 'information_asset',
        subjectId: input.id,
        before: { nextReviewAt: before.nextReviewAt },
        after: { reviewedAt, nextReviewAt: input.nextReviewAt }
      });
      return after;
    })
  );
}

/** No longer in use. Kept, with its links, and from then owes nothing. */
export async function retireAsset(input: {
  id: string;
  organisationId: string;
  reason: string;
  actor: Actor;
}) {
  const reason = input.reason.trim();
  if (!reason)
    throw new AssetRefused(
      'Say why it is retired: decommissioned, replaced, or never ours.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.id, input.organisationId);
      const retiredAt = new Date();
      const [after] = await tx
        .update(informationAssets)
        .set({ retiredAt, retiredReason: reason, updatedAt: retiredAt })
        .where(eq(informationAssets.id, input.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'information_asset.retired',
        subjectType: 'information_asset',
        subjectId: input.id,
        after: { retiredAt, reason }
      });
      return after;
    })
  );
}

/**
 * The record a link points at, checked to belong to this organisation and,
 * for an activity or a risk, to the asset's own legal entity: access is
 * scoped by entity, and a link must not show one entity's records to people
 * who may see only another's.
 */
async function target(
  tx: Tx,
  organisationId: string,
  entityId: string,
  kind: LinkKind,
  id: string
): Promise<{ id: string; label: string }> {
  if (kind === 'supplier') {
    const [row] = await tx
      .select({ id: suppliers.id, label: suppliers.name })
      .from(suppliers)
      .where(
        and(eq(suppliers.id, id), eq(suppliers.organisationId, organisationId))
      );
    if (!row)
      throw new AssetRefused('No such third party in this organisation.');
    return row;
  }
  const table = kind === 'activity' ? processingActivities : risks;
  const [row] = await tx
    .select({
      id: table.id,
      entityId: table.entityId,
      label: table.reference
    })
    .from(table)
    .where(and(eq(table.id, id), eq(table.organisationId, organisationId)));
  const what = kind === 'activity' ? 'processing activity' : 'risk';
  if (!row) throw new AssetRefused(`No such ${what} in this organisation.`);
  if (row.entityId !== entityId)
    throw new AssetRefused(
      `That ${what} belongs to another legal entity. Link an asset only to its own entity's ${what === 'risk' ? 'risks' : 'processing activities'}.`
    );
  return row;
}

function linkTable(kind: LinkKind) {
  return kind === 'activity'
    ? {
        table: informationAssetActivities,
        column: informationAssetActivities.activityId,
        key: 'activityId' as const
      }
    : kind === 'supplier'
      ? {
          table: informationAssetSuppliers,
          column: informationAssetSuppliers.supplierId,
          key: 'supplierId' as const
        }
      : {
          table: informationAssetRisks,
          column: informationAssetRisks.riskId,
          key: 'riskId' as const
        };
}

export async function linkAsset(input: {
  assetId: string;
  organisationId: string;
  kind: LinkKind;
  targetId: string;
  actor: Actor;
}) {
  if (!isLinkKind(input.kind)) throw new AssetRefused('Nothing to link.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const asset = await loadForWrite(tx, input.assetId, input.organisationId);
      const found = await target(
        tx,
        input.organisationId,
        asset.entityId,
        input.kind,
        input.targetId
      );
      const { table, key } = linkTable(input.kind);
      const inserted = await tx
        .insert(table)
        .values({
          organisationId: input.organisationId,
          assetId: asset.id,
          [key]: found.id
        } as typeof table.$inferInsert)
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0)
        throw new AssetRefused(`${found.label} is already linked.`);
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: asset.entityId,
        action: 'information_asset.linked',
        subjectType: 'information_asset',
        subjectId: asset.id,
        after: { kind: input.kind, id: found.id, label: found.label }
      });
    })
  );
}

export async function unlinkAsset(input: {
  assetId: string;
  organisationId: string;
  kind: LinkKind;
  targetId: string;
  actor: Actor;
}) {
  if (!isLinkKind(input.kind)) throw new AssetRefused('Nothing to unlink.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const asset = await loadForWrite(tx, input.assetId, input.organisationId);
      const { table, column } = linkTable(input.kind);
      const removed = await tx
        .delete(table)
        .where(
          and(
            eq(table.organisationId, input.organisationId),
            eq(table.assetId, asset.id),
            eq(column, input.targetId)
          )
        )
        .returning();
      if (removed.length === 0) throw new AssetRefused('That is not linked.');
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: asset.entityId,
        action: 'information_asset.unlinked',
        subjectType: 'information_asset',
        subjectId: asset.id,
        before: { kind: input.kind, id: input.targetId }
      });
    })
  );
}

/** Assets in use whose review date has passed, oldest first. For the sweep. */
export async function assetsDueForReview(
  organisationId: string,
  now = new Date()
) {
  return withOrganisation(organisationId, () =>
    db
      .select()
      .from(informationAssets)
      .where(
        and(
          eq(informationAssets.organisationId, organisationId),
          isNull(informationAssets.retiredAt),
          lte(informationAssets.nextReviewAt, now)
        )
      )
      .orderBy(asc(informationAssets.nextReviewAt))
  );
}
