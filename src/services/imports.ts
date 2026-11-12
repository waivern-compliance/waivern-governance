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
  processingActivities,
  recordLinks,
  risks,
  suppliers
} from '@/db/schema';
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
import type { ImportMapping, ImportRecord } from '@/lib/import/types';

import { createUseCase } from './ai-register';
import { checkFile, insertDocument, UploadRefused } from './documents';
import { ExtractionUnavailable, runExtraction } from './extraction';
import { canonicalise as canonicaliseByPush, nextReference } from './ingest';
import { cleanLawfulBases } from './ropa';
import type { Actor } from './templates';
import { canonicalise } from './third-party';

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
          // An agreement is opened on its supplier's page.
          supplierId: dpas.supplierId
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
          keepUnmapped: offered.keepUnmapped
        }
      : guessMapping(batch.recordType, batch.columns);
    return { batch, rows, mapping, files };
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

type Decision =
  | {
      action: 'create';
      recordId: null;
      /** The supplier an agreement belongs to, or an AI system is linked to. */
      supplierId?: string | null;
      /** The record a piece of evidence supports. */
      attach?: Attachment | null;
    }
  | {
      action: 'update' | 'merge';
      recordId: string;
      supplierId?: string | null;
      attach?: Attachment | null;
    }
  | { action: 'refuse'; reason: string };

type Batch = {
  id: string;
  organisationId: string;
  sourceId: string;
  recordType: RecordType;
  entityId: string | null;
};

/** Records of one entity-scoped kind imported from this source, by their identifier there. */
async function importedBy(
  tx: Tx,
  batch: Batch,
  kind: 'processing_activity' | 'evidence' | 'ai_use_case'
) {
  const table =
    kind === 'processing_activity'
      ? processingActivities
      : kind === 'evidence'
        ? evidence
        : aiUseCases;
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
  return (
    sourceRef: string,
    extra: { supplierId?: string | null; attach?: Attachment | null } = {}
  ): Decision => {
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
              archivedAt: dpas.archivedAt
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
  }
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
      const used = Object.values(fields);
      const twice = used.find((c, i) => used.indexOf(c) !== i);
      if (twice)
        throw new ImportRefused(
          `"${twice}" is matched to two fields. Match each column to one.`
        );
      const mapping: ImportMapping = {
        fields,
        keepUnmapped: input.mapping.keepUnmapped
      };

      const table = await readFile(batch.file);
      const decide = await matcher(tx, batch);
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
        .set({ status: 'previewed', mapping, counts })
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
  ]
};

const DATE_KEYS = new Set([
  'reviewDueAt',
  'importConfirmedAt',
  'reviewedAt',
  'updatedAt',
  'signedAt',
  'expiresAt',
  'collectedAt'
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
  ai_use_case: aiUseCases
} as const;

/** One previewed row written: the record, and what to undo it with. */
type Written = {
  id: string;
  before: Record<string, unknown> | null;
  documentId?: string | null;
  linkId?: string | null;
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
    await c.tx.update(dpas).set(values).where(eq(dpas.id, c.decision.recordId));
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
      .set(values)
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
        ...described,
        vendor,
        // A link somebody made here is kept; the import only fills an empty one.
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
  }
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
            linkId: written.linkId ?? null
          })
          .where(eq(importRows.id, row.id));
      }

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
  'processing_activity' | 'dpa' | 'evidence' | 'ai_use_case';

/** A person confirms an imported record, which then counts as current. */
export async function confirmImportedRecord(input: {
  organisationId: string;
  type: Confirmable;
  id: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const table = TABLE[input.type];
      const at = new Date();
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
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: (row.entityId as string | undefined) ?? undefined,
        action: `${input.type}.import_confirmed`,
        subjectType: input.type,
        subjectId: input.id,
        after: {
          reference: row.reference ?? null,
          name: row.name ?? row.title ?? null
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
