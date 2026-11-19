import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  assessmentRevisions,
  assessments,
  cyberScopeAssets,
  cyberScopeEntities,
  cyberScopes,
  entities,
  informationAssets,
  mitigations,
  organisations,
  recordLinks,
  risks,
  templates,
  templateVersions,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  formatControlRef,
  parseControlRef
} from '@/lib/cyber-essentials/control-ref';
import { editionInForce } from '@/lib/cyber-essentials/editions';
import {
  editionAnswered,
  treatingNow,
  type ReadinessMitigation
} from '@/lib/cyber-essentials/readiness';
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
import { requirementOutcomes } from '@/lib/templates/requirements';

import { installShippedWorkflows } from './approval-routing';
import { activeMemberGrants, mayOpenIn } from './member-grants';
import { insertMitigation, insertRisk } from './risks';
import { installShippedTemplates, type Actor } from './templates';
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
  const changed = await withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const was = await enabledIn(tx, input.organisationId);
      if (was === input.enabled) return false;
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
      return true;
    })
  );
  if (!changed || !input.enabled) return;

  // The readiness template and its sign-off, installed after the opt-in
  // commits through the same paths as every shipped template and workflow.
  // Each installs only what is missing, so turning it off and on again adds
  // nothing twice, and a failure here is put right from the templates page.
  await installShippedTemplates({
    organisationId: input.organisationId,
    cyberEssentials: true,
    actor: input.actor
  });
  await installShippedWorkflows({
    organisationId: input.organisationId,
    kinds: ['cyber_essentials'],
    actor: input.actor
  });
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
  /** On a change, a new home among the entities it covers; absent keeps it. */
  homeEntityId?: string;
};

/**
 * The entities the person making the change may write records in, or null
 * for all. A scope shows the assets of every entity it covers, so nobody may
 * bring an entity into one, or move one's home there, without access to its
 * records already.
 */
export type Writable = readonly string[] | null;

const mayWrite = (writable: Writable, entityId: string) =>
  writable === null || writable.includes(entityId);

