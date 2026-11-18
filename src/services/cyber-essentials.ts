import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  cyberScopeAssets,
  cyberScopeEntities,
  cyberScopes,
  entities,
  informationAssets,
  organisations,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { editionInForce } from '@/lib/cyber-essentials/editions';
import type { OutOfScopeReason } from '@/lib/cyber-essentials/scope';
import {
  isOutOfScopeReason,
  isScopeKind,
  placementRefusal,
  scopeRefusal,
  type ScopeAsset,
  type ScopeKind,
  type ScopePlacement
} from '@/lib/cyber-essentials/scope-checks';
import { nextReference } from '@/lib/references';

import type { Actor } from './templates';
import { assertEntityIn, assertMemberOf } from './tenancy-guards';

/**
 * Cyber Essentials certification scopes: what each certificate will cover.
 * The rules are `lib/cyber-essentials/scope-checks.ts`; this records them.
 *
 * Taken up by an organisation, never required of it: nothing here is reached
 * until an owner turns Cyber Essentials on.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;

export class ScopeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeRefused';
  }
}

async function enabledIn(reader: Reader, organisationId: string) {
  const [org] = await reader
    .select({ on: organisations.cyberEssentials })
    .from(organisations)
    .where(eq(organisations.id, organisationId));
  return org?.on ?? false;
}

/** Whether the organisation prepares for Cyber Essentials. */
export async function cyberEssentialsEnabled(
  organisationId: string
): Promise<boolean> {
  return withOrganisation(organisationId, () => enabledIn(db, organisationId));
}

/**
 * Turn Cyber Essentials on or off. Turning it off hides the scopes and keeps
 * them, so turning it back on finds them as they were.
 */
export async function setCyberEssentials(input: {
  organisationId: string;
  enabled: boolean;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const was = await enabledIn(tx, input.organisationId);
      if (was === input.enabled) return;
      await tx
        .update(organisations)
        .set({ cyberEssentials: input.enabled, updatedAt: new Date() })
        .where(eq(organisations.id, input.organisationId));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: input.enabled
          ? 'cyber_essentials.enabled'
          : 'cyber_essentials.disabled',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: { cyberEssentials: was },
        after: { cyberEssentials: input.enabled }
      });
    })
  );
}

async function assertEnabled(tx: Tx, organisationId: string) {
  if (!(await enabledIn(tx, organisationId)))
    throw new ScopeRefused(
      'Cyber Essentials is not turned on for this organisation. An owner can turn it on in the organisation settings.'
    );
}

export type ScopeInput = {
  name: string;
  kind: string;
  boundary: string | null;
  segregation: string | null;
  exclusions: string | null;
  /** The entities the certificate covers; the home entity is always one. */
  entityIds: readonly string[];
  ownerId: string | null;
  nextReviewAt: Date | null;
};

async function clean(
  tx: Tx,
  organisationId: string,
  homeEntityId: string,
  input: ScopeInput
) {
  if (!isScopeKind(input.kind))
    throw new ScopeRefused(
      'Choose whether the scope is the whole organisation or a sub-set.'
    );
  const entityIds = [...new Set([homeEntityId, ...input.entityIds])];
  const scope = {
    name: input.name.trim(),
    kind: input.kind as ScopeKind,
    boundary: input.boundary?.trim() || null,
    segregation: input.segregation?.trim() || null,
    exclusions: input.exclusions?.trim() || null,
    ownerId: input.ownerId || null,
    nextReviewAt: input.nextReviewAt
  };
  const refusal = scopeRefusal({ ...scope, entityIds });
  if (refusal) throw new ScopeRefused(refusal);
  if (scope.name.length > 200)
    throw new ScopeRefused('Keep the name to 200 characters.');
  for (const id of entityIds) await assertEntityIn(organisationId, id, tx);
  if (scope.ownerId) await assertMemberOf(organisationId, scope.ownerId, tx);
  return { scope, entityIds };
}

const AUDITED = [
  'name',
  'kind',
  'boundary',
  'segregation',
  'exclusions',
  'edition',
  'ownerId',
  'nextReviewAt'
] as const;

const audited = (row: Partial<typeof cyberScopes.$inferSelect>) =>
  Object.fromEntries(AUDITED.map((k) => [k, row[k] ?? null]));

async function coveredBy(reader: Reader, scopeId: string) {
  return (
    await reader
      .select({ entityId: cyberScopeEntities.entityId })
      .from(cyberScopeEntities)
      .where(eq(cyberScopeEntities.scopeId, scopeId))
      .orderBy(asc(cyberScopeEntities.entityId))
  ).map((r) => r.entityId);
}

