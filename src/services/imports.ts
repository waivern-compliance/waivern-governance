import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import {
  aiUseCases,
  assessments,
  documents,
  dpas,
  entities,
  evidence,
  extractions,
  importBatches,
  importFiles,
  importMappings,
  importRows,
  importSources,
  informationAssetActivities,
  informationAssetRisks,
  informationAssets,
  informationAssetSuppliers,
  memberships,
  mitigations,
  processingActivities,
  recordLinks,
  risks,
  suppliers,
  users
} from '@/db/schema';
import { AI_FRAMEWORKS } from '@/lib/ai-frameworks';
import {
  CLASSIFICATION_SCHEMES,
  type AssetClassification
} from '@/lib/assets/register';
import { appendAuditEvent } from '@/lib/audit';
import { ACCEPTED } from '@/lib/documents/limits';
import { ukLawApplies } from '@/lib/dpa2018/applies';
import { basesFromTextFor } from '@/lib/gdpr/lawful-basis';
import {
  CARRIES_FILES,
  convertRow,
  ENTITY_SCOPED,
  FIELDS,
  guessMapping,
  TRANSLATED,
  type RecordType
} from '@/lib/import/fields';
import {
  ImportFileRefused,
  MAX_FILE_BYTES,
  parseCsv,
  rowObject,
  toTable,
  type Table
} from '@/lib/import/parse';
import type {
  ImportLink,
  ImportMapping,
  ImportRecord,
  SourceEvent
} from '@/lib/import/types';
import { nextReference } from '@/lib/references';
import { rate, SCALES, type RiskScaleId } from '@/lib/risk/scale';

import { createUseCase } from './ai-register';
import { assetTypology } from './asset-types';
import { checkFile, insertDocument, UploadRefused } from './documents';
import { ExtractionUnavailable, runExtraction } from './extraction';
import { classificationSchemeOf } from './information-assets';
import { canonicalise as canonicaliseByPush } from './ingest';
import { riskScaleOf } from './risks';
import { cleanLawfulBases } from './ropa';
import type { Actor } from './templates';
import { canonicalise } from './third-party';
import { refuseDuringTrial } from './trial-guard';

/**
 * Moving records in from another platform: upload, match columns to fields,
 * add the files the rows name, preview every row's outcome, import, and undo.
 * See docs/migration-plan.md.
 *
 * An import writes as one step: every row of the preview, or nothing. Each
 * record keeps the platform and batch it came from, its identifier there, and
 * the source's fields with no home here, and waits for a person to confirm it.
 */

export class ImportRefused extends Error {}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Action = 'create' | 'update' | 'merge' | 'refuse' | 'skip';
type Counts = Partial<Record<Action, number>>;
type Of<K extends ImportRecord['kind']> = Extract<ImportRecord, { kind: K }>;

const SOURCE_NAME_LIMIT = 80;

/** The workbook's first sheet, or the CSV, as a table. */
async function readFile(bytes: Uint8Array): Promise<Table> {
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new ImportRefused(
      `The file is over ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it into several.`
    );
  try {
    // An .xlsx file is a zip archive, which starts "PK".
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const { readSheet } = await import('read-excel-file/node');
      return toTable((await readSheet(Buffer.from(bytes))) as unknown[][]);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return toTable(parseCsv(text));
  } catch (error) {
    if (error instanceof ImportFileRefused)
      throw new ImportRefused(error.message);
    if (error instanceof TypeError)
      throw new ImportRefused(
        'The file is not readable as UTF-8 text. Save it as CSV (UTF-8) or as an Excel workbook.'
      );
    throw new ImportRefused(
      'The file could not be read. Give a CSV file or an Excel workbook (.xlsx).'
    );
  }
}

const tally = (actions: Action[]): Counts =>
  actions.reduce<Counts>((c, a) => ({ ...c, [a]: (c[a] ?? 0) + 1 }), {});

/**
 * Upload a file: kept with its batch, its header read for the matching step.
 * Nothing is imported yet.
 */
export async function uploadImport(input: {
  organisationId: string;
  recordType: RecordType;
  sourceName: string;
  entityId?: string | null;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  actor: Actor;
}) {
  await refuseDuringTrial(input.organisationId, 'file.upload');
  const sourceName = input.sourceName.trim().replace(/\s+/g, ' ');
  if (!sourceName)
    throw new ImportRefused(
      'Name the platform it comes from, such as OneTrust.'
    );
  if (sourceName.length > SOURCE_NAME_LIMIT)
    throw new ImportRefused('The platform name is too long.');
  if (!(input.recordType in FIELDS))
    throw new ImportRefused('Choose what the file holds.');
  const table = await readFile(input.bytes);

  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      let entityId: string | null = null;
      if (ENTITY_SCOPED.has(input.recordType)) {
        const [entity] = await tx
          .select({ id: entities.id })
          .from(entities)
          .where(
            and(
              eq(entities.organisationId, input.organisationId),
              input.entityId
                ? eq(entities.id, input.entityId)
                : eq(entities.isDefault, true)
            )
          );
        if (!entity)
          throw new ImportRefused('Choose the legal entity they belong to.');
        entityId = entity.id;
      }
      // Insert-or-read, so two first uploads naming the same platform at once
      // both land on the one source rather than one failing.
      await tx
        .insert(importSources)
        .values({ organisationId: input.organisationId, name: sourceName })
        .onConflictDoNothing();
      const [source] = await tx
        .select()
        .from(importSources)
        .where(
          and(
            eq(importSources.organisationId, input.organisationId),
            sql`lower(${importSources.name}) = lower(${sourceName})`
          )
        );
      const [batch] = await tx
        .insert(importBatches)
        .values({
          organisationId: input.organisationId,
          sourceId: source.id,
          recordType: input.recordType,
          entityId,
          filename: input.filename.slice(0, 200) || 'upload',
          contentType: input.contentType.slice(0, 100) || 'text/csv',
          file: Buffer.from(input.bytes),
          columns: table.columns,
          rowCount: table.rows.length,
          createdBy: input.actor.actorUserId ?? null,
          createdByLabel: input.actor.actorLabel
        })
        .returning({ id: importBatches.id });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: entityId ?? undefined,
        action: 'import.uploaded',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        after: {
          batch: batch.id,
          source: source.name,
          recordType: input.recordType,
          filename: input.filename,
          rows: table.rows.length
        }
      });
      return batch;
    })
  );
}

const batchColumns = {
  id: importBatches.id,
  organisationId: importBatches.organisationId,
  sourceId: importBatches.sourceId,
  sourceName: importSources.name,
  recordType: importBatches.recordType,
  entityId: importBatches.entityId,
  entityName: entities.name,
  filename: importBatches.filename,
  columns: importBatches.columns,
  rowCount: importBatches.rowCount,
  mapping: importBatches.mapping,
  status: importBatches.status,
  counts: importBatches.counts,
  createdByLabel: importBatches.createdByLabel,
  createdAt: importBatches.createdAt,
  committedAt: importBatches.committedAt,
  committedByLabel: importBatches.committedByLabel,
  undoneAt: importBatches.undoneAt,
  undoneByLabel: importBatches.undoneByLabel
};

/** Every batch, newest first, without its file. */
export async function importBatchesFor(organisationId: string) {
  return withOrganisation(organisationId, () =>
    db
      .select(batchColumns)
      .from(importBatches)
      .innerJoin(importSources, eq(importSources.id, importBatches.sourceId))
      .leftJoin(entities, eq(entities.id, importBatches.entityId))
      .where(eq(importBatches.organisationId, organisationId))
      .orderBy(desc(importBatches.createdAt))
  );
}

/**
 * One batch with its rows and files, and the matching to offer: the batch's
 * own, else the one last used for this platform and record type, else a
 * guess by name.
 */
export async function loadImport(batchId: string, organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const [batch] = await db
      .select(batchColumns)
      .from(importBatches)
      .innerJoin(importSources, eq(importSources.id, importBatches.sourceId))
      .leftJoin(entities, eq(entities.id, importBatches.entityId))
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.organisationId, organisationId)
        )
      );
    if (!batch) return null;
    const [rows, [saved], files] = await Promise.all([
      db
        .select({
          id: importRows.id,
          rowNumber: importRows.rowNumber,
          sourceRef: importRows.sourceRef,
          action: importRows.action,
          reason: importRows.reason,
          recordId: importRows.recordId,
          documentId: importRows.documentId,
          // An agreement is opened on its supplier's page, and a
          // mitigation on its risk's.
          supplierId: dpas.supplierId,
          riskId: mitigations.riskId
        })
        .from(importRows)
        .innerJoin(importBatches, eq(importBatches.id, importRows.batchId))
        .leftJoin(
          dpas,
          and(
            eq(dpas.id, importRows.recordId),
            eq(importBatches.recordType, 'dpa')
          )
        )
        .leftJoin(
          mitigations,
          and(
            eq(mitigations.id, importRows.recordId),
            eq(importBatches.recordType, 'mitigation')
          )
        )
        .where(eq(importRows.batchId, batch.id))
        .orderBy(importRows.rowNumber),
      db
        .select({ mapping: importMappings.mapping })
        .from(importMappings)
        .where(
          and(
            eq(importMappings.organisationId, organisationId),
            eq(importMappings.sourceId, batch.sourceId),
            eq(importMappings.recordType, batch.recordType)
          )
        ),
      db
        .select({
          id: importFiles.id,
          filename: importFiles.filename,
          byteSize: importFiles.byteSize,
          addedAt: importFiles.addedAt
        })
        .from(importFiles)
        .where(eq(importFiles.batchId, batch.id))
        .orderBy(importFiles.filename)
    ]);
    const offered = batch.mapping ?? saved?.mapping;
    const mapping: ImportMapping = offered
      ? {
          // Only columns this file has.
          fields: Object.fromEntries(
            Object.entries(offered.fields).filter(([, c]) =>
              batch.columns.includes(c)
            )
          ),
          keepUnmapped: offered.keepUnmapped,
          ...(offered.values ? { values: offered.values } : {})
        }
      : guessMapping(batch.recordType, batch.columns);
    return { batch, rows, mapping, files };
  });
}

/** At most this many values are offered for translation per field. */
const TRANSLATION_LIMIT = 40;

/** The values each translated field's column holds, as written, without repeats. */
function valuesIn(
  table: Table,
  recordType: RecordType,
  mapping: ImportMapping
): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const f of FIELDS[recordType]) {
    if (!TRANSLATED.has(f.key) || !mapping.fields[f.key]) continue;
    const at = table.columns.indexOf(mapping.fields[f.key]);
    const seen = new Map<string, string>();
    for (const cells of table.rows) {
      const v = String(cells[at] ?? '').trim();
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
      if (seen.size >= TRANSLATION_LIMIT) break;
    }
    found[f.key] = [...seen.values()].sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true })
    );
  }
  return found;
}

/**
 * The values each translated field's column held at the last preview, for a
 * person to say what each is on this organisation's scale. With the scale,
 * for the choices.
 */
export async function valuesToTranslate(
  organisationId: string,
  batchId: string
): Promise<{
  scale: RiskScaleId;
  fields: Array<{ key: string; values: string[] }>;
}> {
  return withOrganisation(organisationId, async () => {
    const [batch] = await db
      .select({ found: importBatches.valuesFound })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.organisationId, organisationId)
        )
      );
    const scale = await riskScaleOf(organisationId);
    return {
      scale,
      fields: Object.entries(batch?.found ?? {})
        .filter(([, values]) => values.length > 0)
        .map(([key, values]) => ({ key, values }))
    };
  });
}

async function lockedBatch(tx: Tx, organisationId: string, batchId: string) {
  const [batch] = await tx
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.id, batchId),
        eq(importBatches.organisationId, organisationId)
      )
    )
    .for('update');
  if (!batch) throw new ImportRefused('No such import.');
  return batch;
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg'
};

