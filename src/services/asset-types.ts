import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { assetTypes, informationAssets } from '@/db/schema';
import {
  assetTypeKeyFrom,
  BUILT_IN_ASSET_TYPES,
  isBuiltInAssetType,
  typology,
  type AssetTypeDef
} from '@/lib/assets/types';
import { appendAuditEvent } from '@/lib/audit';

import type { Actor } from './templates';

/**
 * The organisation's own asset types, added to the built-in ones. See
 * `lib/assets/types.ts`.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;

export class AssetTypeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetTypeRefused';
  }
}

async function ownTypes(reader: Reader, organisationId: string) {
  return reader
    .select({
      key: assetTypes.key,
      label: assetTypes.label,
      definition: assetTypes.definition,
      hasExpiry: assetTypes.hasExpiry,
      retiredAt: assetTypes.retiredAt
    })
    .from(assetTypes)
    .where(eq(assetTypes.organisationId, organisationId))
    .orderBy(asc(assetTypes.label));
}

/**
 * Every type, built-in and the organisation's own, retired ones included.
 * Inside a service's transaction `db` is that transaction, so this reads
 * what it has written.
 */
export async function assetTypology(
  organisationId: string
): Promise<AssetTypeDef[]> {
  return withOrganisation(organisationId, async () =>
    typology(await ownTypes(db, organisationId))
  );
}

/** The organisation's own types with how many assets have each, for the page that manages them. */
export async function ownAssetTypes(organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const [own, counts] = await Promise.all([
      db
        .select()
        .from(assetTypes)
        .where(eq(assetTypes.organisationId, organisationId))
        .orderBy(asc(assetTypes.label)),
      db
        .select({
          key: informationAssets.assetType,
          n: sql<number>`count(*)::int`
        })
        .from(informationAssets)
        .where(eq(informationAssets.organisationId, organisationId))
        .groupBy(informationAssets.assetType)
    ]);
    const used = new Map(counts.map((c) => [c.key, Number(c.n)]));
    return own.map((t) => ({ ...t, assets: used.get(t.key) ?? 0 }));
  });
}

export type AssetTypeInput = {
  label: string;
  definition: string;
  hasExpiry: boolean;
};

function cleanInput(input: AssetTypeInput) {
  const label = input.label.trim().replace(/\s+/g, ' ');
  const definition = input.definition.trim();
  if (!label) throw new AssetTypeRefused('Give the type a name.');
  if (label.length > 60)
    throw new AssetTypeRefused('Keep the name to 60 characters.');
  if (!definition)
    throw new AssetTypeRefused(
      'Define the type: say what belongs under it, so everyone uses it the same way.'
    );
  if (definition.length > 1000)
    throw new AssetTypeRefused('Keep the definition to 1,000 characters.');
  return { label, definition, hasExpiry: Boolean(input.hasExpiry) };
}

/** Refuse a name another type already has, built-in or the organisation's own. */
async function assertNameFree(
  tx: Tx,
  organisationId: string,
  label: string,
  except?: string
) {
  const lower = label.toLowerCase();
  const taken =
    BUILT_IN_ASSET_TYPES.some((t) => t.label.toLowerCase() === lower) ||
    (await ownTypes(tx, organisationId)).some(
      (t) => t.key !== except && t.label.toLowerCase() === lower
    );
  if (taken)
    throw new AssetTypeRefused(`There is already a type called ${label}.`);
}

const audited = (t: typeof assetTypes.$inferSelect) => ({
  key: t.key,
  label: t.label,
  definition: t.definition,
  hasExpiry: t.hasExpiry,
  retiredAt: t.retiredAt
});

