'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { aiUseCases, evidence, processingActivities } from '@/db/schema';
import { refusable, type EditResult } from '@/lib/edit-result';
import type { RecordType } from '@/lib/import/fields';
import { can, mayImport } from '@/lib/rbac';
import { NotPermitted, requireCapability } from '@/lib/session';
import {
  addImportFiles,
  commitImport,
  confirmImportedRecord,
  ImportRefused,
  previewImport,
  readImportedAgreements,
  removeImportFile,
  undoImport,
  uploadImport,
  type Confirmable
} from '@/services/imports';

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
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  // Every "field:" choice; the service keeps those its batch's type has.
  const fields: Record<string, string> = {};
  for (const [name, value] of formData.entries())
    if (name.startsWith('field:') && text(value))
      fields[name.slice('field:'.length)] = text(value);
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

export async function addImportFilesAction(
  batchId: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  const files = formData
    .getAll('files')
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0)
    return { ok: false, message: 'Choose the files to add.' };
  let outcome: Awaited<ReturnType<typeof addImportFiles>> | null = null;
  const result = await refusable(async () => {
    outcome = await addImportFiles({
      organisationId,
      batchId,
      files: await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          contentType: f.type,
          bytes: new Uint8Array(await f.arrayBuffer())
        }))
      ),
      actor
    });
  });
  revalidatePath(`/app/admin/imports/${batchId}`);
  if (!result?.ok || !outcome) return result;
  const { added, refused } = outcome as Awaited<
    ReturnType<typeof addImportFiles>
  >;
  const said = [
    added.length
      ? `Added ${added.length} file${added.length === 1 ? '' : 's'}.`
      : '',
    ...refused.map((r) => `${r.filename}: ${r.reason}`)
  ].filter(Boolean);
  return { ok: refused.length === 0, message: said.join(' ') };
}

export async function removeImportFileAction(
  batchId: string,
  fileId: string,
  _prev: EditResult
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  const result = await refusable(() =>
    removeImportFile({ organisationId, batchId, fileId, actor })
  );
  revalidatePath(`/app/admin/imports/${batchId}`);
  return result?.ok ? { ok: true, message: 'Removed.' } : result;
}

export async function readImportedAgreementsAction(
  batchId: string,
  _prev: EditResult
): Promise<EditResult> {
  const { organisationId, actor } = await importer();
  let outcome: Awaited<ReturnType<typeof readImportedAgreements>> | null = null;
  const result = await refusable(async () => {
    outcome = await readImportedAgreements({ organisationId, batchId, actor });
  });
  revalidatePath(`/app/admin/imports/${batchId}`);
  if (!result?.ok || !outcome) return result;
  const { read, failed, remaining } = outcome as Awaited<
    ReturnType<typeof readImportedAgreements>
  >;
  return {
    ok: failed.length === 0,
    message: [
      `Read ${read}; their terms wait for review on each supplier's page.`,
      failed.length ? `${failed.length} could not be read.` : '',
      remaining ? `${remaining} still to read.` : ''
    ]
      .filter(Boolean)
      .join(' ')
  };
}

/** Confirming an imported record is for whoever may change it. */
async function confirmer(type: Confirmable, id: string) {
  const active = await requireCapability('record.write');
  const organisationId = active.membership.organisationId;
  // An agreement belongs to the organisation; the rest to an entity.
  const entityId =
    type === 'dpa'
      ? undefined
      : await withOrganisation(organisationId, async () => {
          const table =
            type === 'processing_activity'
              ? processingActivities
              : type === 'evidence'
                ? evidence
                : aiUseCases;
          const [row] = await db
            .select({ entityId: table.entityId })
            .from(table)
            .where(
              and(eq(table.id, id), eq(table.organisationId, organisationId))
            );
          return row?.entityId ?? null;
        });
  // Gone since the page was drawn, say an import undone meanwhile.
  if (entityId === null) return null;
  if (!can(active.membership.grants, 'record.write', entityId))
    throw new NotPermitted('record.write', entityId);
  return { active, organisationId };
}

/** On an imported record: a person has checked it and confirms it is current. */
export async function confirmImportedAction(
  type: Confirmable,
  id: string,
  revalidate: string,
  _prev: EditResult
): Promise<EditResult> {
  const who = await confirmer(type, id);
  if (!who)
    return {
      ok: false,
      message: 'That record is not waiting to be confirmed.'
    };
  const { active, organisationId } = who;
  const result = await refusable(() =>
    confirmImportedRecord({
      organisationId,
      type,
      id,
      actor: {
        actorKind: 'user',
        actorUserId: active.userId,
        actorLabel: active.email
      }
    })
  );
  revalidatePath(revalidate);
  return result?.ok ? { ok: true, message: 'Confirmed.' } : result;
}