/** The type of a file: as the browser said, or from its name where it did not. */
function typeOf(filename: string, given: string) {
  if (ACCEPTED.has(given)) return given;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return TYPE_BY_EXTENSION[ext] ?? given;
}

/**
 * Add files for the rows to name. Each is checked as any attachment is
 * (type, contents, size, viruses) when added, so the import itself cannot
 * fail on one. Adding a file after a preview means previewing again.
 */
export async function addImportFiles(input: {
  organisationId: string;
  batchId: string;
  files: Array<{ filename: string; contentType: string; bytes: Uint8Array }>;
  actor: Actor;
}) {
  await refuseDuringTrial(input.organisationId, 'file.upload');
  const batch = await withOrganisation(input.organisationId, async () => {
    const [found] = await db
      .select({
        status: importBatches.status,
        recordType: importBatches.recordType,
        entityId: importBatches.entityId
      })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.id, input.batchId),
          eq(importBatches.organisationId, input.organisationId)
        )
      );
    return found;
  });
  if (!batch) throw new ImportRefused('No such import.');
  if (!CARRIES_FILES.has(batch.recordType))
    throw new ImportRefused('This kind of record does not carry files.');
  if (batch.status !== 'uploaded' && batch.status !== 'previewed')
    throw new ImportRefused(`This import has been ${batch.status}.`);

  const added: string[] = [];
  const refused: Array<{ filename: string; reason: string }> = [];
  for (const f of input.files) {
    let file;
    try {
      // Outside the organisation's transaction, so the record of a refused
      // infected file is kept.
      file = await checkFile({
        organisationId: input.organisationId,
        entityId: batch.entityId,
        filename: f.filename,
        contentType: typeOf(f.filename, f.contentType),
        content: Buffer.from(f.bytes),
        actor: input.actor,
        auditAs: {
          subjectType: 'organisation',
          subjectId: input.organisationId
        }
      });
    } catch (error) {
      if (!(error instanceof UploadRefused)) throw error;
      refused.push({ filename: f.filename, reason: error.message });
      continue;
    }
    const checked = file;
    const stored = await withOrganisation(input.organisationId, () =>
      db.transaction(async (tx) => {
        const current = await lockedBatch(
          tx,
          input.organisationId,
          input.batchId
        );
        if (current.status !== 'uploaded' && current.status !== 'previewed')
          throw new ImportRefused(`This import has been ${current.status}.`);
        const [row] = await tx
          .insert(importFiles)
          .values({
            organisationId: input.organisationId,
            batchId: input.batchId,
            filename: checked.filename,
            contentType: checked.contentType,
            byteSize: checked.content.byteLength,
            sha256: checked.sha256,
            content: checked.content,
            scannedAt: checked.scan?.scannedAt ?? null,
            scannerVersion: checked.scan?.scannerVersion ?? null,
            addedByLabel: input.actor.actorLabel
          })
          .onConflictDoNothing()
          .returning({ id: importFiles.id });
        if (!row) return false;
        // A preview made before this file was here is out of date.
        await tx
          .update(importBatches)
          .set({ status: 'uploaded' })
          .where(eq(importBatches.id, input.batchId));
        await appendAuditEvent(tx, {
          ...input.actor,
          organisationId: input.organisationId,
          entityId: batch.entityId ?? undefined,
          action: 'import.file_added',
          subjectType: 'organisation',
          subjectId: input.organisationId,
          after: {
            batch: input.batchId,
            filename: checked.filename,
            bytes: checked.content.byteLength,
            sha256: checked.sha256
          }
        });
        return true;
      })
    );
    if (stored) added.push(checked.filename);
    else
      refused.push({
        filename: f.filename,
        reason: 'A file of that name is already added.'
      });
  }
  return { added, refused };
}

/** Take a file back out of an import not yet made. */
export async function removeImportFile(input: {
  organisationId: string;
  batchId: string;
  fileId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const batch = await lockedBatch(tx, input.organisationId, input.batchId);
      if (batch.status !== 'uploaded' && batch.status !== 'previewed')
        throw new ImportRefused(`This import has been ${batch.status}.`);
      const [gone] = await tx
        .delete(importFiles)
        .where(
          and(
            eq(importFiles.id, input.fileId),
            eq(importFiles.batchId, batch.id)
          )
        )
        .returning({ filename: importFiles.filename });
      if (!gone) throw new ImportRefused('That file is not in this import.');
      await tx
        .update(importBatches)
        .set({ status: 'uploaded' })
        .where(eq(importBatches.id, batch.id));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: batch.entityId ?? undefined,
        action: 'import.file_removed',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        after: { batch: batch.id, filename: gone.filename }
      });
    })
  );
}

type Attachment = {
  type: 'processing_activity' | 'assessment' | 'risk';
  id: string;
};

/** An asset's row read into this organisation's terms. */
type AssetResolved = {
  assetType: string;
  hasExpiry: boolean;
  classification: AssetClassification | null;
  ownerId: string | null;
  activityIds: string[];
  supplierIds: string[];
};

/** A risk's row read onto this organisation's scale and registers. */
type RiskResolved = {
  scale: RiskScaleId;
  inherent: { likelihood: number; impact: number };
  residual: { likelihood: number; impact: number } | null;
  ownerId: string | null;
  category: string | null;
  concerns: Array<{
    type: 'processing_activity' | 'supplier' | 'ai_use_case';
    id: string;
  }>;
  assetIds: string[];
};

/** A mitigation's risk, and its owner here, where they are a member. */
type MitigationResolved = {
  riskId: string;
  ownerId: string | null;
};

type Resolved = {
  /** The supplier an agreement belongs to, or an AI system is linked to. */
  supplierId?: string | null;
  /** The record a piece of evidence supports. */
  attach?: Attachment | null;
  asset?: AssetResolved;
  risk?: RiskResolved;
  mitigation?: MitigationResolved;
};

type Decision =
  | ({ action: 'create'; recordId: null } & Resolved)
  | ({ action: 'update' | 'merge'; recordId: string } & Resolved)
  | { action: 'refuse'; reason: string };

type Batch = {
  id: string;
  organisationId: string;
  sourceId: string;
  recordType: RecordType;
  entityId: string | null;
  mapping?: ImportMapping | null;
};

/** Records of one entity-scoped kind imported from this source, by their identifier there. */
async function importedBy(
  tx: Tx,
  batch: Batch,
  kind:
    | 'processing_activity'
    | 'evidence'
    | 'ai_use_case'
    | 'information_asset'
    | 'risk'
) {
  const table = TABLE[kind];
  const rows = await tx
    .select({
      id: table.id,
      ref: table.externalRef,
      entityId: table.entityId,
      entityName: entities.name
    })
    .from(table)
    .innerJoin(entities, eq(entities.id, table.entityId))
    .where(
      and(
        eq(table.organisationId, batch.organisationId),
        eq(table.importSourceId, batch.sourceId)
      )
    );
  // Identifiers compared without case: exports differ in how they spell them.
  const byRef = new Map(rows.map((r) => [r.ref?.toLowerCase(), r]));
  // Moving a record between entities changes who answers for it: not an
  // import's call.
  return (sourceRef: string, extra: Resolved = {}): Decision => {
    const found = byRef.get(sourceRef.toLowerCase());
    if (!found) return { ...extra, action: 'create', recordId: null };
    if (batch.entityId && found.entityId !== batch.entityId)
      return {
        action: 'refuse',
        reason: `Imported before into ${found.entityName}. Import it into that entity, or move it there first.`
      };
    return { ...extra, action: 'update', recordId: found.id };
  };
}

/** Suppliers by either spelling of their key: typed in, or pushed. */
async function suppliersByKey(tx: Tx, organisationId: string) {
  const rows = await tx
    .select({ id: suppliers.id, key: suppliers.canonicalKey })
    .from(suppliers)
    .where(eq(suppliers.organisationId, organisationId));
  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  return (name: string) =>
    byKey.get(canonicalise(name)) ?? byKey.get(canonicaliseByPush(name));
}

/**
 * The entity's records by reference: ROPA-2026-0004, DPIA-2026-0001,
 * RISK-2026-0007. Only the entity's own, so evidence never supports a record
 * of an entity that does not hold it.
 */
async function attachments(tx: Tx, organisationId: string, entityId: string) {
  const [a, p, r] = await Promise.all([
    tx
      .select({ id: assessments.id, ref: assessments.reference })
      .from(assessments)
      .where(
        and(
          eq(assessments.organisationId, organisationId),
          eq(assessments.entityId, entityId)
        )
      ),
    tx
      .select({
        id: processingActivities.id,
        ref: processingActivities.reference
      })
      .from(processingActivities)
      .where(
        and(
          eq(processingActivities.organisationId, organisationId),
          eq(processingActivities.entityId, entityId)
        )
      ),
    tx
      .select({ id: risks.id, ref: risks.reference })
      .from(risks)
      .where(
        and(
          eq(risks.organisationId, organisationId),
          eq(risks.entityId, entityId)
        )
      )
  ]);
  const byRef = new Map<string, Attachment>();
  for (const x of a)
    byRef.set(x.ref.toLowerCase(), { type: 'assessment', id: x.id });
  for (const x of p)
    byRef.set(x.ref.toLowerCase(), { type: 'processing_activity', id: x.id });
  for (const x of r) byRef.set(x.ref.toLowerCase(), { type: 'risk', id: x.id });
  return (ref: string) => byRef.get(ref.trim().toLowerCase()) ?? null;
}

/**
 * What each checked row would do now: create, update, add to a supplier, or
 * nothing, with the reason. What the rows could match is read once for the
 * whole file, not row by row.
 */
