'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable, type EditResult } from '@/lib/edit-result';
import {
  requireCapability,
  requireSession,
  type ActiveSession
} from '@/lib/session';
import {
  createContract,
  endContract,
  loadContract,
  setContractViewers,
  updateContract,
  type ContractDetails
} from '@/services/contracts';

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const day = (v: FormDataEntryValue | null) =>
  text(v) ? new Date(`${text(v)}T00:00:00Z`) : null;
const actorOf = (active: { userId: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: active.userId,
  actorLabel: active.email
});
const viewerOf = (active: ActiveSession) => ({
  userId: active.userId,
  grants: active.membership.grants
});

function detailsOf(formData: FormData): ContractDetails {
  const notice = text(formData.get('noticeDays'));
  return {
    title: text(formData.get('title')),
    ownerId: text(formData.get('ownerId')) || null,
    startsAt: day(formData.get('startsAt')),
    endsAt: day(formData.get('endsAt')),
    noticeDays: notice === '' ? null : Number(notice),
    autoRenews: formData.get('autoRenews') === 'on'
  };
}

const termsOf = (formData: FormData) => ({
  value: text(formData.get('value')) || null,
  currency: text(formData.get('currency')) || null
});

/**
 * The signed-in person, allowed to write in the entity the contract belongs
 * to. Read first, so the check names the entity the write lands in.
 */
async function writerOf(id: string) {
  const active = await requireSession();
  const loaded = await loadContract(
    id,
    active.membership.organisationId,
    viewerOf(active)
  );
  if (!loaded) throw new Error('No such contract.');
  return requireCapability('record.write', {
    organisationId: active.membership.organisationId,
    entityId: loaded.contract.entityId
  });
}

const refresh = (id?: string) => {
  if (id) revalidatePath(`/app/contracts/${id}`);
  revalidatePath('/app/contracts');
  revalidatePath('/app/third-parties', 'layout');
};

export async function createContractAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const entityId = text(formData.get('entityId'));
    const active = await requireCapability('record.write', { entityId });
    const row = await createContract({
      organisationId: active.membership.organisationId,
      entityId,
      supplierId: text(formData.get('supplierId')),
      details: detailsOf(formData),
      terms: termsOf(formData),
      viewerIds: formData.getAll('viewerIds').map(String),
      actor: actorOf(active)
    });
    refresh();
    redirect(`/app/contracts/${row.id}`);
  });
}

export async function updateContractAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await updateContract({
      id,
      organisationId: active.membership.organisationId,
      details: detailsOf(formData),
      // Sent only by the form shown to those who may see the terms.
      terms: formData.has('value') ? termsOf(formData) : undefined,
      viewer: viewerOf(active),
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function setContractViewersAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await setContractViewers({
      id,
      organisationId: active.membership.organisationId,
      userIds: formData.getAll('viewerIds').map(String),
      viewer: viewerOf(active),
      actor: actorOf(active)
    });
    refresh(id);
  });
}

export async function endContractAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const active = await writerOf(id);
    await endContract({
      id,
      organisationId: active.membership.organisationId,
      reason: text(formData.get('reason')),
      actor: actorOf(active)
    });
    refresh(id);
  });
}