async function clean(
  tx: Tx,
  organisationId: string,
  homeEntityId: string,
  input: ScopeInput,
  /** Entities newly brought in, which the person must be able to write in. */
  added: (entityIds: readonly string[]) => readonly string[],
  writable: Writable
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
  if (added(entityIds).some((id) => !mayWrite(writable, id)))
    throw new ScopeRefused(
      'You can only bring in legal entities whose records you can change: the scope shows every asset of the entities it covers.'
    );
  if (scope.ownerId) {
    await assertMemberOf(organisationId, scope.ownerId, tx);
    // The owner prepares the scope and, later, is reminded of its renewals:
    // someone who cannot open its home entity could do neither.
    if (
      !mayOpenIn(
        await activeMemberGrants(tx, organisationId),
        scope.ownerId,
        homeEntityId
      )
    )
      throw new ScopeRefused(
        "The owner must be able to open records in the scope's home entity. Choose someone who can, or give them access first."
      );
  }
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
  writable: Writable;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEnabled(tx, input.organisationId);
      const { scope, entityIds } = await clean(
        tx,
        input.organisationId,
        input.entityId,
        input.scope,
        (all) => all,
        input.writable
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
  writable: Writable;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEnabled(tx, input.organisationId);
      const before = await loadForWrite(tx, input.organisationId, input.id);
      const covered = await coveredBy(tx, input.id);
      const home = input.scope.homeEntityId || before.entityId;
      if (home !== before.entityId) {
        if (!covered.includes(home))
          throw new ScopeRefused(
            'Move the home only to an entity the scope already covers.'
          );
        if (!mayWrite(input.writable, home))
          throw new ScopeRefused(
            'You can only move the home to an entity whose records you can change.'
          );
      }
      const { scope, entityIds } = await clean(
        tx,
        input.organisationId,
        home,
        input.scope,
        (all) => all.filter((e) => !covered.includes(e)),
        input.writable
      );
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
        .set({ ...scope, entityId: home, updatedAt: new Date() })
        .where(eq(cyberScopes.id, input.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'cyber_scope.updated',
        subjectType: 'cyber_scope',
        subjectId: input.id,
        before: {
          ...audited(before),
          homeEntityId: before.entityId,
          entityIds: covered
        },
        after: { ...audited(after), homeEntityId: home, entityIds, unplaced }
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
      const refusal = placementRefusal(scope, asset, placement);
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

/** A readiness assessment in one of these is not finished with: no new one is started. */
const UNDER_WAY = ['draft', 'in_progress', 'returned', 'in_review'] as const;

/**
 * A scope's readiness assessments: the latest one submitted, with what its
 * answers say about each requirement, and the latest not yet finished with,
 * whether still being answered or awaiting sign-off.
 *
 * The status per requirement is read from the answers as they were submitted
 * (decision 2), from the revision frozen at submission, so later edits to a
 * returned assessment do not change it until it is submitted again. It is
 * read against the edition the template asked about, which is the scope's
 * own when the assessment was started.
 */
export async function scopeReadiness(organisationId: string, scopeId: string) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        id: assessments.id,
        reference: assessments.reference,
        title: assessments.title,
        status: assessments.status,
        submittedAt: assessments.submittedAt,
        scoreValue: assessments.scoreValue,
        scoreBand: assessments.scoreBand,
        scoreTier: assessments.scoreTier,
        templateVersionId: assessments.templateVersionId
      })
      .from(assessments)
      .innerJoin(
        templateVersions,
        eq(templateVersions.id, assessments.templateVersionId)
      )
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(
        and(
          eq(assessments.organisationId, organisationId),
          eq(assessments.subjectType, 'cyber_scope'),
          eq(assessments.subjectId, scopeId),
          eq(templates.kind, 'cyber_essentials'),
          ne(assessments.status, 'withdrawn')
        )
      )
      .orderBy(desc(assessments.createdAt));
    const underWay =
      rows.find((r) => UNDER_WAY.some((s) => s === r.status)) ?? null;
    const open = underWay && {
      id: underWay.id,
      reference: underWay.reference,
      status: underWay.status
    };
    const submitted =
      rows
        .filter((r) => r.submittedAt)
        .sort((a, b) => b.submittedAt!.getTime() - a.submittedAt!.getTime())
        .at(0) ?? null;
    const treated = await ceMitigationsOf(db, scopeId);
    if (!submitted) return { submitted: null, outcomes: [], open, treated };

    const [[version], [revision]] = await Promise.all([
      db
        .select({ definition: templateVersions.definition })
        .from(templateVersions)
        .where(eq(templateVersions.id, submitted.templateVersionId)),
      db
        .select({
          answers: assessmentRevisions.answers,
          evaluation: assessmentRevisions.evaluation
        })
        .from(assessmentRevisions)
        .where(
          and(
            eq(assessmentRevisions.assessmentId, submitted.id),
            eq(assessmentRevisions.reason, 'submitted')
          )
        )
        .orderBy(desc(assessmentRevisions.revision))
        .limit(1)
    ]);
    const outcomes =
      version && revision
        ? requirementOutcomes(
            version.definition.schema,
            revision.answers,
            revision.evaluation
          )
        : [];
    return {
      submitted: {
        id: submitted.id,
        reference: submitted.reference,
        title: submitted.title,
        status: submitted.status,
        submittedAt: submitted.submittedAt!,
        scoreValue: submitted.scoreValue,
        scoreBand: submitted.scoreBand,
        scoreTier: submitted.scoreTier,
        edition: version ? editionAnswered(version.definition) : null
      },
      outcomes,
      open,
      treated
    };
  });
}

/**
 * Mitigations naming a Cyber Essentials requirement (`ce:<edition>:<code>`),
 * on risks that concern this scope. A verified one is evidence the
 * requirement is in place; it is shown beside the readiness answer and never
 * replaces it, since only a new assessment says the scope now meets it.
 */