/** A new scope, in its home entity, prepared against the edition now in force. */
export async function createScope(input: {
  organisationId: string;
  entityId: string;
  scope: ScopeInput;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEnabled(tx, input.organisationId);
      const { scope, entityIds } = await clean(
        tx,
        input.organisationId,
        input.entityId,
        input.scope
      );
      const now = new Date();
      const reference = await nextReference(
        tx,
        input.organisationId,
        'CES',
        now.getUTCFullYear()
      );
      const [row] = await tx
        .insert(cyberScopes)
        .values({
          organisationId: input.organisationId,
          entityId: input.entityId,
          reference,
          edition: editionInForce(now).id,
          ...scope
        })
        .returning();
      await tx.insert(cyberScopeEntities).values(
        entityIds.map((entityId) => ({
          organisationId: input.organisationId,
          scopeId: row.id,
          entityId
        }))
      );
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.entityId,
        action: 'cyber_scope.created',
        subjectType: 'cyber_scope',
        subjectId: row.id,
        after: { reference, ...audited(row), entityIds }
      });
      return row;
    })
  );
}

async function loadForWrite(tx: Tx, organisationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(cyberScopes)
    .where(
      and(
        eq(cyberScopes.id, id),
        eq(cyberScopes.organisationId, organisationId)
      )
    )
    .for('update');
  if (!row) throw new ScopeRefused('No such scope in this organisation.');
  return row;
}

/** The scope's home entity, to check who may change it before they do. */
export async function scopeEntityOf(
  organisationId: string,
  id: string
): Promise<string | null> {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select({ entityId: cyberScopes.entityId })
      .from(cyberScopes)
      .where(
        and(
          eq(cyberScopes.id, id),
          eq(cyberScopes.organisationId, organisationId)
        )
      );
    return row?.entityId ?? null;
  });
}

/**
 * Change what a scope says. An entity it no longer covers takes its assets
 * out of the scope with it, in or out as they were placed: they no longer
 * belong to what the certificate covers.
 */
export async function updateScope(input: {
  id: string;
  organisationId: string;
  scope: ScopeInput;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEnabled(tx, input.organisationId);
      const before = await loadForWrite(tx, input.organisationId, input.id);
      const { scope, entityIds } = await clean(
        tx,
        input.organisationId,
        before.entityId,
        input.scope
      );
      const covered = await coveredBy(tx, input.id);
      const dropped = covered.filter((e) => !entityIds.includes(e));
      const added = entityIds.filter((e) => !covered.includes(e));
      let unplaced = 0;
      if (dropped.length) {
        const gone = await tx
          .delete(cyberScopeAssets)
          .where(
            and(
              eq(cyberScopeAssets.scopeId, input.id),
              inArray(
                cyberScopeAssets.assetId,
                tx
                  .select({ id: informationAssets.id })
                  .from(informationAssets)
                  .where(inArray(informationAssets.entityId, dropped))
              )
            )
          )
          .returning({ assetId: cyberScopeAssets.assetId });
        unplaced = gone.length;
        await tx
          .delete(cyberScopeEntities)
          .where(
            and(
              eq(cyberScopeEntities.scopeId, input.id),
              inArray(cyberScopeEntities.entityId, dropped)
            )
          );
      }
      if (added.length)
        await tx.insert(cyberScopeEntities).values(
          added.map((entityId) => ({
            organisationId: input.organisationId,
            scopeId: input.id,
            entityId
          }))
        );
      const [after] = await tx
        .update(cyberScopes)
        .set({ ...scope, updatedAt: new Date() })
        .where(eq(cyberScopes.id, input.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'cyber_scope.updated',
        subjectType: 'cyber_scope',
        subjectId: input.id,
        before: { ...audited(before), entityIds: covered },
        after: { ...audited(after), entityIds, unplaced }
      });
      return after;
    })
  );
}

const assetColumns = {
  id: informationAssets.id,
  reference: informationAssets.reference,
  name: informationAssets.name,
  entityId: informationAssets.entityId,
  assetType: informationAssets.assetType,
  hosting: informationAssets.hosting,
  details: informationAssets.details,
  retiredAt: informationAssets.retiredAt
};

/**
 * Put an asset in a scope, or leave it out with a reason. Placing it again
 * replaces what was said.
 */