async function matcher(
  tx: Tx,
  batch: Batch
): Promise<(record: ImportRecord, sourceRef: string) => Decision> {
  const files = new Set(
    (
      await tx
        .select({ filename: importFiles.filename })
        .from(importFiles)
        .where(eq(importFiles.batchId, batch.id))
    ).map((f) => f.filename.toLowerCase())
  );
  const missingFile = (name?: string): Decision | null =>
    name && !files.has(name.toLowerCase())
      ? {
          action: 'refuse',
          reason: `The file "${name}" has not been added to this import.`
        }
      : null;

  switch (batch.recordType) {
    case 'processing_activity': {
      const decide = await importedBy(tx, batch, 'processing_activity');
      return (_record, sourceRef) => decide(sourceRef);
    }
    case 'supplier': {
      const existing = await tx
        .select({
          id: suppliers.id,
          ref: suppliers.externalRef,
          sourceId: suppliers.importSourceId,
          key: suppliers.canonicalKey
        })
        .from(suppliers)
        .where(eq(suppliers.organisationId, batch.organisationId));
      const byRef = new Map(
        existing
          .filter((r) => r.sourceId === batch.sourceId && r.ref)
          .map((r) => [r.ref!.toLowerCase(), r.id])
      );
      const byKey = new Map(existing.map((r) => [r.key, r.id]));
      return (record, sourceRef) => {
        const own = byRef.get(sourceRef.toLowerCase());
        if (own) return { action: 'update', recordId: own };
        const same = byKey.get(
          canonicalise((record as Of<'supplier'>).data.name)
        );
        return same
          ? { action: 'merge', recordId: same }
          : { action: 'create', recordId: null };
      };
    }
    case 'dpa': {
      const own = new Map(
        (
          await tx
            .select({
              id: dpas.id,
              ref: dpas.externalRef,
              supplierId: dpas.supplierId,
              supplierName: suppliers.name,
              archivedAt: dpas.archivedAt,
              transferMechanism: dpas.transferMechanism,
              transferMechanisms: dpas.transferMechanisms
            })
            .from(dpas)
            .innerJoin(suppliers, eq(suppliers.id, dpas.supplierId))
            .where(
              and(
                eq(dpas.organisationId, batch.organisationId),
                eq(dpas.importSourceId, batch.sourceId)
              )
            )
        ).map((r) => [r.ref?.toLowerCase(), r])
      );
      const supplierOf = await suppliersByKey(tx, batch.organisationId);
      return (record, sourceRef) => {
        const { data } = record as Of<'dpa'>;
        const file = missingFile(data.file);
        if (file) return file;
        const supplierId = supplierOf(data.supplier);
        // An agreement is with a supplier the register already knows. Making
        // one up from a contract's name would put guesses on the register.
        if (!supplierId)
          return {
            action: 'refuse',
            reason: `No supplier called "${data.supplier}" is recorded. Import or add the supplier first.`
          };
        const found = own.get(sourceRef.toLowerCase());
        if (!found) return { action: 'create', recordId: null, supplierId };
        // Moving an agreement to another supplier, or reviving an archived
        // one, changes what the register says about both: a person's call.
        if (found.supplierId !== supplierId)
          return {
            action: 'refuse',
            reason: `Imported before as an agreement with ${found.supplierName}. Correct it on that supplier's page, or give it a new identifier.`
          };
        if (found.archivedAt)
          return {
            action: 'refuse',
            reason: `Imported before and since archived on ${found.supplierName}'s page. Give it a new identifier to record it again.`
          };
        // The mechanisms ticked here are a person's decision, and the text is
        // their note; an import saying something else is for that person.
        if (
          data.transferMechanism &&
          found.transferMechanisms.length > 0 &&
          data.transferMechanism.trim() !==
            (found.transferMechanism ?? '').trim()
        )
          return {
            action: 'refuse',
            reason: `Its transfer mechanisms were chosen on ${found.supplierName}'s page, and this row describes them differently. Change them there, or leave the column empty.`
          };
        return { action: 'update', recordId: found.id, supplierId };
      };
    }
    case 'evidence': {
      const decide = await importedBy(tx, batch, 'evidence');
      const attachmentOf = await attachments(
        tx,
        batch.organisationId,
        batch.entityId!
      );
      return (record, sourceRef) => {
        const { data } = record as Of<'evidence'>;
        const file = missingFile(data.file);
        if (file) return file;
        const attach = data.attachTo ? attachmentOf(data.attachTo) : null;
        if (data.attachTo && !attach)
          return {
            action: 'refuse',
            reason: `Nothing in this entity has the reference "${data.attachTo}".`
          };
        return decide(sourceRef, { attach });
      };
    }
    case 'ai_use_case': {
      const decide = await importedBy(tx, batch, 'ai_use_case');
      const supplierOf = await suppliersByKey(tx, batch.organisationId);
      return (record, sourceRef) => {
        const { data } = record as Of<'ai_use_case'>;
        const supplierId = data.supplierName
          ? (supplierOf(data.supplierName) ?? null)
          : null;
        return decide(sourceRef, { supplierId });
      };
    }
    case 'risk': {
      const decide = await importedBy(tx, batch, 'risk');
      const resolve = await riskResolver(tx, batch);
      return (record, sourceRef) => {
        const risk = resolve((record as Of<'risk'>).data);
        return 'reason' in risk
          ? { action: 'refuse', reason: risk.reason }
          : decide(sourceRef, { risk });
      };
    }
    case 'mitigation': {
      const resolve = await mitigationResolver(tx, batch);
      return (record, sourceRef) =>
        resolve((record as Of<'mitigation'>).data, sourceRef);
    }
    case 'information_asset': {
      const decide = await importedBy(tx, batch, 'information_asset');
      const resolve = await assetResolver(tx, batch);
      // The type each asset imported before from this source has now: one
      // since retired may stay on the asset that has it, as when edited here.
      const typeNow = new Map(
        (
          await tx
            .select({
              ref: informationAssets.externalRef,
              assetType: informationAssets.assetType
            })
            .from(informationAssets)
            .where(
              and(
                eq(informationAssets.organisationId, batch.organisationId),
                eq(informationAssets.importSourceId, batch.sourceId)
              )
            )
        ).map((a) => [a.ref?.toLowerCase(), a.assetType])
      );
      return (record, sourceRef) => {
        const asset = resolve(
          (record as Of<'information_asset'>).data,
          typeNow.get(sourceRef.toLowerCase())
        );
        return 'reason' in asset
          ? { action: 'refuse', reason: asset.reason }
          : decide(sourceRef, { asset });
      };
    }
  }
}

/** Compared without case, spacing or punctuation: "Domain name", "domain-name". */
const loose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Members by email address, compared without case. */
async function membersByEmail(tx: Tx, organisationId: string) {
  const rows = await tx
    .select({ id: users.id, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organisationId, organisationId));
  const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));
  return (email: string) => byEmail.get(email.trim().toLowerCase()) ?? null;
}

/**
 * Processing activities of the batch's entity by the reference Govern gave
 * them, their identifier in this source, or their name.
 */
async function activitiesByName(tx: Tx, batch: Batch) {
  const rows = await tx
    .select({
      id: processingActivities.id,
      reference: processingActivities.reference,
      ref: processingActivities.externalRef,
      sourceId: processingActivities.importSourceId,
      name: processingActivities.name
    })
    .from(processingActivities)
    .where(
      and(
        eq(processingActivities.organisationId, batch.organisationId),
        eq(processingActivities.entityId, batch.entityId!)
      )
    );
  const byKey = new Map<string, string>();
  // Weakest first, so a reference or an identifier wins over a name.
  for (const r of rows) byKey.set(`name:${loose(r.name)}`, r.id);
  for (const r of rows)
    if (r.sourceId === batch.sourceId && r.ref)
      byKey.set(`ref:${r.ref.toLowerCase()}`, r.id);
  for (const r of rows) byKey.set(`ref:${r.reference.toLowerCase()}`, r.id);
  return (given: string) =>
    byKey.get(`ref:${given.trim().toLowerCase()}`) ??
    byKey.get(`name:${loose(given)}`) ??
    null;
}

/** Records of the batch's entity by Govern reference, ID in this source, or name. */
async function entityRecordsByName(
  tx: Tx,
  batch: Batch,
  table: typeof aiUseCases | typeof informationAssets
) {
  const rows = (await tx
    .select()
    .from(table)
    .where(
      and(
        eq(table.organisationId, batch.organisationId),
        eq(table.entityId, batch.entityId!)
      )
    )) as Array<{
    id: string;
    name: string;
    reference?: string;
    externalRef: string | null;
    importSourceId: string | null;
  }>;
  const byKey = new Map<string, string>();
  for (const r of rows) byKey.set(`name:${loose(r.name)}`, r.id);
  for (const r of rows)
    if (r.importSourceId === batch.sourceId && r.externalRef)
      byKey.set(`ref:${r.externalRef.toLowerCase()}`, r.id);
  for (const r of rows)
    if (r.reference) byKey.set(`ref:${r.reference.toLowerCase()}`, r.id);
  return (given: string) =>
    byKey.get(`ref:${given.trim().toLowerCase()}`) ??
    byKey.get(`name:${loose(given)}`) ??
    null;
}

/** An AI risk category by its key or label, or the category as written. */
function categoryOf(given: string | undefined): string | null {
  const v = given?.trim();
  if (!v) return null;
  for (const pack of Object.values(AI_FRAMEWORKS))
    for (const c of pack.categories)
      if (c.value === v.toLowerCase() || loose(c.label) === loose(v))
        return c.value;
  return v;
}

/**
 * A rating read onto the organisation's scale: a number on it, one of its
 * words ("Likely"), or the value a person said it is for this source. Nothing
 * else is guessed, so a rating of "High" waits for a person to say what high
 * means here.
 */
function ratingReader(
  scale: RiskScaleId,
  values: ImportMapping['values'] = {}
) {
  const points = {
    likelihood: SCALES[scale].likelihood,
    impact: SCALES[scale].impact
  };
  return (
    field: string,
    axis: 'likelihood' | 'impact',
    label: string,
    given: string
  ): number | { reason: string } => {
    const v = given.trim();
    const chosen = values[field]?.[v.toLowerCase()];
    if (chosen) {
      // Saved for this source on another scale, before the scale changed.
      if (points[axis].some((p) => p.value === Number(chosen)))
        return Number(chosen);
      return {
        reason: `${label} "${v}" was translated as ${chosen}, which is not on the ${SCALES[scale].inSentence} scale this organisation now uses. Say again what it is on the matching step.`
      };
    }
    const n = Number(v);
    if (Number.isInteger(n) && points[axis].some((p) => p.value === n))
      return n;
    const word = points[axis].find((p) => loose(p.label) === loose(v));
    if (word) return word.value;
    return {
      reason: `${label} "${v}" is not on the ${SCALES[scale].inSentence} scale this organisation uses. Say what it is on the matching step.`
    };
  };
}

/**
 * A risk's ratings, owner, category and links read into this organisation's
 * terms. What it concerns must already be recorded in the entity; an owner
 * who is not a member is kept to read, as for assets.
 */
async function riskResolver(tx: Tx, batch: Batch) {
  const [scale, memberOf, activityOf, supplierOf, systemOf, assetOf] =
    await Promise.all([
      riskScaleOf(batch.organisationId, tx),
      membersByEmail(tx, batch.organisationId),
      activitiesByName(tx, batch),
      suppliersByKey(tx, batch.organisationId),
      entityRecordsByName(tx, batch, aiUseCases),
      entityRecordsByName(tx, batch, informationAssets)
    ]);
  const read = ratingReader(scale, batch.mapping?.values);
  return (data: Of<'risk'>['data']): RiskResolved | { reason: string } => {
    const likelihood = read(
      'inherentLikelihood',
      'likelihood',
      'Likelihood',
      data.inherentLikelihood
    );
    if (typeof likelihood !== 'number') return likelihood;
    const impact = read(
      'inherentImpact',
      'impact',
      'Impact',
      data.inherentImpact
    );
    if (typeof impact !== 'number') return impact;
    let residual: RiskResolved['residual'] = null;
    if (data.residualLikelihood || data.residualImpact) {
      if (!data.residualLikelihood || !data.residualImpact)
        return {
          reason:
            'A residual rating needs both its likelihood and its impact, or neither.'
        };
      const rl = read(
        'residualLikelihood',
        'likelihood',
        'Residual likelihood',
        data.residualLikelihood
      );
      if (typeof rl !== 'number') return rl;
      const ri = read(
        'residualImpact',
        'impact',
        'Residual impact',
        data.residualImpact
      );
      if (typeof ri !== 'number') return ri;
      residual = { likelihood: rl, impact: ri };
    }
    if (data.status === 'closed' && !data.closedAt)
      return { reason: 'A closed risk needs the date it was closed.' };
    const concerns: RiskResolved['concerns'] = [];
    const lookups = [
      [
        'processing_activity',
        data.activities,
        activityOf,
        'processing activity'
      ],
      ['supplier', data.suppliers, supplierOf, 'supplier'],
      ['ai_use_case', data.aiSystems, systemOf, 'AI system']
    ] as const;
    for (const [type, names, find, words] of lookups)
      for (const name of names) {
        const id = find(name);
        if (!id)
          return {
            reason: `No ${words} "${name}" is recorded${type === 'supplier' ? '' : ' in this entity'}. Import or add it first.`
          };
        if (!concerns.some((c) => c.type === type && c.id === id))
          concerns.push({ type, id });
      }
    const assetIds: string[] = [];
    for (const name of data.assets) {
      const id = assetOf(name);
      if (!id)
        return {
          reason: `No information asset "${name}" is recorded in this entity. Import or add it first.`
        };
      if (!assetIds.includes(id)) assetIds.push(id);
    }
    return {
      scale,
      inherent: { likelihood, impact },
      residual,
      ownerId: data.owner ? memberOf(data.owner) : null,
      category: categoryOf(data.category),
      concerns,
      assetIds
    };
  };
}

