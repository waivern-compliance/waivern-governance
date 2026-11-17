'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { DETAIL_FIELDS, type DetailField } from '@/lib/assets/types';
import { refusable, type EditResult } from '@/lib/edit-result';
import { requireCapability, requireSession } from '@/lib/session';
import {
  createAsset,
  linkAsset,
  loadAsset,
  recordAssetReview,
  retireAsset,
  setClassificationScheme,
  unlinkAsset,
  updateAsset,
  type AssetDetails,
  type LinkKind
} from '@/services/information-assets';

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const day = (v: FormDataEntryValue | null) =>
  text(v) ? new Date(`${text(v)}T00:00:00Z`) : null;
const actorOf = (active: { userId: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: active.userId,
  actorLabel: active.email
});

function detailsOf(formData: FormData): AssetDetails {
  return {
    name: text(formData.get('name')),
    description: text(formData.get('description')) || null,
    assetType: text(formData.get('assetType')),
    ownerId: text(formData.get('ownerId')) || null,
    hosting: text(formData.get('hosting')) || null,
    hostedBy: text(formData.get('hostedBy')) || null,
    region: text(formData.get('region')) || null,
    countries: text(formData.get('countries')).split(/[,;\n]/),
    classification: text(formData.get('classification')) || null,
    retention: text(formData.get('retention')) || null,
    nextReviewAt: day(formData.get('nextReviewAt')),
    details: detailFieldsOf(formData),
    expiresAt: day(formData.get('expiresAt')),
    noticeDays: text(formData.get('noticeDays'))
      ? Number(text(formData.get('noticeDays')))
      : null,
    autoRenews: formData.get('autoRenews') === 'on'
  };
}

/** The type's own fields, as `detail.<field>`; the service keeps only the type's. */
function detailFieldsOf(formData: FormData): Record<string, unknown> {
  const given: Record<string, unknown> = {};
  for (const field of Object.keys(DETAIL_FIELDS) as DetailField[]) {
    const raw = text(formData.get(`detail.${field}`));
    if (!raw) continue;
    const kind = DETAIL_FIELDS[field].kind;
    given[field] =
      kind === 'count'
        ? Number(raw)
        : kind === 'list'
          ? raw.split(/[,;\n]/).map((v) => v.trim())
          : raw;
  }
  return given;
}

/**
 * The signed-in person, allowed to write in the entity the asset belongs to.
 * The asset is read first, under the person's organisation, so the check
 * names the entity the write lands in.
 */
async function writerOf(id: string) {
  const active = await requireSession();
  const loaded = await loadAsset(id, active.membership.organisationId);
  if (!loaded) throw new Error('No such information asset.');
  return requireCapability('record.write', {
    organisationId: active.membership.organisationId,
    entityId: loaded.asset.entityId
  });
}

const refresh = (id?: string) => {
  if (id) revalidatePath(`/app/assets/${id}`);
  revalidatePath('/app/assets');
};

export async function createAssetAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const entityId = text(formData.get('entityId'));
    const active = await requireCapability('record.write', { entityId });
    const row = await createAsset({
      organisationId: active.membership.organisationId,
      entityId,
      details: detailsOf(formData),
      actor: actorOf(active)
    });
    refresh();
    redirect(`/app/assets/${row.id}`);
  });
}

export async function updateAssetAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await updateAsset({
      id,
      organisationId: active.membership.organisationId,
      details: detailsOf(formData),
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function linkAssetAction(
  id: string,
  kind: LinkKind,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    const targetId = text(formData.get('targetId'));
    if (!targetId) throw new Error('Choose what to link.');
    await linkAsset({
      assetId: id,
      organisationId: active.membership.organisationId,
      kind,
      targetId,
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function unlinkAssetAction(
  id: string,
  kind: LinkKind,
  targetId: string
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await unlinkAsset({
      assetId: id,
      organisationId: active.membership.organisationId,
      kind,
      targetId,
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function reviewAssetAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    const next = day(formData.get('nextReviewAt'));
    if (!next) throw new Error('Say when it is next due for review.');
    await recordAssetReview({
      id,
      organisationId: active.membership.organisationId,
      nextReviewAt: next,
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function retireAssetAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await retireAsset({
      id,
      organisationId: active.membership.organisationId,
      reason: text(formData.get('reason')),
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function setClassificationSchemeAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await requireCapability('org.manage');
    await setClassificationScheme({
      organisationId: active.membership.organisationId,
      scheme: text(formData.get('scheme')),
      actor: actorOf(active)
    });
    refresh();
    revalidatePath('/app/admin/organisation');
  });
}