export async function placeAsset(input: {
  scopeId: string;
  organisationId: string;
  assetId: string;
  inScope: boolean;
  reason: string | null;
  note: string | null;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEnabled(tx, input.organisationId);
      const scope = await loadForWrite(tx, input.organisationId, input.scopeId);
      const [asset] = await tx
        .select(assetColumns)
        .from(informationAssets)
        .where(
          and(
            eq(informationAssets.id, input.assetId),
            eq(informationAssets.organisationId, input.organisationId)
          )
        );
      if (!asset) throw new ScopeRefused('No such asset in this organisation.');
      if (!(await coveredBy(tx, scope.id)).includes(asset.entityId))
        throw new ScopeRefused(
          'That asset belongs to a legal entity the scope does not cover. Add the entity to the scope first.'
        );
      const reason = input.inScope ? null : input.reason || null;
      if (reason !== null && !isOutOfScopeReason(reason))
        throw new ScopeRefused('Choose why it is out of scope from the list.');
      const placement = {
        inScope: input.inScope,
        reason: reason as OutOfScopeReason | null,
        note: input.note?.trim() || null
      };
      const refusal = placementRefusal(asset, placement);
      if (refusal) throw new ScopeRefused(refusal);
      const [was] = await tx
        .select()
        .from(cyberScopeAssets)
        .where(
          and(
            eq(cyberScopeAssets.scopeId, scope.id),
            eq(cyberScopeAssets.assetId, asset.id)
          )
        );
      await tx
        .insert(cyberScopeAssets)
        .values({
          organisationId: input.organisationId,
          scopeId: scope.id,
          assetId: asset.id,
          ...placement
        })
        .onConflictDoUpdate({
          target: [cyberScopeAssets.scopeId, cyberScopeAssets.assetId],
          set: placement
        });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: scope.entityId,
        action: 'cyber_scope.asset_placed',
        subjectType: 'cyber_scope',
        subjectId: scope.id,
        before: was
          ? { assetId: asset.id, inScope: was.inScope, reason: was.reason }
          : null,
        after: { assetId: asset.id, reference: asset.reference, ...placement }
      });
    })
  );
}

/** Say nothing more about an asset in this scope: neither in nor out. */
export async function unplaceAsset(input: {
  scopeId: string;
  organisationId: string;
  assetId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEnabled(tx, input.organisationId);
      const scope = await loadForWrite(tx, input.organisationId, input.scopeId);
      const [gone] = await tx
        .delete(cyberScopeAssets)
        .where(
          and(
            eq(cyberScopeAssets.scopeId, scope.id),
            eq(cyberScopeAssets.assetId, input.assetId)
          )
        )
        .returning();
      if (!gone) return;
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: scope.entityId,
        action: 'cyber_scope.asset_removed',
        subjectType: 'cyber_scope',
        subjectId: scope.id,
        before: {
          assetId: gone.assetId,
          inScope: gone.inScope,
          reason: gone.reason
        }
      });
    })
  );
}

/**
 * The scopes whose home entity the reader can see, with how many assets
 * each places in and out.
 *
 * @param entityIds the entities the reader may see, or null for all
 */
export async function scopeRegister(
  organisationId: string,
  entityIds: readonly string[] | null
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        scope: cyberScopes,
        entityName: entities.name,
        ownerEmail: users.email,
        inScope: sql<number>`(select count(*)::int from ${cyberScopeAssets} a where a.scope_id = ${cyberScopes.id} and a.in_scope)`,
        outOfScope: sql<number>`(select count(*)::int from ${cyberScopeAssets} a where a.scope_id = ${cyberScopes.id} and not a.in_scope)`
      })
      .from(cyberScopes)
      .innerJoin(entities, eq(entities.id, cyberScopes.entityId))
      .leftJoin(users, eq(users.id, cyberScopes.ownerId))
      .where(
        and(
          eq(cyberScopes.organisationId, organisationId),
          entityIds ? inArray(cyberScopes.entityId, [...entityIds]) : undefined
        )
      )
      .orderBy(asc(cyberScopes.reference));
    return rows.map((r) => ({
      ...r,
      inScope: Number(r.inScope),
      outOfScope: Number(r.outOfScope)
    }));
  });
}

/**
 * A scope with the entities it covers, what it places in and out, and every
 * asset of those entities, for its page and its findings.
 */
export async function loadScope(organisationId: string, id: string) {
  return withOrganisation(organisationId, async () => {
    const [scope] = await db
      .select()
      .from(cyberScopes)
      .where(
        and(
          eq(cyberScopes.id, id),
          eq(cyberScopes.organisationId, organisationId)
        )
      );
    if (!scope) return null;
    const entityIds = await coveredBy(db, id);
    const [covered, placements, candidates] = await Promise.all([
      db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(inArray(entities.id, entityIds))
        .orderBy(asc(entities.name)),
      db
        .select({
          assetId: cyberScopeAssets.assetId,
          inScope: cyberScopeAssets.inScope,
          reason: cyberScopeAssets.reason,
          note: cyberScopeAssets.note
        })
        .from(cyberScopeAssets)
        .where(eq(cyberScopeAssets.scopeId, id)),
      db
        .select(assetColumns)
        .from(informationAssets)
        .where(
          and(
            eq(informationAssets.organisationId, organisationId),
            inArray(informationAssets.entityId, entityIds)
          )
        )
        .orderBy(asc(informationAssets.reference))
    ]);
    return {
      scope,
      entities: covered,
      placements: placements as ScopePlacement[],
      candidates: candidates as ScopeAsset[]
    };
  });
}