/**
 * An asset's type, classification, owner and links read into this
 * organisation's terms: its own typology and scheme, its members, and the
 * activities and suppliers already recorded. What cannot be found refuses
 * the row, except an owner, who may simply not be a member here.
 */
async function assetResolver(tx: Tx, batch: Batch) {
  const [types, scheme, memberOf, activityOf, supplierOf] = await Promise.all([
    assetTypology(batch.organisationId),
    classificationSchemeOf(batch.organisationId, tx),
    membersByEmail(tx, batch.organisationId),
    activitiesByName(tx, batch),
    suppliersByKey(tx, batch.organisationId)
  ]);
  const levels: Record<string, string> = CLASSIFICATION_SCHEMES[scheme].levels;
  return (
    data: Of<'information_asset'>['data'],
    /** The type the matching asset has now, where there is one. */
    current?: string
  ): AssetResolved | { reason: string } => {
    const type = types.find(
      (t) =>
        t.key === data.assetType.trim().toLowerCase() ||
        loose(t.label) === loose(data.assetType)
    );
    if (!type)
      return {
        reason: `"${data.assetType}" is not an asset type here. Use one of: ${types
          .filter((t) => !t.retiredAt)
          .map((t) => t.label)
          .join(', ')}, or add it as a type first.`
      };
    if (type.retiredAt && type.key !== current)
      return {
        reason: `The ${type.label} type has been retired. Choose another.`
      };
    let classification: AssetClassification | null = null;
    if (data.classification) {
      const level = Object.entries(levels).find(
        ([key, label]) =>
          key === data.classification!.trim().toLowerCase() ||
          loose(label) === loose(data.classification!)
      );
      if (!level)
        return {
          reason: `"${data.classification}" is not a level of the ${CLASSIFICATION_SCHEMES[scheme].inSentence}, which this organisation uses. Use one of: ${Object.values(levels).join(', ')}.`
        };
      classification = level[0] as AssetClassification;
    }
    const activityIds: string[] = [];
    for (const name of data.activities) {
      const id = activityOf(name);
      if (!id)
        return {
          reason: `No processing activity "${name}" is recorded in this entity. Import or add it first.`
        };
      activityIds.push(id);
    }
    const supplierIds: string[] = [];
    for (const name of data.suppliers) {
      const id = supplierOf(name);
      if (!id)
        return {
          reason: `No supplier called "${name}" is recorded. Import or add the supplier first.`
        };
      supplierIds.push(id);
    }
    return {
      assetType: type.key,
      hasExpiry: type.hasExpiry,
      classification,
      ownerId: data.owner ? memberOf(data.owner) : null,
      activityIds: [...new Set(activityIds)],
      supplierIds: [...new Set(supplierIds)]
    };
  };
}

/**
 * A mitigation's risk, found by its identifier in this source or its
 * reference here, in the batch's entity, and the mitigation imported before
 * from this source, if any. A mitigation stays on the risk it came in on:
 * moving it to another risk is a person's call, as for an agreement's
 * supplier.
 */
async function mitigationResolver(tx: Tx, batch: Batch) {
  const [riskRows, earlier, memberOf] = await Promise.all([
    tx
      .select({
        id: risks.id,
        reference: risks.reference,
        ref: risks.externalRef,
        sourceId: risks.importSourceId,
        entityId: risks.entityId,
        entityName: entities.name
      })
      .from(risks)
      .innerJoin(entities, eq(entities.id, risks.entityId))
      .where(eq(risks.organisationId, batch.organisationId)),
    tx
      .select({
        id: mitigations.id,
        ref: mitigations.externalRef,
        riskId: mitigations.riskId,
        riskReference: risks.reference,
        entityId: risks.entityId,
        entityName: entities.name
      })
      .from(mitigations)
      .innerJoin(risks, eq(risks.id, mitigations.riskId))
      .innerJoin(entities, eq(entities.id, risks.entityId))
      .where(
        and(
          eq(risks.organisationId, batch.organisationId),
          eq(mitigations.importSourceId, batch.sourceId)
        )
      ),
    membersByEmail(tx, batch.organisationId)
  ]);
  // Risks of this entity by key, and elsewhere only to say where one is.
  const keyed = (here: boolean) => {
    const by = new Map<string, (typeof riskRows)[number]>();
    const rows = riskRows.filter(
      (r) => (r.entityId === batch.entityId) === here
    );
    // The source's identifier first, so a reference here wins a clash.
    for (const r of rows)
      if (r.sourceId === batch.sourceId && r.ref)
        by.set(r.ref.toLowerCase(), r);
    for (const r of rows) by.set(r.reference.toLowerCase(), r);
    return by;
  };
  const riskBy = keyed(true);
  const elsewhere = keyed(false);
  const own = new Map(earlier.map((m) => [m.ref?.toLowerCase(), m]));
  return (data: Of<'mitigation'>['data'], sourceRef: string): Decision => {
    const given = data.risk.trim().toLowerCase();
    const riskId = riskBy.get(given)?.id;
    if (!riskId) {
      const other = elsewhere.get(given);
      return {
        action: 'refuse',
        reason: other
          ? `The risk "${data.risk}" is recorded in ${other.entityName}. Import its mitigations into that entity.`
          : `No risk "${data.risk}" is recorded in this entity. Import the risks first.`
      };
    }
    const mitigation = {
      riskId,
      ownerId: data.owner ? memberOf(data.owner) : null
    };
    const found = own.get(sourceRef.toLowerCase());
    if (!found) return { action: 'create', recordId: null, mitigation };
    if (found.entityId !== batch.entityId)
      return {
        action: 'refuse',
        reason: `Imported before into ${found.entityName}, on ${found.riskReference}. Import it into that entity.`
      };
    if (found.riskId !== riskId)
      return {
        action: 'refuse',
        reason: `Imported before on ${found.riskReference}. Change it on that risk's page, or give it a new identifier.`
      };
    return { action: 'update', recordId: found.id, mitigation };
  };
}

/** What makes two rows of one file the same record. */
function sameRecordKeys(record: ImportRecord, sourceRef: string) {
  const keys = [`ref:${sourceRef.toLowerCase()}`];
  // A supplier is one record by its identifier there or by its name.
  if (record.kind === 'supplier')
    keys.push(`name:${canonicalise(record.data.name)}`);
  return keys;
}

/**
 * Match columns to fields and work out every row's outcome, writing nothing
 * to the registers. The matching is remembered for this platform and record
 * type, and offered next time.
 */
export async function previewImport(input: {
  organisationId: string;
  batchId: string;
  mapping: ImportMapping;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const batch = await lockedBatch(tx, input.organisationId, input.batchId);
      if (batch.status !== 'uploaded' && batch.status !== 'previewed')
        throw new ImportRefused(`This import has been ${batch.status}.`);
      const defs = FIELDS[batch.recordType];
      const fields = Object.fromEntries(
        Object.entries(input.mapping.fields).filter(
          ([key, column]) =>
            column &&
            defs.some((f) => f.key === key) &&
            batch.columns.includes(column)
        )
      );
      for (const f of defs.filter((d) => d.required))
        if (!fields[f.key])
          throw new ImportRefused(
            `Choose the column that holds ${f.label.toLowerCase()}.`
          );
      // Ratings may share a column: a source that gives one rating ("High")
      // has it read as both likelihood and impact, each translated.
      const used = Object.entries(fields)
        .filter(([key]) => !TRANSLATED.has(key))
        .map(([, column]) => column);
      const twice = used.find((c, i) => used.indexOf(c) !== i);
      if (twice)
        throw new ImportRefused(
          `"${twice}" is matched to two fields. Match each column to one.`
        );
      const values = Object.fromEntries(
        Object.entries(input.mapping.values ?? {})
          .filter(([key]) => TRANSLATED.has(key) && fields[key])
          .map(([key, table]) => [
            key,
            Object.fromEntries(
              Object.entries(table)
                .filter(([, v]) => /^\d$/.test(v))
                .map(([k, v]) => [k.trim().toLowerCase(), v])
            )
          ])
      );
      const mapping: ImportMapping = {
        fields,
        keepUnmapped: input.mapping.keepUnmapped,
        ...(Object.keys(values).length ? { values } : {})
      };

      const table = await readFile(batch.file);
      const decide = await matcher(tx, { ...batch, mapping });
      const seen = new Map<string, number>();
      const rows: Array<typeof importRows.$inferInsert> = [];
      for (const [i, cells] of table.rows.entries()) {
        const rowNumber = i + 2;
        const converted = convertRow(
          batch.recordType,
          mapping,
          rowObject(table, cells)
        );
        if (converted.action === 'skip' || converted.action === 'refuse') {
          rows.push({
            organisationId: input.organisationId,
            batchId: batch.id,
            rowNumber,
            sourceRef:
              converted.action === 'refuse' ? converted.sourceRef : null,
            action: converted.action,
            reason: converted.action === 'refuse' ? converted.reason : null
          });
          continue;
        }
        // Within one file, one row per record: a second would silently win.
        const keys = sameRecordKeys(converted.record, converted.sourceRef);
        const first = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
        if (first !== undefined) {
          rows.push({
            organisationId: input.organisationId,
            batchId: batch.id,
            rowNumber,
            sourceRef: converted.sourceRef,
            action: 'refuse',
            reason: `Row ${first} is the same ${
              batch.recordType === 'supplier' ? 'supplier' : 'record'
            }. Keep one.`
          });
          continue;
        }
        for (const k of keys) seen.set(k, rowNumber);
        const decision = decide(converted.record, converted.sourceRef);
        rows.push({
          organisationId: input.organisationId,
          batchId: batch.id,
          rowNumber,
          sourceRef: converted.sourceRef,
          ...(decision.action === 'refuse'
            ? { action: 'refuse', reason: decision.reason }
            : {
                action: decision.action,
                record: converted.record,
                recordId: decision.recordId
              })
        });
      }

      await tx.delete(importRows).where(eq(importRows.batchId, batch.id));
      for (let i = 0; i < rows.length; i += 500)
        await tx.insert(importRows).values(rows.slice(i, i + 500));
      const counts = tally(rows.map((r) => r.action as Action));
      await tx
        .update(importBatches)
        .set({
          status: 'previewed',
          mapping,
          counts,
          valuesFound: valuesIn(table, batch.recordType, mapping)
        })
        .where(eq(importBatches.id, batch.id));
      await tx
        .insert(importMappings)
        .values({
          organisationId: input.organisationId,
          sourceId: batch.sourceId,
          recordType: batch.recordType,
          mapping
        })
        .onConflictDoUpdate({
          target: [
            importMappings.organisationId,
            importMappings.sourceId,
            importMappings.recordType
          ],
          set: { mapping, updatedAt: new Date() }
        });
      return counts;
    })
  );
}

/** The activity fields an import writes, from a checked record. */
function activityValues(
  data: Of<'processing_activity'>['data'],
  ukLaw: boolean
) {
  const bases = basesFromTextFor(data.lawfulBasis, ukLaw);
  return {
    name: data.name,
    description: data.description ?? null,
    purposes: data.purposes,
    lawfulBasis: data.lawfulBasis ?? null,
    // Always written, so a re-import never leaves the old bases behind text
    // that no longer says them.
    ...(bases
      ? cleanLawfulBases(bases, null, ukLaw)
      : { lawfulBases: [], recognisedCondition: null }),
    dataCategories: data.dataCategories,
    subjectCategories: data.subjectCategories,
    recipients: data.recipients,
    systems: data.systems,
    transfers: data.transfers,
    retention: data.retention ?? null,
    securityMeasures: data.securityMeasures ?? null,
    controllerRole: data.controllerRole ?? null,
    controllerName: data.controllerName ?? null,
    reviewDueAt: data.reviewDueAt ? new Date(data.reviewDueAt) : null
  };
}

