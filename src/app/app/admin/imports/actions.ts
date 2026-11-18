'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  aiUseCases,
  assessments,
  breaches,
  dataProtectionComplaints,
  dataSubjectRequests,
  evidence,
  informationAssets,
  informationRequests,
  mitigations,
  policies,
  policyDocuments,
  processingActivities,
  risks
} from '@/db/schema';
import { refusable, type EditResult } from '@/lib/edit-result';
import type { RecordType } from '@/lib/import/fields';
import { can, canInScope, mayImport } from '@/lib/rbac';
import { NotPermitted, refusedUnless, requireCapability } from '@/lib/session';
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
  const refusal = await refusedUnless('file.upload');
  if (refusal) return refusal;
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
  // "value:<field>:<as written>" is what a person said a rating is here.
  const values: Record<string, Record<string, string>> = {};
  // "every:<value>" in a field's choice is one value for every row.
  const everyRow: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith('field:') && text(value).startsWith('every:'))
      everyRow[name.slice('field:'.length)] = text(value).slice(
        'every:'.length
      );
    else if (name.startsWith('field:') && text(value))
      fields[name.slice('field:'.length)] = text(value);
    if (name.startsWith('value:') && text(value)) {
      const [field, ...given] = name.slice('value:'.length).split(':');
      (values[field] ??= {})[given.join(':')] = text(value);
    }
  }
  const result = await refusable(() =>
    previewImport({
      organisationId,
      batchId,
      mapping: {
        fields,
        keepUnmapped: formData.get('keepUnmapped') === 'on',
        values,
        everyRow,
        closedBefore: text(formData.get('closedBefore')) || undefined
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
  const refusal = await refusedUnless('file.upload');
  if (refusal) return refusal;
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
  const refusal = await refusedUnless('contact.outside');
  if (refusal) return refusal;
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

const ENTITY_TABLE = {
  processing_activity: processingActivities,
  evidence,
  ai_use_case: aiUseCases,
  information_asset: informationAssets,
  risk: risks,
  policy: policies,
  policy_document: policyDocuments,
  assessment: assessments,
  data_subject_request: dataSubjectRequests,
  breach: breaches,
  data_protection_complaint: dataProtectionComplaints,
  information_request: informationRequests
} as const;

/**
 * Whom an imported record is for: its entity; null for a policy or policy
 * document for every entity; undefined for an agreement, which is the
 * organisation's and is confirmed by anyone who may write records.
 * Gone, where it no longer exists.
 */
async function scopeOf(
  type: Confirmable,
  id: string,
  organisationId: string
): Promise<{ entityId: string | null | undefined } | 'gone'> {
  if (type === 'dpa') return { entityId: undefined };
  return withOrganisation(organisationId, async () => {
    // A mitigation belongs to its risk's entity.
    if (type === 'mitigation') {
      const [row] = await db
        .select({ entityId: risks.entityId })
        .from(mitigations)
        .innerJoin(risks, eq(risks.id, mitigations.riskId))
        .where(
          and(eq(mitigations.id, id), eq(risks.organisationId, organisationId))
        );
      return row ? { entityId: row.entityId } : 'gone';
    }
    const table = ENTITY_TABLE[type];
    const [row] = await db
      .select({ entityId: table.entityId })
      .from(table)
      .where(and(eq(table.id, id), eq(table.organisationId, organisationId)));
    return row ? { entityId: row.entityId } : 'gone';
  });
}

/** Confirming an imported record is for whoever may change it. */
async function confirmer(type: Confirmable, id: string) {
  const active = await requireCapability('record.write');
  const organisationId = active.membership.organisationId;
  const scope = await scopeOf(type, id, organisationId);
  // Gone since the page was drawn, say an import undone meanwhile.
  if (scope === 'gone') return null;
  const grants = active.membership.grants;
  // A record for every entity binds them all: confirming it needs the
  // capability across the organisation, as changing it does.
  const allowed =
    scope.entityId === undefined
      ? can(grants, 'record.write')
      : canInScope(grants, 'record.write', scope.entityId);
  if (!allowed)
    throw new NotPermitted('record.write', scope.entityId ?? undefined);
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
