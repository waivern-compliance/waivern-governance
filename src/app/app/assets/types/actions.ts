'use server';

import { revalidatePath } from 'next/cache';

import { refusable, type EditResult } from '@/lib/edit-result';
import { requireCapability } from '@/lib/session';
import {
  createAssetType,
  deleteAssetType,
  setAssetTypeRetired,
  updateAssetType,
  type AssetTypeInput
} from '@/services/asset-types';

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const actorOf = (active: { userId: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: active.userId,
  actorLabel: active.email
});

function typeOf(formData: FormData): AssetTypeInput {
  return {
    label: text(formData.get('label')),
    definition: text(formData.get('definition')),
    hasExpiry: formData.get('hasExpiry') === 'on'
  };
}

const refresh = () => {
  revalidatePath('/app/assets/types');
  revalidatePath('/app/assets');
};

export async function createAssetTypeAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await requireCapability('asset_type.manage');
    await createAssetType({
      organisationId: active.membership.organisationId,
      type: typeOf(formData),
      actor: actorOf(active)
    });
    refresh();
  });
}

export async function updateAssetTypeAction(
  key: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await requireCapability('asset_type.manage');
    await updateAssetType({
      organisationId: active.membership.organisationId,
      key,
      type: typeOf(formData),
      actor: actorOf(active)
    });
    refresh();
  });
}

export async function setAssetTypeRetiredAction(
  key: string,
  retired: boolean
): Promise<EditResult> {
  return refusable(async () => {
    const active = await requireCapability('asset_type.manage');
    await setAssetTypeRetired({
      organisationId: active.membership.organisationId,
      key,
      retired,
      actor: actorOf(active)
    });
    refresh();
  });
}

export async function deleteAssetTypeAction(key: string): Promise<EditResult> {
  return refusable(async () => {
    const active = await requireCapability('asset_type.manage');
    await deleteAssetType({
      organisationId: active.membership.organisationId,
      key,
      actor: actorOf(active)
    });
    refresh();
  });
}