const dpaValues = (data: Of<'dpa'>['data']) => ({
  title: data.title,
  documentRef: data.documentRef ?? null,
  signedAt: data.signedAt ? new Date(data.signedAt) : null,
  expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
  transferMechanism: data.transferMechanism ?? null,
  subProcessors: data.subProcessors
});

const evidenceValues = (data: Of<'evidence'>['data']) => ({
  kind: data.kind,
  title: data.title,
  description: data.description ?? null,
  uri: data.uri ?? null,
  collectedAt: data.collectedAt ? new Date(data.collectedAt) : null
});

/** What an AI system is. Who owns it, its stage and its reviews stay as recorded here. */
const aiSystemValues = (data: Of<'ai_use_case'>['data']) => ({
  name: data.name,
  purpose: data.purpose,
  description: data.description ?? null,
  systemType: data.systemType,
  provenance: data.provenance,
  deploymentPattern: data.deploymentPattern ?? null,
  modelName: data.modelName ?? null,
  deployedIn: data.deployedIn,
  processesPersonalData: data.processesPersonalData ?? null,
  dataCategories: data.dataCategories
});

/**
 * The fields a row actually says, for updating a record: a column the file
 * left out, or a cell left empty, keeps what is recorded rather than erasing
 * it. A re-import of a short list to add files must not wipe expiry dates.
 */
const said = <T extends Record<string, unknown>>(values: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(values).filter(
      ([, v]) => v != null && !(Array.isArray(v) && v.length === 0)
    )
  ) as Partial<T>;

/** The fields of a row as JSON, to put back on undo. */
const snapshot = (row: Record<string, unknown>, keys: string[]) =>
  JSON.parse(
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, row[k] ?? null])))
  ) as Record<string, unknown>;

const IMPORT_KEYS = [
  'legacy',
  'importBatchId',
  'importConfirmedAt',
  'updatedAt'
];

const KEYS: Record<RecordType, string[]> = {
  processing_activity: [
    'name',
    'description',
    'purposes',
    'lawfulBasis',
    'lawfulBases',
    'recognisedCondition',
    'dataCategories',
    'subjectCategories',
    'recipients',
    'systems',
    'transfers',
    'retention',
    'securityMeasures',
    'controllerRole',
    'controllerName',
    'reviewDueAt',
    ...IMPORT_KEYS
  ],
  supplier: [
    'description',
    'categories',
    'legacy',
    'importBatchId',
    'reviewedAt',
    'reviewedBy',
    'updatedAt'
  ],
  dpa: [
    'title',
    'documentRef',
    'signedAt',
    'expiresAt',
    'transferMechanism',
    'subProcessors',
    ...IMPORT_KEYS
  ],
  evidence: [
    'kind',
    'title',
    'description',
    'uri',
    'collectedAt',
    'sha256',
    ...IMPORT_KEYS
  ],
  ai_use_case: [
    'name',
    'purpose',
    'description',
    'systemType',
    'provenance',
    'deploymentPattern',
    'vendor',
    'modelName',
    'deployedIn',
    'processesPersonalData',
    'dataCategories',
    'supplierId',
    ...IMPORT_KEYS
  ],
  information_asset: [
    'name',
    'description',
    'assetType',
    'ownerId',
    'hosting',
    'hostedBy',
    'region',
    'countries',
    'classification',
    'retention',
    'nextReviewAt',
    'expiresAt',
    'noticeDays',
    'autoRenews',
    ...IMPORT_KEYS
  ],
  risk: [
    'title',
    'description',
    'category',
    'ownerId',
    'scale',
    'inherentLikelihood',
    'inherentImpact',
    'inherentScore',
    'inherentTier',
    'residualLikelihood',
    'residualImpact',
    'residualScore',
    'residualTier',
    'status',
    'openedAt',
    'closedAt',
    'nextReviewAt',
    'sourceHistory',
    ...IMPORT_KEYS
  ],
  mitigation: [
    'description',
    'controlRef',
    'treatmentType',
    'ownerId',
    'dueAt',
    'status',
    'implementedAt',
    'evidenceRef',
    'sourceHistory',
    ...IMPORT_KEYS
  ]
};

const DATE_KEYS = new Set([
  'reviewDueAt',
  'importConfirmedAt',
  'reviewedAt',
  'updatedAt',
  'signedAt',
  'expiresAt',
  'collectedAt',
  'nextReviewAt',
  'openedAt',
  'closedAt',
  'dueAt',
  'implementedAt'
]);

/** A link an import removed, kept on its row to put back on undo. */
type RemovedLink = {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
};

/** A snapshot read back into column values. */
const restore = (before: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(before)
      .filter(([k]) => k !== 'removedLinks')
      .map(([k, v]) => [
        k,
        DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : v
      ])
  );

const TABLE = {
  processing_activity: processingActivities,
  supplier: suppliers,
  dpa: dpas,
  evidence,
  ai_use_case: aiUseCases,
  information_asset: informationAssets,
  risk: risks,
  mitigation: mitigations
} as const;

/** One previewed row written: the record, and what to undo it with. */
type Written = {
  id: string;
  before: Record<string, unknown> | null;
  documentId?: string | null;
  linkId?: string | null;
  links?: ImportLink[];
};

/** The files and links earlier imports, still standing, made for a record. */
async function earlierImports(c: WriteContext, kind: RecordType, id: string) {
  const rows = await c.tx
    .select({ documentId: importRows.documentId, linkId: importRows.linkId })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.batchId))
    .where(
      and(
        eq(importRows.recordId, id),
        eq(importBatches.organisationId, c.batch.organisationId),
        eq(importBatches.recordType, kind),
        eq(importBatches.status, 'committed')
      )
    );
  return {
    documentIds: rows.flatMap((r) => (r.documentId ? [r.documentId] : [])),
    linkIds: rows.flatMap((r) => (r.linkId ? [r.linkId] : []))
  };
}

type WriteContext = {
  tx: Tx;
  batch: Batch;
  actor: Actor;
  at: Date;
  sourceRef: string;
  decision: Exclude<Decision, { action: 'refuse' }>;
  /** The platform the batch came from, as named here. */
  sourceName: string;
  /** The entity's default regime, for a new processing activity. */
  regime?: (typeof processingActivities.$inferInsert)['regime'] | null;
  /** The entity's data protection law: a new activity takes it, and bases are read under it. */
  law?: (typeof processingActivities.$inferInsert)['laws'] | null;
};

/** The current row of a record, before the import changes it. */
async function rowBefore(c: WriteContext, kind: RecordType, id: string) {
  const table = TABLE[kind];
  const [was] = await c.tx.select().from(table).where(eq(table.id, id));
  return was as Record<string, unknown>;
}

/** Provenance written on every record an import creates or changes. */
const provenance = (c: WriteContext, record: ImportRecord) => ({
  legacy: record.legacy,
  importBatchId: c.batch.id,
  // Changed by the import, so it waits for a person again.
  importConfirmedAt: null,
  updatedAt: c.at
});

/** The file a row names, stored against the record it belongs to. */
async function attachImportFile(
  c: WriteContext,
  name: string | undefined,
  subject: { type: 'dpa' | 'evidence'; id: string },
  /** Files earlier imports attached to this record. */
  earlier: string[] = []
): Promise<{ documentId: string | null; sha256: string | null }> {
  if (!name) return { documentId: null, sha256: null };
  const [file] = await c.tx
    .select()
    .from(importFiles)
    .where(
      and(
        eq(importFiles.batchId, c.batch.id),
        sql`lower(${importFiles.filename}) = lower(${name})`
      )
    );
  if (!file) throw new ImportRefused(`The file "${name}" is no longer here.`);
  // Imported again with the same file: it is attached already.
  const [already] = await c.tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.subjectType, subject.type),
        eq(documents.subjectId, subject.id),
        eq(documents.sha256, file.sha256)
      )
    );
  if (already) return { documentId: null, sha256: file.sha256 };
  // An earlier import's file stays, as the record's history, but is named as
  // replaced so nobody reads the old one as current.
  const replaced = earlier.length
    ? await c.tx
        .select({ filename: documents.filename })
        .from(documents)
        .where(
          and(
            inArray(documents.id, earlier),
            eq(documents.subjectType, subject.type),
            eq(documents.subjectId, subject.id)
          )
        )
    : [];
  const row = await insertDocument(c.tx, {
    organisationId: c.batch.organisationId,
    entityId: subject.type === 'evidence' ? c.batch.entityId : null,
    subjectType: subject.type,
    subjectId: subject.id,
    file: {
      filename: file.filename,
      contentType: file.contentType,
      content: file.content,
      sha256: file.sha256,
      scan:
        file.scannedAt && file.scannerVersion
          ? { scannedAt: file.scannedAt, scannerVersion: file.scannerVersion }
          : null
    },
    description: replaced.length
      ? `Imported, replacing ${replaced.map((d) => d.filename).join(', ')}`
      : 'Imported',
    actor: c.actor
  });
  return { documentId: row.id, sha256: file.sha256 };
}