/** The key, or with the first numeric suffix no other type holds. */
function freeKey(base: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? '' : `_${n}`;
    const key = `${base.slice(0, 40 - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!taken.has(key)) return key;
  }
}

export async function createAssetType(input: {
  organisationId: string;
  type: AssetTypeInput;
  actor: Actor;
}) {
  const type = cleanInput(input.type);
  const base = assetTypeKeyFrom(type.label);
  if (!base)
    throw new AssetTypeRefused('Give the type a name with letters in it.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertNameFree(tx, input.organisationId, type.label);
      const own = await ownTypes(tx, input.organisationId);
      // A name that differs from another type's only by punctuation or case
      // reads as the same type, so it is refused.
      if (
        [...BUILT_IN_ASSET_TYPES, ...own].some(
          (t) => assetTypeKeyFrom(t.label) === base
        )
      )
        throw new AssetTypeRefused(
          `A type with a name too like ${type.label} already exists. Choose a name that differs by more than punctuation.`
        );
      // A type keeps its key when renamed, so a key can be held by a type
      // that is now called something else: the new one takes the next free.
      const key = freeKey(
        base,
        new Set([
          ...BUILT_IN_ASSET_TYPES.map((t) => t.key),
          ...own.map((t) => t.key)
        ])
      );
      const [row] = await tx
        .insert(assetTypes)
        .values({ organisationId: input.organisationId, key, ...type })
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'asset_type.created',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        after: audited(row)
      });
      return row;
    })
  );
}

async function loadForWrite(tx: Tx, organisationId: string, key: string) {
  const [row] = await tx
    .select()
    .from(assetTypes)
    .where(
      and(
        eq(assetTypes.organisationId, organisationId),
        eq(assetTypes.key, key)
      )
    )
    .for('update');
  if (!row)
    throw new AssetTypeRefused(
      isBuiltInAssetType(key)
        ? 'The built-in types cannot be changed.'
        : 'No such asset type in this organisation.'
    );
  return row;
}

/** How many assets have this type and an expiry date recorded. */
async function datedAssets(tx: Tx, organisationId: string, key: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(informationAssets)
    .where(
      and(
        eq(informationAssets.organisationId, organisationId),
        eq(informationAssets.assetType, key),
        isNotNull(informationAssets.expiresAt)
      )
    );
  return Number(row?.n ?? 0);
}

/**
 * Rename or redefine a type, or change whether it carries an expiry date.
 * It cannot stop carrying one while its assets have dates recorded: their
 * reminders would stop with nobody having decided they should.
 */
export async function updateAssetType(input: {
  organisationId: string;
  key: string;
  type: AssetTypeInput;
  actor: Actor;
}) {
  const type = cleanInput(input.type);
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.organisationId, input.key);
      await assertNameFree(tx, input.organisationId, type.label, before.key);
      if (before.hasExpiry && !type.hasExpiry) {
        const dated = await datedAssets(tx, input.organisationId, before.key);
        if (dated > 0)
          throw new AssetTypeRefused(
            `${dated} ${before.label} asset${dated === 1 ? ' has' : 's have'} an expiry date recorded. Clear ${dated === 1 ? 'it' : 'them'} first if this type no longer expires.`
          );
      }
      const [after] = await tx
        .update(assetTypes)
        .set({ ...type, updatedAt: new Date() })
        .where(eq(assetTypes.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'asset_type.updated',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: audited(before),
        after: audited(after)
      });
      return after;
    })
  );
}

/** Stop offering a type for new assets; those that have it keep it. Or offer it again. */
export async function setAssetTypeRetired(input: {
  organisationId: string;
  key: string;
  retired: boolean;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.organisationId, input.key);
      if (Boolean(before.retiredAt) === input.retired) return before;
      const now = new Date();
      const [after] = await tx
        .update(assetTypes)
        .set({ retiredAt: input.retired ? now : null, updatedAt: now })
        .where(eq(assetTypes.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: input.retired ? 'asset_type.retired' : 'asset_type.restored',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: audited(before),
        after: audited(after)
      });
      return after;
    })
  );
}

/** Delete a type no asset has ever been given, or none still has. */
export async function deleteAssetType(input: {
  organisationId: string;
  key: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await loadForWrite(tx, input.organisationId, input.key);
      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(informationAssets)
        .where(
          and(
            eq(informationAssets.organisationId, input.organisationId),
            eq(informationAssets.assetType, before.key)
          )
        );
      const n = Number(used?.n ?? 0);
      if (n > 0)
        throw new AssetTypeRefused(
          `${n} asset${n === 1 ? ' has' : 's have'} this type, retired ones included. Retire the type instead, so no new asset is given it.`
        );
      await tx.delete(assetTypes).where(eq(assetTypes.id, before.id));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'asset_type.deleted',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: audited(before)
      });
    })
  );
}
