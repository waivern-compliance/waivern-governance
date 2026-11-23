'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable, type EditResult } from '@/lib/edit-result';
import { scopedEntityIds, type Capability } from '@/lib/rbac';
import { requireCapability } from '@/lib/session';
import {
  createPolicy,
  decideVersion,
  draftVersion,
  isPolicyLinkKind,
  linkPolicy,
  loadPolicy,
  recordPolicyReview,
  submitVersion,
  unlinkPolicy,
  updateDraft,
  updatePolicy,
  withdrawPolicy
} from '@/services/policies';

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const actorOf = (active: { userId: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: active.userId,
  actorLabel: active.email
});

/**
 * A policy for one entity is for those who hold the capability there; one
 * for the whole organisation needs it across the organisation, not in one
 * entity only.
 */
async function requireFor(capability: Capability, entityId: string | null) {
  const active = await requireCapability(
    capability,
    entityId ? { entityId } : {}
  );
  if (
    !entityId &&
    scopedEntityIds(active.membership.grants, capability) !== null
  )
    throw new Error(
      'This policy is for every entity, so it needs that permission across the whole organisation.'
    );
  return active;
}

/** The person acting on an existing policy, holding the capability for it. */
async function actingOn(id: string, capability: Capability) {
  const probe = await requireCapability('record.read');
  const loaded = await loadPolicy(id, probe.membership.organisationId);
  if (!loaded) throw new Error('No such policy.');
  const active = await requireFor(capability, loaded.policy.entityId);
  return { active, organisationId: active.membership.organisationId, loaded };
}

const revalidate = (id: string) => {
  revalidatePath(`/app/policies/${id}`);
  revalidatePath('/app/policies');
};

const months = (v: FormDataEntryValue | null) => {
  const s = text(v);
  return s ? Number(s) : undefined;
};

/**
 * The policy's text, when a file was chosen. Only for those who may upload,
 * asked before a byte is read; a trial adds its policies without one.
 */
async function uploadedText(formData: FormData, entityId: string | null) {
  const file = formData.get('text');
  if (!(file instanceof File) || file.size === 0) return null;
  await requireCapability('file.upload', entityId ? { entityId } : {});
  return {
    filename: file.name,
    contentType: file.type,
    content: Buffer.from(await file.arrayBuffer())
  };
}

export async function createPolicyAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  let id: string | null = null;
  const result = await refusable(async () => {
    const entityId = text(formData.get('entityId')) || null;
    const active = await requireFor('record.write', entityId);
    const policy = await createPolicy({
      organisationId: active.membership.organisationId,
      entityId,
      title: text(formData.get('title')),
      summary: text(formData.get('summary')) || null,
      ownerId: text(formData.get('ownerId')) || null,
      reviewIntervalMonths: months(formData.get('reviewIntervalMonths')),
      versionLabel: text(formData.get('versionLabel')) || undefined,
      text: await uploadedText(formData, entityId),
      actor: actorOf(active)
    });
    id = policy.id;
  });
  if (id) {
    revalidatePath('/app/policies');
    redirect(`/app/policies/${id}`);
  }
  return result;
}

export async function updatePolicyAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    await updatePolicy({
      id,
      organisationId,
      title: text(formData.get('title')),
      summary: text(formData.get('summary')) || null,
      ownerId: text(formData.get('ownerId')) || null,
      reviewIntervalMonths: months(formData.get('reviewIntervalMonths')),
      actor: actorOf(active)
    });
    revalidate(id);
  });
}

export async function draftVersionAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    await draftVersion({
      policyId: id,
      organisationId,
      label: text(formData.get('label')),
      changes: text(formData.get('changes')) || null,
      actor: actorOf(active)
    });
    revalidate(id);
  });
}

export async function updateDraftAction(
  id: string,
  versionId: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    await updateDraft({
      versionId,
      organisationId,
      label: text(formData.get('label')),
      changes: text(formData.get('changes')) || null,
      documentId: text(formData.get('documentId')) || null,
      actor: actorOf(active)
    });
    revalidate(id);
  });
}

export async function submitVersionAction(
  id: string,
  versionId: string
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    await submitVersion({ versionId, organisationId, actor: actorOf(active) });
    revalidate(id);
  });
}

export async function decideVersionAction(
  id: string,
  versionId: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'approval.decide');
    const decision = text(formData.get('decision'));
    if (decision !== 'approved' && decision !== 'rejected')
      throw new Error('Approve it or reject it.');
    await decideVersion({
      versionId,
      organisationId,
      decision,
      approvalReference: text(formData.get('approvalReference')),
      rejectionReason: text(formData.get('rejectionReason')),
      actor: actorOf(active)
    });
    revalidate(id);
  });
}

export async function reviewPolicyAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    const on = text(formData.get('reviewedAt'));
    await recordPolicyReview({
      policyId: id,
      organisationId,
      reviewedAt: on ? new Date(on) : undefined,
      actor: actorOf(active)
    });
    revalidate(id);
  });
}

export async function withdrawPolicyAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    await withdrawPolicy({
      policyId: id,
      organisationId,
      reason: text(formData.get('reason')),
      actor: actorOf(active)
    });
    revalidate(id);
  });
}

export async function linkPolicyAction(
  id: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    const kind = text(formData.get('kind'));
    if (!isPolicyLinkKind(kind)) throw new Error('Choose what to link.');
    await linkPolicy({
      policyId: id,
      organisationId,
      kind,
      targetId: text(formData.get('targetId')),
      actor: actorOf(active)
    });
    revalidate(id);
  });
}

export async function unlinkPolicyAction(
  id: string,
  kind: string,
  targetId: string
): Promise<EditResult> {
  return refusable(async () => {
    const { active, organisationId } = await actingOn(id, 'record.write');
    if (!isPolicyLinkKind(kind)) throw new Error('Nothing to unlink.');
    await unlinkPolicy({
      policyId: id,
      organisationId,
      kind,
      targetId,
      actor: actorOf(active)
    });
    revalidate(id);
  });
}