async function writeActivity(
  c: WriteContext,
  record: Of<'processing_activity'>
): Promise<Written> {
  const values = {
    ...activityValues(record.data, ukLawApplies(c.law)),
    ...provenance(c, record)
  };
  let id: string;
  let was: Record<string, unknown> | null = null;
  if (c.decision.recordId) {
    was = await rowBefore(c, 'processing_activity', c.decision.recordId);
    await c.tx
      .update(processingActivities)
      .set(values)
      .where(eq(processingActivities.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      'ROPA',
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(processingActivities)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        reference,
        regime: c.regime ?? undefined,
        laws: c.law ?? undefined,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...values
      })
      .returning({ id: processingActivities.id });
    id = created.id;
  }
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'processing_activity.updated' : 'processing_activity.created',
    subjectType: 'processing_activity',
    subjectId: id,
    after: {
      name: record.data.name,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return { id, before: was && snapshot(was, KEYS.processing_activity) };
}

async function writeSupplier(
  c: WriteContext,
  record: Of<'supplier'>
): Promise<Written> {
  let id: string;
  let was: Record<string, unknown> | null = null;
  if (c.decision.recordId) {
    was = await rowBefore(c, 'supplier', c.decision.recordId);
    await c.tx
      .update(suppliers)
      .set({
        // Added to, as a push adds to it: what is already known stays.
        description:
          (was.description as string | null) ?? record.data.description ?? null,
        categories: [
          ...new Set([
            ...((was.categories as string[]) ?? []),
            ...record.data.categories
          ])
        ],
        legacy: {
          ...((was.legacy as Record<string, string> | null) ?? {}),
          ...record.legacy
        },
        // Where it came from stays as it was: added to by an import, a
        // supplier a person typed in is not thereby imported.
        importBatchId: c.batch.id,
        updatedAt: c.at
      })
      .where(eq(suppliers.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const [created] = await c.tx
      .insert(suppliers)
      .values({
        organisationId: c.batch.organisationId,
        name: record.data.name,
        canonicalKey: canonicalise(record.data.name),
        description: record.data.description,
        categories: record.data.categories,
        importSourceId: c.batch.sourceId,
        importBatchId: c.batch.id,
        externalRef: c.sourceRef,
        legacy: record.legacy,
        // Not confirmed: it came from another platform's list.
        reviewedAt: null,
        createdAt: c.at,
        updatedAt: c.at
      })
      .returning({ id: suppliers.id });
    id = created.id;
  }
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    action: was ? 'supplier.updated' : 'supplier.created',
    subjectType: 'supplier',
    subjectId: id,
    after: {
      name: record.data.name,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return { id, before: was && snapshot(was, KEYS.supplier) };
}

async function writeDpa(c: WriteContext, record: Of<'dpa'>): Promise<Written> {
  const values = { ...dpaValues(record.data), ...provenance(c, record) };
  let id: string;
  let was: Record<string, unknown> | null = null;
  if (c.decision.recordId) {
    was = await rowBefore(c, 'dpa', c.decision.recordId);
    await c.tx
      .update(dpas)
      .set({ ...said(dpaValues(record.data)), ...provenance(c, record) })
      .where(eq(dpas.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const [created] = await c.tx
      .insert(dpas)
      .values({
        organisationId: c.batch.organisationId,
        supplierId: c.decision.supplierId!,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...values
      })
      .returning({ id: dpas.id });
    id = created.id;
  }
  const earlier = was ? await earlierImports(c, 'dpa', id) : null;
  const { documentId } = await attachImportFile(
    c,
    record.data.file,
    { type: 'dpa', id },
    earlier?.documentIds
  );
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    action: was ? 'dpa.updated' : 'dpa.recorded',
    subjectType: 'dpa',
    subjectId: id,
    after: {
      supplier: record.data.supplier,
      title: record.data.title,
      expiresAt: record.data.expiresAt ?? null,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return { id, before: was && snapshot(was, KEYS.dpa), documentId };
}

async function writeEvidence(
  c: WriteContext,
  record: Of<'evidence'>
): Promise<Written> {
  const values = { ...evidenceValues(record.data), ...provenance(c, record) };
  let id: string;
  let was: Record<string, unknown> | null = null;
  if (c.decision.recordId) {
    was = await rowBefore(c, 'evidence', c.decision.recordId);
    await c.tx
      .update(evidence)
      .set({ ...said(evidenceValues(record.data)), ...provenance(c, record) })
      .where(eq(evidence.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const [created] = await c.tx
      .insert(evidence)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...values
      })
      .returning({ id: evidence.id });
    id = created.id;
  }
  const earlier = was ? await earlierImports(c, 'evidence', id) : null;
  const { documentId, sha256 } = await attachImportFile(
    c,
    record.data.file,
    { type: 'evidence', id },
    earlier?.documentIds
  );
  if (sha256)
    await c.tx.update(evidence).set({ sha256 }).where(eq(evidence.id, id));
  // What it supports is what the platform now says: a link an earlier import
  // made to anything else goes, kept on the row to put back on undo. Links a
  // person made here stay.
  const target = c.decision.attach;
  const removedLinks: RemovedLink[] = earlier?.linkIds.length
    ? await c.tx
        .delete(recordLinks)
        .where(
          and(
            inArray(recordLinks.id, earlier.linkIds),
            eq(recordLinks.fromType, 'evidence'),
            eq(recordLinks.fromId, id),
            target
              ? sql`not (${recordLinks.toType} = ${target.type} and ${recordLinks.toId} = ${target.id})`
              : undefined
          )
        )
        .returning({
          fromType: recordLinks.fromType,
          fromId: recordLinks.fromId,
          toType: recordLinks.toType,
          toId: recordLinks.toId,
          relation: recordLinks.relation
        })
    : [];
  let linkId: string | null = null;
  if (c.decision.attach) {
    const [link] = await c.tx
      .insert(recordLinks)
      .values({
        organisationId: c.batch.organisationId,
        fromType: 'evidence',
        fromId: id,
        toType: c.decision.attach.type,
        toId: c.decision.attach.id,
        relation: 'supports'
      })
      .onConflictDoNothing()
      .returning({ id: recordLinks.id });
    linkId = link?.id ?? null;
  }
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'evidence.updated' : 'evidence.received',
    subjectType: 'evidence',
    subjectId: id,
    after: {
      title: record.data.title,
      kind: record.data.kind,
      attachedTo: record.data.attachTo ?? null,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return {
    id,
    before: was && {
      ...snapshot(was, KEYS.evidence),
      ...(removedLinks.length ? { removedLinks } : {})
    },
    documentId,
    linkId
  };
}

async function writeUseCase(
  c: WriteContext,
  record: Of<'ai_use_case'>
): Promise<Written> {
  const described = aiSystemValues(record.data);
  const vendor =
    record.data.vendor ??
    (c.decision.supplierId ? null : (record.data.supplierName ?? null));
  if (c.decision.recordId) {
    const was = await rowBefore(c, 'ai_use_case', c.decision.recordId);
    await c.tx
      .update(aiUseCases)
      .set({
        ...said(described),
        // A vendor or link somebody recorded here is kept; the import only
        // fills an empty one.
        vendor: (was.vendor as string | null) ?? vendor,
        supplierId:
          (was.supplierId as string | null) ?? c.decision.supplierId ?? null,
        ...provenance(c, record)
      })
      .where(eq(aiUseCases.id, c.decision.recordId));
    await appendAuditEvent(c.tx, {
      ...c.actor,
      organisationId: c.batch.organisationId,
      entityId: c.batch.entityId ?? undefined,
      action: 'ai_use_case.updated',
      subjectType: 'ai_use_case',
      subjectId: c.decision.recordId,
      before: { name: was.name, purpose: was.purpose },
      after: {
        name: record.data.name,
        purpose: record.data.purpose,
        imported: { batch: c.batch.id, ref: c.sourceRef }
      }
    });
    return {
      id: c.decision.recordId,
      before: snapshot(was, KEYS.ai_use_case)
    };
  }
  // Registered as any system is, so its stage history and audit start here.
  const created = await createUseCase(
    {
      organisationId: c.batch.organisationId,
      entityId: c.batch.entityId!,
      name: record.data.name,
      purpose: record.data.purpose,
      description: record.data.description,
      systemType: record.data.systemType,
      provenance: record.data.provenance,
      deploymentPattern: record.data.deploymentPattern ?? null,
      lifecycleStage: record.data.lifecycleStage ?? 'proposed',
      vendor: vendor ?? undefined,
      modelName: record.data.modelName,
      deployedIn: record.data.deployedIn,
      processesPersonalData: record.data.processesPersonalData,
      dataCategories: record.data.dataCategories,
      supplierId: c.decision.supplierId ?? null,
      actor: c.actor
    },
    c.tx
  );
  await c.tx
    .update(aiUseCases)
    .set({
      importSourceId: c.batch.sourceId,
      externalRef: c.sourceRef,
      ...provenance(c, record)
    })
    .where(eq(aiUseCases.id, created.id));
  return { id: created.id, before: null };
}

function write(c: WriteContext, record: ImportRecord): Promise<Written> {
  switch (record.kind) {
    case 'processing_activity':
      return writeActivity(c, record);
    case 'supplier':
      return writeSupplier(c, record);
    case 'dpa':
      return writeDpa(c, record);
    case 'evidence':
      return writeEvidence(c, record);
    case 'ai_use_case':
      return writeUseCase(c, record);
    case 'information_asset':
      return writeAsset(c, record);
    case 'risk':
      return writeRisk(c, record);
    case 'mitigation':
      return writeMitigation(c, record);
  }
}

/** What an asset is, from a checked row read into this organisation's terms. */
function assetValues(data: Of<'information_asset'>['data'], a: AssetResolved) {
  return {
    name: data.name,
    description: data.description ?? null,
    assetType: a.assetType,
    hosting: data.hosting ?? null,
    hostedBy: data.hostedBy ?? null,
    region: data.region ?? null,
    countries: [...new Set(data.countries)],
    classification: a.classification,
    retention: data.retention ?? null,
    nextReviewAt: data.nextReviewAt ? new Date(data.nextReviewAt) : null,
    // Only a type that expires carries the dates, as when typed in.
    expiresAt: a.hasExpiry && data.expiresAt ? new Date(data.expiresAt) : null,
    noticeDays: a.hasExpiry ? (data.noticeDays ?? null) : null
  };
}

const ASSET_LINK = {
  asset_activity: {
    table: informationAssetActivities,
    target: informationAssetActivities.activityId,
    key: 'activityId'
  },
  asset_supplier: {
    table: informationAssetSuppliers,
    target: informationAssetSuppliers.supplierId,
    key: 'supplierId'
  },
  asset_risk: {
    table: informationAssetRisks,
    target: informationAssetRisks.riskId,
    key: 'riskId'
  }
} as const;

async function writeAsset(
  c: WriteContext,
  record: Of<'information_asset'>
): Promise<Written> {
  const resolved = c.decision.asset!;
  const described = assetValues(record.data, resolved);
  // An owner nobody here matches stays empty, as a gap, and the name stays
  // with the asset to read; one chosen here is a person's call to change.
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const autoRenews =
    resolved.hasExpiry && record.data.autoRenews !== undefined
      ? { autoRenews: record.data.autoRenews }
      : {};
  const legacy =
    record.data.owner && !resolved.ownerId
      ? { ...record.legacy, Owner: record.data.owner }
      : record.legacy;
  const kept = provenance(c, { ...record, legacy });
  let id: string;
  let was: Record<string, unknown> | null = null;
  if (c.decision.recordId) {
    was = await rowBefore(c, 'information_asset', c.decision.recordId);
    // A type that does not expire carries no renewal dates, so a change of
    // type leaves none behind to raise reminders, as when edited here.
    const noExpiry = resolved.hasExpiry
      ? {}
      : { expiresAt: null, noticeDays: null, autoRenews: false };
    await c.tx
      .update(informationAssets)
      .set({
        ...said(described),
        ...noExpiry,
        ...owner,
        ...autoRenews,
        ...kept
      })
      .where(eq(informationAssets.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      'IA',
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(informationAssets)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        reference,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...described,
        ...owner,
        ...autoRenews,
        ...kept
      })
      .returning({ id: informationAssets.id });
    id = created.id;
  }
  // Links are added, never taken away: one a person removed here and the
  // platform still names comes back, but one a person made is never undone
  // by a file.
  const links: ImportLink[] = [];
  const wanted = [
    ...resolved.activityIds.map((to) => ['asset_activity', to] as const),
    ...resolved.supplierIds.map((to) => ['asset_supplier', to] as const)
  ];
  for (const [kind, to] of wanted) {
    const { table, key } = ASSET_LINK[kind];
    const made = await c.tx
      .insert(table)
      .values({
        organisationId: c.batch.organisationId,
        assetId: id,
        [key]: to
      } as typeof table.$inferInsert)
      .onConflictDoNothing()
      .returning();
    if (made.length) links.push({ kind, from: id, to });
  }
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'information_asset.updated' : 'information_asset.created',
    subjectType: 'information_asset',
    subjectId: id,
    after: {
      name: record.data.name,
      assetType: resolved.assetType,
      linked: links.length,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return {
    id,
    before: was && snapshot(was, KEYS.information_asset),
    links
  };
}

/** Remove the links an import made, and only those. */
async function removeLinks(tx: Tx, links: ImportLink[]) {
  for (const link of links) {
    if (link.kind === 'record_link') {
      await tx.delete(recordLinks).where(eq(recordLinks.id, link.id));
      continue;
    }
    const { table, target } = ASSET_LINK[link.kind];
    await tx
      .delete(table)
      .where(and(eq(table.assetId, link.from), eq(target, link.to)));
  }
}

const day = (iso: string | undefined) => iso?.slice(0, 10);

/**
 * What the old platform recorded about a risk that was not done here: an
 * acceptance above all. Kept as that platform's account, so the risk waits
 * to be accepted again here rather than being treated as accepted.
 */
type RiskStatus = (typeof risks.$inferSelect)['status'];

/**
 * The status a risk takes from a row. Accepted there is not accepted here:
 * a new risk waits for somebody here to take responsibility for it (decision
 * 2 of the migration plan). On a re-import, a file that does not say, or says
 * accepted, leaves the status as recorded, and an acceptance given here
 * stands whatever the file says: that was a person's decision here.
 */
function statusFor(
  given: Of<'risk'>['data']['status'],
  current: RiskStatus | undefined
): RiskStatus {
  if (current === 'accepted') return current;
  if (!given || given === 'accepted') return current ?? 'identified';
  return given;
}

function riskHistory(
  data: Of<'risk'>['data'],
  source: string
): SourceEvent[] | null {
  const accepted =
    data.status === 'accepted' ||
    data.acceptedBy ||
    data.acceptedAt ||
    data.acceptanceRationale;
  if (!accepted) return null;
  const until = day(data.acceptanceExpiresAt);
  return [
    {
      at: data.acceptedAt ?? null,
      what: `Accepted in ${source}`,
      ...(data.acceptedBy ? { by: data.acceptedBy } : {}),
      ...(data.acceptanceRationale || until
        ? {
            detail: [
              data.acceptanceRationale,
              until ? `Accepted until ${until}.` : null
            ]
              .filter(Boolean)
              .join(' ')
          }
        : {})
    }
  ];
}

async function writeRisk(
  c: WriteContext,
  record: Of<'risk'>
): Promise<Written> {
  const resolved = c.decision.risk!;
  const { data } = record;
  const inherent = rate(
    resolved.inherent.likelihood,
    resolved.inherent.impact,
    resolved.scale
  );
  const residual = resolved.residual
    ? rate(
        resolved.residual.likelihood,
        resolved.residual.impact,
        resolved.scale
      )
    : null;
  // The scale can change only while the register is empty, so a risk
  // imported before is on the scale read now.
  const was = c.decision.recordId
    ? await rowBefore(c, 'risk', c.decision.recordId)
    : null;
  const described = {
    title: data.title,
    description: data.description,
    category: resolved.category,
    scale: resolved.scale,
    inherentLikelihood: resolved.inherent.likelihood,
    inherentImpact: resolved.inherent.impact,
    inherentScore: inherent.score,
    inherentTier: inherent.tier,
    residualLikelihood: resolved.residual?.likelihood ?? null,
    residualImpact: resolved.residual?.impact ?? null,
    residualScore: residual?.score ?? null,
    residualTier: residual?.tier ?? null,
    status: statusFor(data.status, was?.status as RiskStatus | undefined),
    closedAt: data.closedAt ? new Date(data.closedAt) : null,
    nextReviewAt: data.nextReviewAt ? new Date(data.nextReviewAt) : null,
    sourceHistory: riskHistory(data, c.sourceName)
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  // A rating read through a translation keeps what the source said, so the
  // translation can be checked against it.
  const asWritten = (
    [
      [
        'Likelihood as rated there',
        data.inherentLikelihood,
        resolved.inherent.likelihood
      ],
      ['Impact as rated there', data.inherentImpact, resolved.inherent.impact],
      [
        'Residual likelihood as rated there',
        data.residualLikelihood,
        resolved.residual?.likelihood
      ],
      [
        'Residual impact as rated there',
        data.residualImpact,
        resolved.residual?.impact
      ]
    ] as const
  ).filter(([, given, read]) => given && given.trim() !== String(read));
  const legacy = {
    ...record.legacy,
    ...Object.fromEntries(asWritten.map(([label, given]) => [label, given!])),
    ...(data.owner && !resolved.ownerId ? { Owner: data.owner } : {}),
    ...(data.status === 'accepted' ? { Status: 'Accepted' } : {})
  };
  const kept = provenance(c, { ...record, legacy });
  let id: string;
  if (c.decision.recordId) {
    // What the file leaves out stays as recorded, its history included.
    await c.tx
      .update(risks)
      .set({ ...said(described), ...owner, ...kept })
      .where(eq(risks.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      'RISK',
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(risks)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        reference,
        source: 'integration',
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        openedAt: data.openedAt ? new Date(data.openedAt) : c.at,
        createdAt: c.at,
        ...described,
        ...owner,
        ...kept
      })
      .returning({ id: risks.id });
    id = created.id;
  }
  // Links are added, never taken away, as for assets.
  const links: ImportLink[] = [];
  for (const target of resolved.concerns) {
    const [made] = await c.tx
      .insert(recordLinks)
      .values({
        organisationId: c.batch.organisationId,
        fromType: 'risk',
        fromId: id,
        toType: target.type,
        toId: target.id,
        relation: 'concerns'
      })
      .onConflictDoNothing()
      .returning({ id: recordLinks.id });
    if (made) links.push({ kind: 'record_link', id: made.id });
  }
  for (const assetId of resolved.assetIds) {
    const made = await c.tx
      .insert(informationAssetRisks)
      .values({ organisationId: c.batch.organisationId, assetId, riskId: id })
      .onConflictDoNothing()
      .returning();
    if (made.length) links.push({ kind: 'asset_risk', from: assetId, to: id });
  }
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'risk.updated' : 'risk.created',
    subjectType: 'risk',
    subjectId: id,
    after: {
      title: data.title,
      inherentTier: inherent.tier,
      residualTier: residual?.tier ?? null,
      linked: links.length,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return { id, before: was && snapshot(was, KEYS.risk), links };
}

type MitigationStatus = (typeof mitigations.$inferSelect)['status'];

/**
 * The status a mitigation takes from a row. Verified there is implemented
 * here: verification is a second member's act here, so it waits for one. A
 * verification given here stands whatever a re-import says, and a file that
 * does not say leaves the status as recorded.
 */
function mitigationStatusFor(
  given: Of<'mitigation'>['data']['status'],
  current: MitigationStatus | undefined
): MitigationStatus {
  if (current === 'verified') return current;
  if (!given) return current ?? 'planned';
  return given === 'verified' ? 'implemented' : given;
}

function mitigationHistory(
  data: Of<'mitigation'>['data'],
  source: string
): SourceEvent[] | null {
  if (data.status !== 'verified' && !data.verifiedBy && !data.verifiedAt)
    return null;
  return [
    {
      at: data.verifiedAt ?? null,
      what: `Verified in ${source}`,
      ...(data.verifiedBy ? { by: data.verifiedBy } : {})
    }
  ];
}

async function writeMitigation(
  c: WriteContext,
  record: Of<'mitigation'>
): Promise<Written> {
  const resolved = c.decision.mitigation!;
  const { data } = record;
  const was = c.decision.recordId
    ? await rowBefore(c, 'mitigation', c.decision.recordId)
    : null;
  const described = {
    description: data.description,
    controlRef: data.controlRef ?? null,
    // Accepting is not a treatment here; the row keeps what the source said.
    treatmentType:
      data.treatmentType === 'acceptance' ? null : (data.treatmentType ?? null),
    dueAt: data.dueAt ? new Date(data.dueAt) : null,
    status: mitigationStatusFor(
      data.status,
      was?.status as MitigationStatus | undefined
    ),
    implementedAt: data.implementedAt ? new Date(data.implementedAt) : null,
    evidenceRef: data.evidenceRef ?? null,
    sourceHistory: mitigationHistory(data, c.sourceName)
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const kept = provenance(c, {
    ...record,
    legacy: {
      ...record.legacy,
      ...(data.owner && !resolved.ownerId ? { Owner: data.owner } : {}),
      ...(data.status === 'verified' ? { Status: 'Verified' } : {}),
      ...(data.treatmentType === 'acceptance' ? { Treatment: 'Accept' } : {})
    }
  });
  let id: string;
  if (c.decision.recordId) {
    // What the file leaves out stays as recorded, its history included.
    await c.tx
      .update(mitigations)
      .set({ ...said(described), ...owner, ...kept })
      .where(eq(mitigations.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const [created] = await c.tx
      .insert(mitigations)
      .values({
        riskId: resolved.riskId,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...described,
        ...owner,
        ...kept
      })
      .returning({ id: mitigations.id });
    id = created.id;
  }
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'mitigation.updated' : 'mitigation.added',
    subjectType: 'mitigation',
    subjectId: id,
    after: {
      riskId: resolved.riskId,
      description: data.description,
      status: described.status,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return { id, before: was && snapshot(was, KEYS.mitigation) };
}

/**
 * Import what was previewed, as one step: every row's record, or none. Each
 * row is decided again first, so a record created or removed since the
 * preview is not written over or duplicated.
 */
export async function commitImport(input: {
  organisationId: string;
  batchId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const batch = await lockedBatch(tx, input.organisationId, input.batchId);
      if (batch.status !== 'previewed')
        throw new ImportRefused(
          batch.status === 'uploaded'
            ? 'Preview it first, so you can see what each row will do.'
            : `This import has been ${batch.status}.`
        );
      const rows = await tx
        .select()
        .from(importRows)
        .where(eq(importRows.batchId, batch.id))
        .orderBy(importRows.rowNumber);
      const [entity] = batch.entityId
        ? await tx
            .select({
              defaultRegime: entities.defaultRegime,
              dataProtectionLaw: entities.dataProtectionLaw
            })
            .from(entities)
            .where(eq(entities.id, batch.entityId))
        : [];
      const at = new Date();
      const actions: Action[] = [];
      const decide = await matcher(tx, batch);
      const [source] = await tx
        .select({ name: importSources.name })
        .from(importSources)
        .where(eq(importSources.id, batch.sourceId));

      for (const row of rows) {
        if (!row.record || !row.sourceRef) {
          actions.push(row.action);
          continue;
        }
        const decision = decide(row.record, row.sourceRef);
        if (decision.action === 'refuse') {
          // Changed since the preview: say so on the row, write nothing.
          actions.push('refuse');
          await tx
            .update(importRows)
            .set({ action: 'refuse', reason: decision.reason, recordId: null })
            .where(eq(importRows.id, row.id));
          continue;
        }
        const written = await write(
          {
            tx,
            batch,
            actor: input.actor,
            at,
            sourceRef: row.sourceRef,
            decision,
            sourceName: source.name,
            regime: entity?.defaultRegime,
            law: entity?.dataProtectionLaw
          },
          row.record
        );
        actions.push(decision.action);
        await tx
          .update(importRows)
          .set({
            action: decision.action,
            recordId: written.id,
            before: written.before,
            documentId: written.documentId ?? null,
            linkId: written.linkId ?? null,
            links: written.links?.length ? written.links : null
          })
          .where(eq(importRows.id, row.id));
      }

      // Each file now lives on the record it was attached to. The copy kept
      // for the import goes, so nothing is stored twice or left behind once a
      // record's file is removed; undo removes the attached copies.
      await tx.delete(importFiles).where(eq(importFiles.batchId, batch.id));

      const counts = tally(actions);
      await tx
        .update(importBatches)
        .set({
          status: 'committed',
          counts,
          committedAt: at,
          committedByLabel: input.actor.actorLabel
        })
        .where(eq(importBatches.id, batch.id));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: batch.entityId ?? undefined,
        action: 'import.committed',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        after: { batch: batch.id, recordType: batch.recordType, counts }
      });
      return counts;
    })
  );
}

/** Other records pointing at these, by foreign key or by subject. */
async function referencesTo(
  tx: Tx,
  table: RecordType,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const keys = (await tx.execute(sql`
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = ${table}::regclass
  `)) as unknown as Array<{ tbl: string; col: string }>;
  let n = 0;
  for (const { tbl, col } of keys) {
    const [row] = (await tx.execute(
      sql`select count(*)::int as n from ${sql.identifier(tbl)} where ${sql.identifier(col)} in ${ids}`
    )) as unknown as Array<{ n: number }>;
    n += row.n;
  }
  const [a] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(assessments)
    .where(
      and(
        eq(assessments.subjectType, table),
        inArray(assessments.subjectId, ids)
      )
    );
  const [d] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(eq(documents.subjectType, table), inArray(documents.subjectId, ids))
    );
  const [l] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(recordLinks)
    .where(
      sql`(${recordLinks.fromType} = ${table} and ${recordLinks.fromId} in ${ids}) or (${recordLinks.toType} = ${table} and ${recordLinks.toId} in ${ids})`
    );
  return n + a.n + d.n + l.n;
}

/**
 * Take an import back out: remove the records it created, with the files and
 * links it made, and put back what it changed. Only while nobody has worked
 * on any of them since; after that, they are changed one by one like any
 * other record.
 */
export async function undoImport(input: {
  organisationId: string;
  batchId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const batch = await lockedBatch(tx, input.organisationId, input.batchId);
      if (batch.status !== 'committed' || !batch.committedAt)
        throw new ImportRefused(
          'Only an import that has been made can be undone.'
        );
      const rows = (
        await tx
          .select()
          .from(importRows)
          .where(eq(importRows.batchId, batch.id))
          // Last first, so each record ends as it was before its first row.
          .orderBy(desc(importRows.rowNumber))
      ).filter((r) => r.recordId);
      const kind = batch.recordType;
      const table = TABLE[kind];
      const ids = rows.map((r) => r.recordId!);
      const current = ids.length
        ? await tx
            .select({ id: table.id, updatedAt: table.updatedAt })
            .from(table)
            .where(inArray(table.id, ids))
        : [];
      const touched = current.filter(
        (r) => r.updatedAt.getTime() > batch.committedAt!.getTime()
      );
      if (touched.length > 0)
        throw new ImportRefused(
          `${touched.length} of its records ${touched.length === 1 ? 'has' : 'have'} been changed since it was imported, so it can no longer be undone as a whole. Change or remove them one by one.`
        );

      // What the import itself made goes first, so it does not count as
      // somebody else's work on the records.
      const madeDocs = rows.flatMap((r) =>
        r.documentId ? [r.documentId] : []
      );
      if (madeDocs.length)
        await tx.delete(documents).where(inArray(documents.id, madeDocs));
      const madeLinks = rows.flatMap((r) => (r.linkId ? [r.linkId] : []));
      if (madeLinks.length)
        await tx.delete(recordLinks).where(inArray(recordLinks.id, madeLinks));
      await removeLinks(
        tx,
        rows.flatMap((r) => r.links ?? [])
      );
      const created = rows
        .filter((r) => r.action === 'create')
        .map((r) => r.recordId!);
      // The AI register keeps every system's stage history for good, so a
      // system once registered is retired, never removed.
      if (kind === 'ai_use_case' && created.length)
        throw new ImportRefused(
          `It registered ${created.length} AI system${created.length === 1 ? '' : 's'}. The AI register keeps every system's history, so ${created.length === 1 ? 'it' : 'they'} cannot be taken back out; retire any registered in error from ${created.length === 1 ? 'its' : 'their'} page.`
        );
      const linked = await referencesTo(tx, kind, created);
      if (linked > 0)
        throw new ImportRefused(
          'Some of the records it created are now linked to other records, such as an assessment, an agreement or a file, so it can no longer be undone as a whole.'
        );

      for (const row of rows) {
        const id = row.recordId!;
        if (row.action === 'create') {
          const [gone] = await tx
            .delete(table)
            .where(eq(table.id, id))
            .returning({ id: table.id });
          if (!gone) continue;
          await appendAuditEvent(tx, {
            ...input.actor,
            organisationId: input.organisationId,
            entityId: batch.entityId ?? undefined,
            action: `${kind}.deleted`,
            subjectType: kind,
            subjectId: id,
            before: { importedRef: row.sourceRef },
            after: { undoneImport: batch.id }
          });
        } else if (row.before) {
          const [back] = await tx
            .update(table)
            .set(restore(row.before))
            .where(eq(table.id, id))
            .returning({ id: table.id });
          if (!back) continue;
          const removedLinks = row.before.removedLinks as
            RemovedLink[] | undefined;
          if (removedLinks?.length)
            await tx
              .insert(recordLinks)
              .values(
                removedLinks.map((l) => ({
                  organisationId: input.organisationId,
                  ...l
                })) as Array<typeof recordLinks.$inferInsert>
              )
              .onConflictDoNothing();
          await appendAuditEvent(tx, {
            ...input.actor,
            organisationId: input.organisationId,
            entityId: batch.entityId ?? undefined,
            action: `${kind}.updated`,
            subjectType: kind,
            subjectId: id,
            after: { importedRef: row.sourceRef, undoneImport: batch.id }
          });
        }
      }
      await tx
        .update(importBatches)
        .set({
          status: 'undone',
          undoneAt: new Date(),
          undoneByLabel: input.actor.actorLabel
        })
        .where(eq(importBatches.id, batch.id));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: batch.entityId ?? undefined,
        action: 'import.undone',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        after: {
          batch: batch.id,
          removed: created.length,
          restored: rows.length - created.length
        }
      });
      return {
        removed: created.length,
        restored: rows.length - created.length
      };
    })
  );
}

/** Kinds of imported record a person confirms here. Suppliers use their own review. */
export type Confirmable =
  | 'processing_activity'
  | 'dpa'
  | 'evidence'
  | 'ai_use_case'
  | 'information_asset'
  | 'risk'
  | 'mitigation';

/**
 * A mitigation has no organisation of its own: it is its risk's. Confirmed
 * on its own where it came in on a risk already confirmed.
 */
async function confirmMitigation(
  tx: Tx,
  input: { organisationId: string; id: string; actor: Actor },
  at: Date
) {
  const [row] = await tx
    .update(mitigations)
    .set({ importConfirmedAt: at, updatedAt: at })
    .where(
      and(
        eq(mitigations.id, input.id),
        sql`${mitigations.importBatchId} is not null`,
        sql`${mitigations.importConfirmedAt} is null`,
        inArray(
          mitigations.riskId,
          tx
            .select({ id: risks.id })
            .from(risks)
            .where(eq(risks.organisationId, input.organisationId))
        )
      )
    )
    .returning();
  if (!row)
    throw new ImportRefused('That record is not waiting to be confirmed.');
  const [risk] = await tx
    .select({ entityId: risks.entityId })
    .from(risks)
    .where(eq(risks.id, row.riskId));
  await appendAuditEvent(tx, {
    ...input.actor,
    organisationId: input.organisationId,
    entityId: risk.entityId,
    action: 'mitigation.import_confirmed',
    subjectType: 'mitigation',
    subjectId: input.id,
    after: { riskId: row.riskId, description: row.description }
  });
  return row as Record<string, unknown>;
}

/** A person confirms an imported record, which then counts as current. */
export async function confirmImportedRecord(input: {
  organisationId: string;
  type: Confirmable;
  id: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const at = new Date();
      if (input.type === 'mitigation') return confirmMitigation(tx, input, at);
      const table = TABLE[input.type];
      const [row] = (await tx
        .update(table)
        .set({ importConfirmedAt: at, updatedAt: at })
        .where(
          and(
            eq(table.id, input.id),
            eq(table.organisationId, input.organisationId),
            sql`${table.importBatchId} is not null`,
            sql`${table.importConfirmedAt} is null`
          )
        )
        .returning()) as Array<Record<string, unknown>>;
      if (!row)
        throw new ImportRefused('That record is not waiting to be confirmed.');
      // A risk is checked with what is being done about it, shown on its
      // page: its imported mitigations are confirmed with it.
      const withIt =
        input.type === 'risk'
          ? await tx
              .update(mitigations)
              .set({ importConfirmedAt: at, updatedAt: at })
              .where(
                and(
                  eq(mitigations.riskId, input.id),
                  sql`${mitigations.importBatchId} is not null`,
                  sql`${mitigations.importConfirmedAt} is null`
                )
              )
              .returning({
                id: mitigations.id,
                description: mitigations.description
              })
          : [];
      // Each its own event, so a mitigation's history says who confirmed it.
      for (const m of withIt)
        await appendAuditEvent(tx, {
          ...input.actor,
          organisationId: input.organisationId,
          entityId: row.entityId as string,
          action: 'mitigation.import_confirmed',
          subjectType: 'mitigation',
          subjectId: m.id,
          after: {
            riskId: input.id,
            description: m.description,
            withRisk: true
          }
        });
      const mitigationsConfirmed = withIt.length;
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: (row.entityId as string | undefined) ?? undefined,
        action: `${input.type}.import_confirmed`,
        subjectType: input.type,
        subjectId: input.id,
        after: {
          reference: row.reference ?? null,
          name: row.name ?? row.title ?? null,
          ...(mitigationsConfirmed ? { mitigationsConfirmed } : {})
        }
      });
      return row;
    })
  );
}

/** The name of the platform a record was imported from. */
export async function importSourceName(
  organisationId: string,
  sourceId: string
): Promise<string | null> {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select({ name: importSources.name })
      .from(importSources)
      .where(
        and(
          eq(importSources.id, sourceId),
          eq(importSources.organisationId, organisationId)
        )
      );
    return row?.name ?? null;
  });
}

