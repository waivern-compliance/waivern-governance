'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable, type EditResult } from '@/lib/edit-result';
import { FIELDS, type RecordType } from '@/lib/import/fields';
import { can, mayImport } from '@/lib/rbac';
import { NotPermitted, requireCapability } from '@/lib/session';
import {
  commitImport,
  confirmImportedActivity,
  ImportRefused,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';
import { loadActivity } from '@/services/ropa';

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();

/** An owner or privacy administrator, at organisation scope. */
async function importer() {
  const active = await requireCapability('workflow.configure');
  if (!mayImport(active.membership.grants))
    throw new NotPermitted('workflow.configure');
  return {
    active,
    organisationId: active.membership.organisationId,
    actor: {
      actorKind: 'user' as const,
      actorUserId: active.userId,
      actorLabel: active.email
    }
  };
}

export async function uploadImportAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: 'Choose the file to import.' };
  let batchId: string;
  try {
    const batch = await uploadImport({
      organisationId,
      recordType: text(formData.get('recordType')) as RecordType,
      sourceName: text(formData.get('sourceName')),
      entityId: text(formData.get('entityId')) || null,
      filename: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor
    });
    batchId = batch.id;
  } catch (error) {
    if (error instanceof ImportRefused)
      return { ok: false, message: error.message };
    throw error;
  }
  redirect(`/app/admin/imports/${batchId}`);
}

export async function previewImportAction(
  batchId: string,
  recordType: RecordType,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  const fields = Object.fromEntries(
    FIELDS[recordType]
      .map((f) => [f.key, text(formData.get(`field:${f.key}`))])
      .filter(([, column]) => column)
  );
  const result = await refusable(() =>
    previewImport({
      organisationId,
      batchId,
      mapping: {
        fields,
        keepUnmapped: formData.get('keepUnmapped') === 'on'
      },
      actor
    })
  );
  revalidatePath(`/app/admin/imports/${batchId}`);
  return result?.ok
    ? { ok: true, message: 'Previewed. Nothing is imported until you say so.' }
    : result;
}

export async function commitImportAction(
  batchId: string,
  _prev: EditResult
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  const result = await refusable(() =>
    commitImport({ organisationId, batchId, actor })
  );
  revalidatePath(`/app/admin/imports/${batchId}`);
  revalidatePath('/app/admin/imports');
  return result?.ok ? { ok: true, message: 'Imported.' } : result;
}

export async function undoImportAction(
  batchId: string,
  _prev: EditResult
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  const result = await refusable(() =>
    undoImport({ organisationId, batchId, actor })
  );
  revalidatePath(`/app/admin/imports/${batchId}`);
  revalidatePath('/app/admin/imports');
  return result?.ok ? { ok: true, message: 'Undone.' } : result;
}

/** On an imported activity's page: a person confirms it is current. */
export async function confirmImportedActivityAction(
  activityId: string,
  _prev: EditResult
): Promise<EditResult> {
  const active = await requireCapability('record.write');
  // A writer confined to one entity confirms only that entity's activities.
  const activity = await loadActivity(
    activityId,
    active.membership.organisationId
  );
  if (
    !activity ||
    !can(active.membership.grants, 'record.write', activity.activity.entityId)
  )
    throw new NotPermitted('record.write', activity?.activity.entityId);
  const result = await refusable(() =>
    confirmImportedActivity({
      organisationId: active.membership.organisationId,
      activityId,
      actor: {
        actorKind: 'user',
        actorUserId: active.userId,
        actorLabel: active.email
      }
    })
  );
  revalidatePath(`/app/ropa/${activityId}`);
  return result?.ok ? { ok: true, message: 'Confirmed.' } : result;
}