async function ceMitigationsOf(
  reader: Tx | typeof db,
  scopeId: string
): Promise<ReadinessMitigation[]> {
  const rows = await reader
    .select({
      mitigationId: mitigations.id,
      description: mitigations.description,
      controlRef: mitigations.controlRef,
      status: mitigations.status,
      dueAt: mitigations.dueAt,
      verifiedAt: mitigations.verifiedAt,
      riskId: risks.id,
      riskReference: risks.reference,
      riskStatus: risks.status
    })
    .from(recordLinks)
    .innerJoin(risks, eq(risks.id, recordLinks.fromId))
    .innerJoin(mitigations, eq(mitigations.riskId, risks.id))
    .where(
      and(
        eq(recordLinks.fromType, 'risk'),
        eq(recordLinks.toType, 'cyber_scope'),
        eq(recordLinks.toId, scopeId),
        eq(recordLinks.relation, 'concerns')
      )
    )
    .orderBy(asc(mitigations.createdAt));
  return rows.flatMap((r) => {
    const ref = parseControlRef(r.controlRef);
    return ref ? [{ ...r, code: ref.requirement.code }] : [];
  });
}

/**
 * A risk raised from a requirement the scope's latest submitted readiness
 * assessment left unmet, with the mitigation that puts it in place (decision
 * 7). Proposed on the status page and raised only when a person confirms it,
 * choosing the rating, who owns the mitigation and when it is due, so a
 * readiness assessment never fills the register by itself.
 *
 * One transaction: the risk, filed as cyber security and tied to the
 * assessment that found it, the link saying it concerns the scope, and the
 * mitigation naming the requirement, which the status page reads back.
 */
export async function raiseReadinessRisk(input: {
  organisationId: string;
  scopeId: string;
  code: string;
  title: string;
  description: string;
  likelihood: number;
  impact: number;
  mitigation: { description: string; ownerId?: string; dueAt?: Date };
  actor: Actor;
}) {
  if (!input.title || !input.description || !input.mitigation.description) {
    throw new ScopeRefused(
      'Give the risk a title and a description, and say what will be done.'
    );
  }
  const read = await scopeReadiness(input.organisationId, input.scopeId);
  const unmet = read.outcomes.find(
    (o) => o.code === input.code && o.status === 'not_met'
  );
  if (!read.submitted?.edition || !unmet) {
    throw new ScopeRefused(
      "That requirement is not unmet in the scope's latest submitted readiness assessment."
    );
  }
  const controlRef = formatControlRef(read.submitted.edition, input.code);
  const assessmentId = read.submitted.id;

  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertEnabled(tx, input.organisationId);
      const scope = await loadForWrite(tx, input.organisationId, input.scopeId);
      const already = treatingNow(
        await ceMitigationsOf(tx, scope.id),
        input.code
      );
      if (already) {
        throw new ScopeRefused(
          `${already.riskReference} is already treating this requirement.`
        );
      }

      const risk = await insertRisk(tx, {
        organisationId: input.organisationId,
        entityId: scope.entityId,
        title: input.title,
        description: input.description,
        category: 'cyber_security',
        likelihood: input.likelihood,
        impact: input.impact,
        ownerId: input.actor.actorUserId ?? undefined,
        assessmentId,
        actor: input.actor
      });
      await tx.insert(recordLinks).values({
        organisationId: input.organisationId,
        fromType: 'risk',
        fromId: risk.id,
        toType: 'cyber_scope',
        toId: scope.id,
        relation: 'concerns'
      });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'risk.linked',
        subjectType: 'risk',
        subjectId: risk.id,
        entityId: scope.entityId,
        after: { concerns: scope.reference, requirement: controlRef }
      });
      await insertMitigation(tx, {
        riskId: risk.id,
        organisationId: input.organisationId,
        description: input.mitigation.description,
        controlRef,
        treatmentType: 'limitation',
        ownerId: input.mitigation.ownerId,
        dueAt: input.mitigation.dueAt,
        actor: input.actor
      });
      return risk;
    })
  );
}