/** The names of several platforms records were imported from, by id. */
export async function importSourceNames(
  organisationId: string,
  sourceIds: string[]
): Promise<Map<string, string>> {
  if (sourceIds.length === 0) return new Map();
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({ id: importSources.id, name: importSources.name })
      .from(importSources)
      .where(
        and(
          inArray(importSources.id, sourceIds),
          eq(importSources.organisationId, organisationId)
        )
      );
    return new Map(rows.map((r) => [r.id, r.name]));
  });
}

/** An import's agreements that came with a file and have not been read yet. */
export async function agreementsToRead(
  organisationId: string,
  batchId: string
): Promise<string[]> {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({ dpaId: importRows.recordId })
      .from(importRows)
      .innerJoin(importBatches, eq(importBatches.id, importRows.batchId))
      .where(
        and(
          eq(importRows.batchId, batchId),
          eq(importBatches.organisationId, organisationId),
          eq(importBatches.recordType, 'dpa'),
          eq(importBatches.status, 'committed'),
          sql`${importRows.documentId} is not null`
        )
      );
    const ids = [...new Set(rows.map((r) => r.dpaId!))];
    if (ids.length === 0) return [];
    // Read means read: a run that failed leaves it to read again.
    const read = new Set(
      (
        await db
          .selectDistinct({ id: extractions.subjectId })
          .from(extractions)
          .where(
            and(
              eq(extractions.organisationId, organisationId),
              eq(extractions.subjectType, 'dpa'),
              inArray(extractions.subjectId, ids),
              isNull(extractions.failure)
            )
          )
      ).map((r) => r.id)
    );
    return ids.filter((id) => !read.has(id));
  });
}

/**
 * Read the files of an import's agreements, a few at a time, so each one's
 * facts are proposed for review on its supplier's page as for any agreement.
 * Nothing read is written to an agreement until a person accepts it.
 */
export async function readImportedAgreements(input: {
  organisationId: string;
  batchId: string;
  actor: Actor;
  limit?: number;
}) {
  const unread = await agreementsToRead(input.organisationId, input.batchId);
  const now = unread.slice(0, input.limit ?? 3);
  const failed: Array<{ dpaId: string; reason: string }> = [];
  for (const [i, dpaId] of now.entries()) {
    try {
      const result = await runExtraction({
        organisationId: input.organisationId,
        entityId: null,
        dpaId,
        actor: input.actor
      });
      if (result.failure) failed.push({ dpaId, reason: result.failure });
    } catch (error) {
      if (!(error instanceof ExtractionUnavailable)) throw error;
      // Not set up, or switched off: say so rather than failing each one.
      if (i === 0) throw new ImportRefused(error.message);
      failed.push({ dpaId, reason: error.message });
    }
  }
  return {
    read: now.length - failed.length,
    failed,
    remaining: unread.length - now.length
  };
}
