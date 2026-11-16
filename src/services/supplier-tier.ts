import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  informationAssetActivities,
  informationAssets,
  informationAssetSuppliers,
  processingActivities,
  suppliers
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  isSupplierTier,
  recommendTier,
  TIER_LABEL,
  type TierFacts,
  type TierRecommendation
} from '@/lib/thirdparty/tier';

import type { Actor } from './templates';
import { canonicalise } from './third-party';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;

export class TierRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TierRefused';
  }
}

/**
 * What the register already says about a supplier that bears on its tier:
 * the information assets in use it hosts or supports, and the processing
 * activities with special category data that either name it as a recipient
 * or are held on one of those assets.
 */
async function factsFor(
  organisationId: string,
  supplier: {
    id: string;
    canonicalKey: string;
    role: string;
    aiInvolvement: string | null;
  },
  reader: Reader
): Promise<TierFacts> {
  const assets = await reader
    .select({
      id: informationAssets.id,
      classification: informationAssets.classification
    })
    .from(informationAssetSuppliers)
    .innerJoin(
      informationAssets,
      eq(informationAssets.id, informationAssetSuppliers.assetId)
    )
    .where(
      and(
        eq(informationAssetSuppliers.organisationId, organisationId),
        eq(informationAssetSuppliers.supplierId, supplier.id),
        isNull(informationAssets.retiredAt)
      )
    );
  const special = await reader
    .select({
      id: processingActivities.id,
      recipients: processingActivities.recipients
    })
    .from(processingActivities)
    .where(
      and(
        eq(processingActivities.organisationId, organisationId),
        eq(processingActivities.specialCategory, true)
      )
    );
  const onAssets =
    assets.length === 0
      ? []
      : await reader
          .select({ id: informationAssetActivities.activityId })
          .from(informationAssetActivities)
          .where(
            inArray(
              informationAssetActivities.assetId,
              assets.map((a) => a.id)
            )
          );
  const held = new Set(onAssets.map((a) => a.id));
  const specialCategoryActivities = special.filter(
    (a) =>
      held.has(a.id) ||
      a.recipients.some((r) => canonicalise(r) === supplier.canonicalKey)
  ).length;
  return {
    assetClassifications: assets
      .map((a) => a.classification)
      .filter((c): c is NonNullable<typeof c> => c !== null),
    specialCategoryActivities,
    role: supplier.role,
    aiInvolvement: supplier.aiInvolvement
  };
}

async function supplierIn(
  organisationId: string,
  supplierId: string,
  reader: Reader
) {
  const [row] = await reader
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organisationId, organisationId)
      )
    );
  if (!row) throw new TierRefused('No such third party in this organisation.');
  return row;
}

/** The tier set, why if it departs from the suggestion, and the suggestion now. */
export async function supplierTier(
  organisationId: string,
  supplierId: string
): Promise<{
  tier: string | null;
  tierReason: string | null;
  recommendation: TierRecommendation;
}> {
  return withOrganisation(organisationId, async () => {
    const supplier = await supplierIn(organisationId, supplierId, db);
    return {
      tier: supplier.tier,
      tierReason: supplier.tierReason,
      recommendation: recommendTier(
        await factsFor(organisationId, supplier, db)
      )
    };
  });
}

/**
 * Set a supplier's tier. Choosing other than the recommendation needs a
 * reason, and the recommendation, its grounds and the reason are audited, so
 * a reviewer can see what the register suggested and why it was not taken.
 */
export async function setSupplierTier(input: {
  organisationId: string;
  supplierId: string;
  tier: string;
  reason: string | null;
  actor: Actor;
}) {
  const tier = input.tier;
  if (!isSupplierTier(tier)) throw new TierRefused('Choose one of the tiers.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx: Tx) => {
      const [before] = await tx
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, input.supplierId),
            eq(suppliers.organisationId, input.organisationId)
          )
        )
        .for('update');
      if (!before)
        throw new TierRefused('No such third party in this organisation.');
      const recommendation = recommendTier(
        await factsFor(input.organisationId, before, tx)
      );
      const reason = input.reason?.trim() || null;
      if (tier !== recommendation.tier && !reason)
        throw new TierRefused(
          `The register suggests ${TIER_LABEL[recommendation.tier].toLowerCase()}. Say why ${TIER_LABEL[tier].toLowerCase()} is right instead.`
        );
      const [after] = await tx
        .update(suppliers)
        .set({
          tier,
          tierReason: tier === recommendation.tier ? null : reason,
          updatedAt: new Date()
        })
        .where(eq(suppliers.id, input.supplierId))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'supplier.tier_set',
        subjectType: 'supplier',
        subjectId: input.supplierId,
        before: { tier: before.tier, reason: before.tierReason },
        after: {
          tier,
          reason: after.tierReason,
          recommended: recommendation.tier,
          grounds: recommendation.reasons
        }
      });
      return after;
    })
  );
}
