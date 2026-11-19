'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable, type EditResult } from '@/lib/edit-result';
import {
  requireCapability,
  requireSession,
  visibleEntityIds
} from '@/lib/session';
import {
  createScope,
  placeAsset,
  raiseReadinessRisk,
  scopeEntityOf,
  setCyberEssentials,
  unplaceAsset,
  updateScope,
  type ScopeInput
} from '@/services/cyber-essentials';

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const day = (v: FormDataEntryValue | null) =>
  text(v) ? new Date(`${text(v)}T00:00:00Z`) : null;
const actorOf = (active: { userId: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: active.userId,
  actorLabel: active.email
});

function scopeOf(formData: FormData): ScopeInput {
  return {
    name: text(formData.get('name')),
    kind: text(formData.get('kind')),
    boundary: text(formData.get('boundary')) || null,
    segregation: text(formData.get('segregation')) || null,
    exclusions: text(formData.get('exclusions')) || null,
    entityIds: formData.getAll('entityIds').map(text).filter(Boolean),
    ownerId: text(formData.get('ownerId')) || null,
    nextReviewAt: day(formData.get('nextReviewAt')),
    homeEntityId: text(formData.get('homeEntityId')) || undefined
  };
}

/** The signed-in person, allowed to write in the scope's home entity. */
async function writerOf(id: string) {
  const active = await requireSession();
  const entityId = await scopeEntityOf(active.membership.organisationId, id);
  if (!entityId) throw new Error('No such scope.');
  return requireCapability('record.write', {
    organisationId: active.membership.organisationId,
    entityId
  });
}

const refresh = (id?: string) => {
  if (id) {
    revalidatePath(`/app/cyber-essentials/scopes/${id}`);
    revalidatePath(`/app/cyber-essentials/scopes/${id}/readiness`);
  }
  revalidatePath('/app/cyber-essentials');
};

export async function setCyberEssentialsAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await requireCapability('org.manage');
    await setCyberEssentials({
      organisationId: active.membership.organisationId,
      enabled: formData.get('enabled') === 'on',
      actor: actorOf(active)
    });
    revalidatePath('/app/admin/organisation');
    revalidatePath('/app');
    refresh();
  });
}

export async function createScopeAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const entityId = text(formData.get('entityId'));
    const active = await requireCapability('record.write', { entityId });
    const row = await createScope({
      organisationId: active.membership.organisationId,
      entityId,
      scope: scopeOf(formData),
      writable: visibleEntityIds(active, 'record.write'),
      actor: actorOf(active)
    });
    refresh();
    redirect(`/app/cyber-essentials/scopes/${row.id}`);
  });
}

export async function updateScopeAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await updateScope({
      id,
      organisationId: active.membership.organisationId,
      scope: scopeOf(formData),
      writable: visibleEntityIds(active, 'record.write'),
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function placeAssetAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await placeAsset({
      scopeId: id,
      organisationId: active.membership.organisationId,
      assetId: text(formData.get('assetId')),
      inScope: text(formData.get('placement')) === 'in',
      reason: text(formData.get('reason')) || null,
      note: text(formData.get('note')) || null,
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function unplaceAssetAction(
  id: string,
  assetId: string,
  _prev: EditResult
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await unplaceAsset({
      scopeId: id,
      organisationId: active.membership.organisationId,
      assetId,
      actor: actorOf(active)
    });
    refresh(id);
  });
}

/** Confirm a risk proposed from a requirement the scope's readiness left unmet. */
export async function raiseReadinessRiskAction(
  id: string,
  code: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const session = await requireSession();
    const entityId = await scopeEntityOf(session.membership.organisationId, id);
    if (!entityId) throw new Error('No such scope.');
    const active = await requireCapability('risk.manage', {
      organisationId: session.membership.organisationId,
      entityId
    });
    await raiseReadinessRisk({
      organisationId: active.membership.organisationId,
      scopeId: id,
      code,
      title: text(formData.get('title')),
      description: text(formData.get('description')),
      likelihood: Number(formData.get('likelihood')),
      impact: Number(formData.get('impact')),
      mitigation: {
        description: text(formData.get('mitigation')),
        ownerId: text(formData.get('ownerId')) || undefined,
        dueAt: day(formData.get('dueAt')) ?? undefined
      },
      actor: actorOf(active)
    });
    refresh(id);
    revalidatePath('/app/risks');
  });
}
