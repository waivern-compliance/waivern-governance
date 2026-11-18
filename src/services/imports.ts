import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import {
  aiUseCases,
  assessments,
  breachDecisions,
  breaches,
  comments,
  dataProtectionComplaintEvents,
  dataProtectionComplaints,
  dataSubjectRequestDecisions,
  dataSubjectRequests,
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
  organisations,
  policies,
  policyActivities,
  policyAiSystems,
  policyDocuments,
  policyVersions,
  processingActivities,
  recordLinks,
  risks,
  suppliers,
  tasks,
  templates,
  templateVersions,
  users,
  type breachCategory,
  type complaintStatus
} from '@/db/schema';
import { AI_FRAMEWORKS } from '@/lib/ai-frameworks';
import {
  CLASSIFICATION_SCHEMES,
  type AssetClassification
} from '@/lib/assets/register';
import { appendAuditEvent } from '@/lib/audit';
import {
  complaintClock,
  OUTCOME_LABEL,
  pressingDials
} from '@/lib/complaints/statutory';
import { ACCEPTED } from '@/lib/documents/limits';
import { jurisdictionRefusal, ukLawApplies } from '@/lib/dpa2018/applies';
import { PART3_RIGHTS } from '@/lib/dpa2018/part3-rights';
import { policyKeyFrom, type PolicyKey } from '@/lib/dpa2018/policy-keys';
import {
  requestClock,
  RIGHT_KEYS,
  RIGHTS,
  type Right
} from '@/lib/dsr/statutory';
import {
  authorityByCode,
  isEeaState,
  SUPERVISORY_AUTHORITIES
} from '@/lib/gdpr/authorities';
import { basesFromTextFor } from '@/lib/gdpr/lawful-basis';
import {
  CARRIES_FILES,
  CASE_HISTORY,
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
  SourceAnswer,
  SourceEvent
} from '@/lib/import/types';
import { nextReference } from '@/lib/references';
import { rate, SCALES, type RiskScaleId } from '@/lib/risk/scale';

import { createUseCase } from './ai-register';
import { referencePrefixFor } from './assessments';
import { assetTypology } from './asset-types';
import {
  anyClockOverdue,
  concerns,
  everyAuthorityTold,
  targetsOf
} from './breaches';
import { checkFile, insertDocument, UploadRefused } from './documents';
import { ExtractionUnavailable, runExtraction } from './extraction';
import { classificationSchemeOf } from './information-assets';
import { canonicalise as canonicaliseByPush } from './ingest';
import { riskScaleOf } from './risks';
import { cleanLawfulBases, cleanRecordLaws, RecordLawsRefused } from './ropa';
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
  previewNotes: importBatches.previewNotes,
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
          ...(offered.values ? { values: offered.values } : {}),
          ...(offered.everyRow ? { everyRow: offered.everyRow } : {}),
          ...(offered.closedBefore
            ? { closedBefore: offered.closedBefore }
            : {})
        }
      : guessMapping(batch.recordType, batch.columns);
    return { batch, rows, mapping, files };
  });
}

/** A retention cut-off as a calendar date, or refused: never silently ignored. */
function cutOffDate(given: string): string {
  const day = new Date(`${given}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== given)
    throw new ImportRefused(
      `"${given}" is not a date. Give the retention cut-off as a day, such as 2020-01-01.`
    );
  return given;
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
  /** The assessment it came out of, where that has been imported already. */
  assessmentId: string | null;
};

/** A mitigation's risk, and its owner here, where they are a member. */
type MitigationResolved = {
  riskId: string;
  ownerId: string | null;
};

/** A policy's entity, owner, conditions and links, read into this organisation's terms. */
type PolicyResolved = {
  /** Null: every entity in the organisation. */
  entityId: string | null;
  ownerId: string | null;
  conditions: PolicyKey[];
  activityIds: string[];
  aiSystemIds: string[];
};

/** An assessment's subject and owner, read into this organisation's terms. */
type AssessmentResolved = {
  subject: {
    type: 'processing_activity' | 'supplier' | 'ai_use_case';
    id: string;
  } | null;
  ownerId: string | null;
};

/** A request read into this organisation's terms, with where its clock stands. */
type RequestResolved = {
  jurisdiction: 'uk' | 'eu' | 'uk_eu';
  regime: 'gdpr' | 'dpa_part3';
  rights: Right[];
  status: (typeof dataSubjectRequests.$inferSelect)['status'];
  ownerId: string | null;
  /** Open, and already past its deadline: it raises a task once imported. */
  overdue: boolean;
};

/** A decision a breach comes in with: who was told there, and when. */
type BreachDecisionResolved = {
  kind: 'supervisory_authority' | 'data_subjects' | 'pecr_commissioner';
  outcome: 'done' | 'not_required';
  completedAt: Date | null;
  authorityCode: string | null;
};

/** A breach read into this organisation's terms, with where its clocks stand. */
type BreachResolved = {
  regime: 'gdpr' | 'dpa_part3';
  laws: 'uk' | 'eu' | 'uk_eu';
  affectedStates: string[];
  categories: BreachCategory[];
  status: (typeof breaches.$inferSelect)['status'];
  ownerId: string | null;
  /** The decisions to write: all of them when it is new, and on a later import only those it did not come in with. */
  decisions: BreachDecisionResolved[];
  /** Open, and a clock already past: it raises a task once imported. */
  overdue: boolean;
};

type ComplaintStatus = (typeof complaintStatus.enumValues)[number];

/** A complaint read into this organisation's terms, with where its clocks stand. */
type ComplaintResolved = {
  jurisdiction: 'uk' | 'eu' | 'uk_eu';
  controllerRole: 'controller' | 'joint_controller' | 'processor';
  subject: string;
  status: ComplaintStatus;
  /** Its own date, or the outcome's where that acknowledged it. */
  acknowledgedAt: Date | null;
  acknowledgementChannel: string | null;
  requestId: string | null;
  ownerId: string | null;
  /** The steps to write: all of them when it is new, and on a later import only those it did not come in with. */
  steps: ComplaintStep[];
  /** After the thirty days, or after the organisation's own target. */
  acknowledgedLate: boolean;
  outcomeLate: boolean;
  /** Still owed an outcome, and a deadline already past: it raises a task once imported. */
  overdue: boolean;
};

type Resolved = {
  /** The supplier an agreement belongs to, or an AI system is linked to. */
  supplierId?: string | null;
  /** The record a piece of evidence supports. */
  attach?: Attachment | null;
  asset?: AssetResolved;
  risk?: RiskResolved;
  mitigation?: MitigationResolved;
  policy?: PolicyResolved;
  assessment?: AssessmentResolved;
  request?: RequestResolved;
  breach?: BreachResolved;
  complaint?: ComplaintResolved;
};

type Decision =
  | ({ action: 'create'; recordId: null } & Resolved)
  | ({ action: 'update' | 'merge'; recordId: string } & Resolved)
  | { action: 'refuse'; reason: string }
  /** Left out on purpose, with why: a closed case past the retention cut-off. */
  | { action: 'skip'; reason: string };

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
 * whole file, not row by row; for case history, only what the file names.
 */
async function matcher(
  tx: Tx,
  batch: Batch,
  rows: ReadonlyArray<{ record: ImportRecord; sourceRef: string }>
): Promise<(record: ImportRecord, sourceRef: string) => Decision> {
  const refs = rows.map((r) => r.sourceRef);
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
    case 'data_subject_request': {
      const resolve = await requestResolver(tx, batch, refs);
      return (record, sourceRef) => {
        const { data } = record as Of<'data_subject_request'>;
        return missingFile(data.file) ?? resolve(data, sourceRef);
      };
    }
    case 'data_protection_complaint': {
      const resolve = await complaintResolver(
        tx,
        batch,
        refs,
        rows.flatMap(({ record }) =>
          record.kind === 'data_protection_complaint' && record.data.requestRef
            ? [record.data.requestRef]
            : []
        )
      );
      return (record, sourceRef) => {
        const { data } = record as Of<'data_protection_complaint'>;
        return missingFile(data.file) ?? resolve(data, sourceRef);
      };
    }
    case 'breach': {
      const resolve = await breachResolver(tx, batch, refs);
      return (record, sourceRef) => {
        const { data } = record as Of<'breach'>;
        return missingFile(data.file) ?? resolve(data, sourceRef);
      };
    }
    case 'assessment': {
      const resolve = await assessmentResolver(tx, batch);
      return (record, sourceRef) => {
        const { data } = record as Of<'assessment'>;
        return missingFile(data.file) ?? resolve(data, sourceRef);
      };
    }
    case 'policy_document':
    case 'policy': {
      const resolve = await policyResolver(tx, batch);
      return (record, sourceRef) => {
        const { file } = (record as Of<'policy' | 'policy_document'>).data;
        return missingFile(file) ?? resolve(record, sourceRef);
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
  const [scale, memberOf, activityOf, supplierOf, systemOf, assetOf, assessed] =
    await Promise.all([
      riskScaleOf(batch.organisationId, tx),
      membersByEmail(tx, batch.organisationId),
      activitiesByName(tx, batch),
      suppliersByKey(tx, batch.organisationId),
      entityRecordsByName(tx, batch, aiUseCases),
      entityRecordsByName(tx, batch, informationAssets),
      tx
        .select({ id: assessments.id, ref: assessments.externalRef })
        .from(assessments)
        .where(
          and(
            eq(assessments.organisationId, batch.organisationId),
            eq(assessments.entityId, batch.entityId!),
            eq(assessments.importSourceId, batch.sourceId)
          )
        )
    ]);
  const assessmentOf = new Map(
    assessed.map((a) => [a.ref?.toLowerCase(), a.id])
  );
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
      assetIds,
      assessmentId: data.assessment
        ? (assessmentOf.get(data.assessment.trim().toLowerCase()) ?? null)
        : null
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

/**
 * Records across the organisation by Govern reference, ID in this source, or
 * name, for a record that may be for one entity or for every one. A name
 * shared by records in two entities is not guessed between.
 */
async function orgRecordsByName(
  tx: Tx,
  batch: Batch,
  table: typeof processingActivities | typeof aiUseCases
) {
  const rows: Array<{
    id: string;
    entityId: string;
    name: string;
    reference?: string;
    externalRef: string | null;
    importSourceId: string | null;
  }> = await tx
    .select({
      id: table.id,
      entityId: table.entityId,
      name: table.name,
      externalRef: table.externalRef,
      importSourceId: table.importSourceId,
      // Only processing activities carry a Govern reference.
      ...('reference' in table ? { reference: table.reference } : {})
    })
    .from(table)
    .where(eq(table.organisationId, batch.organisationId));
  return (given: string, entityId: string | null): string[] => {
    const inScope = rows.filter((r) => !entityId || r.entityId === entityId);
    const ref = given.trim().toLowerCase();
    for (const match of [
      (r: (typeof rows)[number]) => r.reference?.toLowerCase() === ref,
      (r: (typeof rows)[number]) =>
        r.importSourceId === batch.sourceId &&
        r.externalRef?.toLowerCase() === ref,
      (r: (typeof rows)[number]) => loose(r.name) === loose(given)
    ]) {
      const found = inScope.filter(match);
      if (found.length) return found.map((r) => r.id);
    }
    return [];
  };
}

/**
 * A policy or appropriate policy document read into this organisation's
 * terms: its entity by name (none: every entity), its owner, the conditions
 * it covers, and what it governs. One imported before stays for the entity
 * it came in for: changing whom a policy is for is a person's call.
 */
async function policyResolver(tx: Tx, batch: Batch) {
  const kind = batch.recordType as 'policy' | 'policy_document';
  const table = kind === 'policy' ? policies : policyDocuments;
  const [entityRows, earlier, memberOf, activityOf, systemOf] =
    await Promise.all([
      tx
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(eq(entities.organisationId, batch.organisationId)),
      tx
        .select({
          id: table.id,
          ref: table.externalRef,
          entityId: table.entityId
        })
        .from(table)
        .where(
          and(
            eq(table.organisationId, batch.organisationId),
            eq(table.importSourceId, batch.sourceId)
          )
        ),
      membersByEmail(tx, batch.organisationId),
      // Only a policy names what it governs.
      kind === 'policy'
        ? orgRecordsByName(tx, batch, processingActivities)
        : null,
      kind === 'policy' ? orgRecordsByName(tx, batch, aiUseCases) : null
    ]);
  const own = new Map(earlier.map((r) => [r.ref?.toLowerCase(), r]));
  const nameOf = (id: string | null) =>
    id
      ? (entityRows.find((e) => e.id === id)?.name ?? 'another entity')
      : 'every entity';
  return (record: ImportRecord, sourceRef: string): Decision => {
    const data = (record as Of<'policy' | 'policy_document'>).data;
    let entityId: string | null = null;
    if (data.entity) {
      const entity = entityRows.find(
        (e) => loose(e.name) === loose(data.entity!)
      );
      if (!entity)
        return {
          action: 'refuse',
          reason: `No legal entity called "${data.entity}". Use one of: ${entityRows.map((e) => e.name).join(', ')}, or leave it empty for every entity.`
        };
      entityId = entity.id;
    }
    const conditions: PolicyKey[] = [];
    if (record.kind === 'policy_document')
      for (const given of record.data.conditions) {
        const key = policyKeyFrom(given);
        if (!key)
          return {
            action: 'refuse',
            reason: `"${given}" is not a Schedule 1 condition or Part 3 ground Govern can tell. Name it as "para 18", "Sch 8 para 4" or "Part 3 consent".`
          };
        if (!conditions.includes(key)) conditions.push(key);
      }
    const links = { activityIds: [] as string[], aiSystemIds: [] as string[] };
    if (record.kind === 'policy') {
      if (record.data.status === 'withdrawn' && !record.data.withdrawnAt)
        return {
          action: 'refuse',
          reason: 'A withdrawn policy needs the date it was withdrawn.'
        };
      const lookups = [
        [
          'activityIds',
          record.data.activities,
          activityOf!,
          'processing activity'
        ],
        ['aiSystemIds', record.data.aiSystems, systemOf!, 'AI system']
      ] as const;
      for (const [key, names, find, words] of lookups)
        for (const name of names) {
          const ids = find(name, entityId);
          const where = entityId ? ` in ${nameOf(entityId)}` : '';
          if (ids.length === 0)
            return {
              action: 'refuse',
              reason: `No ${words} "${name}" is recorded${where}. Import or add it first.`
            };
          if (ids.length > 1)
            return {
              action: 'refuse',
              reason: `More than one ${words} is called "${name}"${where}. Name it by its reference.`
            };
          if (!links[key].includes(ids[0])) links[key].push(ids[0]);
        }
    }
    const policy: PolicyResolved = {
      entityId,
      ownerId: data.owner ? memberOf(data.owner) : null,
      conditions,
      ...links
    };
    const found = own.get(sourceRef.toLowerCase());
    if (!found) return { action: 'create', recordId: null, policy };
    if (found.entityId !== entityId)
      return {
        action: 'refuse',
        reason: `Imported before for ${nameOf(found.entityId)}, and this row says ${nameOf(entityId)}. ${
          // A policy document's entity is changed on its page; a policy's is not.
          kind === 'policy_document'
            ? 'Change whom it is for on its page, or give it a new identifier.'
            : 'Give it a new identifier to record it for that entity.'
        }`
      };
    return { action: 'update', recordId: found.id, policy };
  };
}

/**
 * An assessment's subject, found as a risk's links are, and the assessment
 * imported before from this source. One changed here since it was imported,
 * superseded by a reassessment say, is history here now: an import does not
 * write over it.
 */
async function assessmentResolver(tx: Tx, batch: Batch) {
  const [activityOf, supplierOf, systemOf, memberOf, earlier] =
    await Promise.all([
      activitiesByName(tx, batch),
      suppliersByKey(tx, batch.organisationId),
      entityRecordsByName(tx, batch, aiUseCases),
      membersByEmail(tx, batch.organisationId),
      tx
        .select({
          id: assessments.id,
          ref: assessments.externalRef,
          entityId: assessments.entityId,
          entityName: entities.name,
          status: assessments.status,
          importedOutcome: assessments.importedOutcome,
          reference: assessments.reference,
          kind: templates.kind
        })
        .from(assessments)
        .innerJoin(entities, eq(entities.id, assessments.entityId))
        .innerJoin(
          templateVersions,
          eq(templateVersions.id, assessments.templateVersionId)
        )
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        .where(
          and(
            eq(assessments.organisationId, batch.organisationId),
            eq(assessments.importSourceId, batch.sourceId)
          )
        )
    ]);
  const own = new Map(earlier.map((a) => [a.ref?.toLowerCase(), a]));
  return (data: Of<'assessment'>['data'], sourceRef: string): Decision => {
    const named = (
      [
        [
          'processing_activity',
          data.activity,
          activityOf,
          'processing activity'
        ],
        ['supplier', data.supplier, supplierOf, 'supplier'],
        ['ai_use_case', data.aiSystem, systemOf, 'AI system']
      ] as const
    ).filter(([, given]) => given);
    if (named.length > 1)
      return {
        action: 'refuse',
        reason:
          'It names more than one of a processing activity, a supplier and an AI system. An assessment here is of one.'
      };
    let subject: AssessmentResolved['subject'] = null;
    if (named.length) {
      const [type, given, find, words] = named[0];
      const id = find(given!);
      if (!id)
        return {
          action: 'refuse',
          reason: `No ${words} "${given}" is recorded${type === 'supplier' ? '' : ' in this entity'}. Import or add it first.`
        };
      subject = { type, id };
    }
    const assessment = {
      subject,
      ownerId: data.owner ? memberOf(data.owner) : null
    };
    const found = own.get(sourceRef.toLowerCase());
    if (!found) return { action: 'create', recordId: null, assessment };
    if (found.entityId !== batch.entityId)
      return {
        action: 'refuse',
        reason: `Imported before into ${found.entityName}. Import it into that entity.`
      };
    // Its kind decides what it counts as, and its reference says it: a
    // different kind is a different assessment.
    if (found.kind !== data.kind)
      return {
        action: 'refuse',
        reason: `${found.reference} was imported as a ${TEMPLATE_KIND_NAME[found.kind as Of<'assessment'>['data']['kind']] ?? found.kind}, and this row says ${TEMPLATE_KIND_NAME[data.kind]}. Give it a new identifier to import it as that kind.`
      };
    if (found.status !== 'imported' && found.status !== found.importedOutcome)
      return {
        action: 'refuse',
        reason: `${found.reference} has been ${found.status.replace(/_/g, ' ')} here since it was imported, so it is history here now and is not written over.`
      };
    return { action: 'update', recordId: found.id, assessment };
  };
}

/** A right as another platform names it: its key, its name, its Article, or a usual word. */
const RIGHT_WORDS: Record<Right, string[]> = {
  access: [
    'sar',
    'dsar',
    'subject access',
    'access request',
    'right of access'
  ],
  rectification: ['correction', 'correct', 'rectify', 'amend'],
  erasure: ['deletion', 'delete', 'right to be forgotten', 'forget', 'erase'],
  restriction: ['restrict', 'restriction of processing'],
  portability: ['data portability', 'port'],
  objection: ['object', 'objection to processing', 'opt out of processing'],
  automated_decision: [
    'automated decision',
    'automated decision making',
    'profiling'
  ],
  withdraw_consent: [
    'withdraw consent',
    'consent withdrawal',
    'consent withdrawn'
  ]
};

function rightFrom(given: string): Right | null {
  const v = loose(given);
  return (
    RIGHT_KEYS.find(
      (k) =>
        loose(k) === v ||
        loose(RIGHTS[k].label) === v ||
        loose(RIGHTS[k].article) === v ||
        RIGHT_WORDS[k].some((w) => loose(w) === v)
    ) ?? null
  );
}

/** The tables of cases imported with their history. */
type CaseTable =
  | typeof dataSubjectRequests
  | typeof breaches
  | typeof dataProtectionComplaints;

/**
 * Cases brought in before from the batch's platform that the rows about to
 * be decided name by their ID there: what a re-import would update.
 */
async function priorCases(
  tx: Tx,
  batch: Batch,
  table: CaseTable,
  refs: readonly string[]
) {
  if (refs.length === 0) return [];
  return tx
    .select({
      id: table.id,
      ref: table.externalRef,
      entityId: table.entityId,
      entityName: entities.name,
      reference: table.reference,
      updatedAt: table.updatedAt,
      importedAt: importBatches.committedAt,
      confirmedAt: table.importConfirmedAt
    })
    .from(table)
    .innerJoin(entities, eq(entities.id, table.entityId))
    .leftJoin(importBatches, eq(importBatches.id, table.importBatchId))
    .where(
      and(
        eq(table.organisationId, batch.organisationId),
        eq(table.importSourceId, batch.sourceId),
        inArray(
          sql`lower(${table.externalRef})`,
          refs.map((r) => r.toLowerCase())
        )
      )
    );
}

type PriorCase = Awaited<ReturnType<typeof priorCases>>[number];

/**
 * Why a case imported before is not written over, or null where it may be:
 * it belongs to another entity, or it has been worked on here since, with a
 * decision or step recorded here, or a change after both its last import and
 * its confirmation, neither of which is work on the case.
 */
function priorCaseRefusal(
  found: PriorCase,
  batch: Batch,
  recordedHere: boolean
): string | null {
  if (found.entityId !== batch.entityId)
    return `Imported before into ${found.entityName}. Import it into that entity.`;
  const settled = Math.max(
    found.importedAt?.getTime() ?? 0,
    found.confirmedAt?.getTime() ?? 0
  );
  return recordedHere || found.updatedAt.getTime() > settled
    ? `${found.reference} has been worked on here since it was imported, so it is not written over. Record what changed on its page.`
    : null;
}

/** The retention cut-off a batch of case history was given (decision 10). */
const cutOffOf = (batch: Batch) =>
  batch.mapping?.closedBefore ? new Date(batch.mapping.closedBefore) : null;

/** A case that ended before the retention cut-off, left out; or null. */
function beforeCutOff(
  ended: Date | null,
  cutOff: Date | null
): Decision | null {
  return cutOff && ended && ended < cutOff
    ? {
        action: 'skip',
        reason: `Ended on ${ended.toISOString().slice(0, 10)}, before the retention cut-off of ${cutOff.toISOString().slice(0, 10)}.`
      }
    : null;
}

/**
 * A request's rights, law, regime and status read into this organisation's
 * terms, its dates checked for what each status needs, and its clock worked
 * out as it would be had it been recorded here. A closed one that ended
 * before the batch's retention cut-off is left out (decision 10). One worked
 * on here since it was imported is not written over: that work is a
 * person's, here.
 */
async function requestResolver(tx: Tx, batch: Batch, refs: readonly string[]) {
  const [[entity], memberOf, earlier] = await Promise.all([
    tx
      .select({
        name: entities.name,
        law: entities.dataProtectionLaw,
        competentAuthority: entities.competentAuthority
      })
      .from(entities)
      .where(eq(entities.id, batch.entityId!)),
    membersByEmail(tx, batch.organisationId),
    priorCases(tx, batch, dataSubjectRequests, refs)
  ]);
  const own = new Map(earlier.map((r) => [r.ref?.toLowerCase(), r]));
  // Requests with a decision recorded here, not brought in by an import.
  const decidedHere = new Set(
    earlier.length
      ? (
          await tx
            .selectDistinct({ id: dataSubjectRequestDecisions.requestId })
            .from(dataSubjectRequestDecisions)
            .where(
              and(
                inArray(
                  dataSubjectRequestDecisions.requestId,
                  earlier.map((r) => r.id)
                ),
                isNull(dataSubjectRequestDecisions.importBatchId)
              )
            )
        ).map((r) => r.id)
      : []
  );
  const cutOff = cutOffOf(batch);
  const now = new Date();
  return (
    data: Of<'data_subject_request'>['data'],
    sourceRef: string
  ): Decision => {
    const refuse = (reason: string): Decision => ({ action: 'refuse', reason });
    const rights: Right[] = [];
    for (const given of data.rights) {
      const right = rightFrom(given);
      if (!right)
        return refuse(
          `"${given}" is not a right Govern knows. Use one of: ${RIGHT_KEYS.map((k) => RIGHTS[k].label).join(', ')}.`
        );
      if (!rights.includes(right)) rights.push(right);
    }
    let jurisdiction = data.jurisdiction ?? entity.law;
    const outsideLaw = jurisdictionRefusal(entity, jurisdiction, 'request');
    if (outsideLaw) return refuse(outsideLaw);
    const regime = data.regime ?? 'gdpr';
    if (regime === 'dpa_part3') {
      if (!entity.competentAuthority)
        return refuse(
          `Part 3 is for a competent authority, and ${entity.name} is not marked as one.`
        );
      if (jurisdiction === 'eu')
        return refuse('Part 3 of the Data Protection Act 2018 is UK law.');
      const outside = rights.filter((r) => !PART3_RIGHTS.includes(r));
      if (outside.length)
        return refuse(
          `Part 3 gives no right of ${outside.map((r) => RIGHTS[r].label.toLowerCase()).join(' or ')}.`
        );
      jurisdiction = 'uk';
    }
    const at = (iso?: string) => (iso ? new Date(iso) : null);
    const receivedAt = new Date(data.receivedAt);
    if (receivedAt > now)
      return refuse('It cannot have arrived in the future.');
    if (data.clarificationReceivedAt && !data.clarificationRequestedAt)
      return refuse(
        'It says clarification was received, but not when it was asked for. Both dates are needed to work out the deadline.'
      );
    if (data.extended && !data.extendedAt)
      return refuse(
        'It says the time was extended, but not when. The deadline cannot be worked out without that date.'
      );
    // Closed there with only its response dated is a request answered: its
    // response is how it ended.
    const given =
      data.status === 'closed' && !data.closedAt && data.respondedAt
        ? 'responded'
        : data.status;
    const status =
      given ??
      (data.closedAt
        ? 'closed'
        : data.respondedAt
          ? 'responded'
          : data.identityRequestedAt && !data.identityVerifiedAt
            ? 'verifying'
            : data.clarificationRequestedAt && !data.clarificationReceivedAt
              ? 'paused'
              : 'in_progress');
    // Each status needs the dates that make it true; nothing is assumed.
    if ((status === 'responded' || status === 'refused') && !data.respondedAt)
      return refuse(
        `It is ${status} there, but gives no date it was responded to.`
      );
    if ((status === 'withdrawn' || status === 'closed') && !data.closedAt)
      return refuse(`It is ${status} there, but gives no date it was closed.`);
    if (
      status === 'verifying' &&
      (!data.identityRequestedAt || data.identityVerifiedAt)
    )
      return refuse(
        'Waiting for proof of identity needs the date it was asked for, and no date it arrived.'
      );
    if (
      status === 'paused' &&
      (!data.clarificationRequestedAt || data.clarificationReceivedAt)
    )
      return refuse(
        'Waiting for clarification needs the date it was asked for, and no date it arrived.'
      );
    const skipped = beforeCutOff(
      at(data.closedAt) ?? at(data.respondedAt),
      cutOff
    );
    if (skipped) return skipped;
    const clock = requestClock({
      jurisdiction,
      receivedAt,
      identityRequestedAt: at(data.identityRequestedAt),
      identityVerifiedAt: at(data.identityVerifiedAt),
      pauses: data.clarificationRequestedAt
        ? [
            {
              from: new Date(data.clarificationRequestedAt),
              to: at(data.clarificationReceivedAt)
            }
          ]
        : [],
      extended: Boolean(data.extendedAt),
      respondedAt: at(data.respondedAt),
      closedWithoutResponse: Boolean(data.closedAt),
      now
    });
    const request: RequestResolved = {
      jurisdiction,
      regime,
      rights,
      status,
      ownerId: data.owner ? memberOf(data.owner) : null,
      overdue: clock.state === 'overdue'
    };
    const found = own.get(sourceRef.toLowerCase());
    if (!found) return { action: 'create', recordId: null, request };
    const refusal = priorCaseRefusal(found, batch, decidedHere.has(found.id));
    if (refusal) return refuse(refusal);
    return { action: 'update', recordId: found.id, request };
  };
}

type BreachCategory = (typeof breachCategory.enumValues)[number];

/** Kinds of breach in the source's words, read onto the three here. */
const BREACH_CATEGORY_WORDS: Record<string, BreachCategory> = {
  confidentiality: 'confidentiality',
  disclosure: 'confidentiality',
  'unauthorised disclosure': 'confidentiality',
  'unauthorized disclosure': 'confidentiality',
  'unauthorised access': 'confidentiality',
  'unauthorized access': 'confidentiality',
  integrity: 'integrity',
  alteration: 'integrity',
  'unauthorised alteration': 'integrity',
  'unauthorized alteration': 'integrity',
  availability: 'availability',
  loss: 'availability',
  destruction: 'availability',
  'loss of access': 'availability'
};

/** An authority as the source names it: its code here, or its name. */
function authorityFrom(given: string) {
  const word = given.trim().toLowerCase();
  if (
    [
      'ico',
      "information commissioner's office",
      'information commissioner'
    ].includes(word)
  )
    return authorityByCode('gb-ico');
  return (
    authorityByCode(word) ??
    SUPERVISORY_AUTHORITIES.find((a) => a.name.toLowerCase() === word) ??
    null
  );
}

/**
 * Breaches of the batch's entity, each read into this organisation's terms:
 * its laws within the entity's, its dates checked for what each status
 * needs, and its clocks worked out as they would be had it been recorded
 * here. A closed one that ended before the batch's retention cut-off is left
 * out (decision 10). One worked on here since it was imported is not written
 * over.
 */
async function breachResolver(tx: Tx, batch: Batch, refs: readonly string[]) {
  const [[entity], memberOf, earlier] = await Promise.all([
    tx
      .select({
        name: entities.name,
        law: entities.dataProtectionLaw,
        competentAuthority: entities.competentAuthority,
        provider: entities.publicCommsProvider,
        euEstablishments: entities.euEstablishments,
        euMainEstablishment: entities.euMainEstablishment,
        euLeadAuthority: entities.euLeadAuthority
      })
      .from(entities)
      .where(eq(entities.id, batch.entityId!)),
    membersByEmail(tx, batch.organisationId),
    priorCases(tx, batch, breaches, refs)
  ]);
  const own = new Map(earlier.map((r) => [r.ref?.toLowerCase(), r]));
  // Each earlier breach's decisions: one recorded here, not brought in by an
  // import, means it has been worked on here.
  const decisionsOf = Map.groupBy(
    earlier.length
      ? await tx
          .select({
            breachId: breachDecisions.breachId,
            kind: breachDecisions.kind,
            outcome: breachDecisions.outcome,
            completedAt: breachDecisions.completedAt,
            authorityCode: breachDecisions.authorityCode,
            importBatchId: breachDecisions.importBatchId
          })
          .from(breachDecisions)
          .where(
            inArray(
              breachDecisions.breachId,
              earlier.map((r) => r.id)
            )
          )
      : [],
    (d) => d.breachId
  );
  const cutOff = cutOffOf(batch);
  const now = new Date();
  return (data: Of<'breach'>['data'], sourceRef: string): Decision => {
    const refuse = (reason: string): Decision => ({ action: 'refuse', reason });
    const categories: BreachCategory[] = [];
    for (const given of data.categories ?? []) {
      const category = BREACH_CATEGORY_WORDS[given.trim().toLowerCase()];
      if (!category)
        return refuse(
          `"${given}" is not a kind of breach Govern knows. Use confidentiality, integrity or availability.`
        );
      if (!categories.includes(category)) categories.push(category);
    }
    const affectedStates = [
      ...new Set((data.affectedStates ?? []).map((s) => s.trim().toUpperCase()))
    ]
      .filter(Boolean)
      .sort();
    const notEea = affectedStates.filter((c) => !isEeaState(c));
    if (notEea.length)
      return refuse(`Not an EEA member State: ${notEea.join(', ')}.`);
    const regime = data.regime ?? 'gdpr';
    if (regime === 'dpa_part3' && !entity.competentAuthority)
      return refuse(
        `Part 3 is for a competent authority, and ${entity.name} is not marked as one.`
      );
    let laws: BreachResolved['laws'];
    try {
      laws = cleanRecordLaws(entity, data.laws, regime);
    } catch (error) {
      if (error instanceof RecordLawsRefused) return refuse(error.message);
      throw error;
    }
    if ((data.pecrServiceBreach || data.pecrNotifiedAt) && !entity.provider)
      return refuse(
        `PECR regulation 5A is for a provider of a public electronic communications service, and ${entity.name} is not marked as one.`
      );

    const at = (iso?: string) => (iso ? new Date(iso) : null);
    const discoveredAt = new Date(data.discoveredAt);
    if (discoveredAt > now)
      return refuse('It cannot have been discovered in the future.');
    // Each date after it was discovered and none in the future, or its clocks
    // read nonsense: told before anyone knew reads as told in time.
    const after = [
      ['the authority was notified', data.authorityNotifiedAt],
      ['the people affected were told', data.subjectsNotifiedAt],
      ['the Commissioner was told under PECR', data.pecrNotifiedAt],
      ['it was closed', data.closedAt]
    ] as const;
    for (const [what, iso] of after) {
      const when = at(iso);
      if (when && when < discoveredAt)
        return refuse(`It gives a date ${what} before it was discovered.`);
      if (when && when > now)
        return refuse(`It gives a date ${what} in the future.`);
    }
    if (data.occurredAt && new Date(data.occurredAt) > discoveredAt)
      return refuse('It gives a date it happened after it was discovered.');
    if (data.containedAt && new Date(data.containedAt) > now)
      return refuse('It gives a date it was contained in the future.');

    // Told, or judged not to need telling: each needs what makes it true.
    const decision =
      data.authorityDecision ?? (data.authorityNotifiedAt ? 'notified' : null);
    if (decision === 'notified' && !data.authorityNotifiedAt)
      return refuse(
        'It says the authority was notified, but not when. Whether it was within the seventy-two hours cannot be worked out without that date.'
      );
    if (decision === 'not_required' && data.authorityNotifiedAt)
      return refuse(
        'It says the authority did not need notifying, and gives a date it was notified. Say which it was.'
      );
    const subjects =
      data.subjectsDecision ?? (data.subjectsNotifiedAt ? 'told' : null);
    if (subjects === 'told' && !data.subjectsNotifiedAt)
      return refuse(
        'It says the people affected were told, but not when. Give the date they were told.'
      );
    if (subjects === 'not_required' && data.subjectsNotifiedAt)
      return refuse(
        'It says the people affected did not need telling, and gives a date they were told. Say which it was.'
      );
    const targets = targetsOf(
      { laws, affectedStates, regime },
      { entityLaw: entity.law, ...entity }
    );
    let authorityCode: string | null = null;
    if (decision === 'notified') {
      if (data.authority) {
        const named = authorityFrom(data.authority);
        if (!named)
          return refuse(
            `"${data.authority}" is not a supervisory authority Govern knows. Give its name or its code here, such as "ie-dpc".`
          );
        if (
          !targets.some((t) =>
            concerns({ authorityCode: named.code }, t, false)
          )
        )
          return refuse(
            `${named.name} is not an authority this breach is owed to under its laws. Check its law and the member States affected.`
          );
        authorityCode = named.code;
      } else if (targets.length > 1)
        return refuse(
          `It is owed to more than one authority (${targets.map((t) => t.name).join(', ')}). Say which one it was notified to.`
        );
      else authorityCode = targets[0]?.code ?? null;
    }
    const decisions: BreachDecisionResolved[] = [
      ...(decision
        ? [
            {
              kind: 'supervisory_authority' as const,
              outcome:
                decision === 'notified'
                  ? ('done' as const)
                  : ('not_required' as const),
              completedAt: at(data.authorityNotifiedAt),
              authorityCode
            }
          ]
        : []),
      ...(subjects
        ? [
            {
              kind: 'data_subjects' as const,
              outcome:
                subjects === 'told'
                  ? ('done' as const)
                  : ('not_required' as const),
              completedAt: at(data.subjectsNotifiedAt),
              authorityCode: null
            }
          ]
        : []),
      ...(data.pecrNotifiedAt
        ? [
            {
              kind: 'pecr_commissioner' as const,
              outcome: 'done' as const,
              completedAt: new Date(data.pecrNotifiedAt),
              authorityCode: null
            }
          ]
        : [])
    ];

    if (data.status && data.status !== 'closed' && data.closedAt)
      return refuse(
        `It is ${data.status} there, but gives a date it was closed. Say which it is.`
      );
    // Notified as a breach recorded here is: every authority it is owed to
    // told, or the Commissioner under PECR.
    const told =
      Boolean(data.pecrNotifiedAt) ||
      (decision === 'notified' && everyAuthorityTold(targets, decisions));
    const status =
      data.status ??
      (data.closedAt
        ? 'closed'
        : told
          ? 'notified'
          : data.containedAt
            ? 'contained'
            : decision
              ? 'assessing'
              : 'discovered');
    if (status === 'closed' && !data.closedAt)
      return refuse('It is closed there, but gives no date it was closed.');
    if (
      status === 'notified' &&
      decision !== 'notified' &&
      !data.pecrNotifiedAt
    )
      return refuse(
        'It is notified there, but gives no date the authority was notified.'
      );
    const skipped = beforeCutOff(at(data.closedAt), cutOff);
    if (skipped) return skipped;

    const resolved = (toWrite: BreachDecisionResolved[]): BreachResolved => ({
      regime,
      laws,
      affectedStates,
      categories,
      status,
      ownerId: data.owner ? memberOf(data.owner) : null,
      decisions: toWrite,
      // The sweep reads only open breaches.
      overdue:
        !data.closedAt &&
        anyClockOverdue({
          breach: {
            controllerRole: data.controllerRole ?? 'controller',
            discoveredAt,
            regime,
            pecrServiceBreach: data.pecrServiceBreach ?? null
          },
          decisions,
          targets,
          provider: entity.provider,
          now
        })
    });
    const found = own.get(sourceRef.toLowerCase());
    if (!found)
      return { action: 'create', recordId: null, breach: resolved(decisions) };
    const had = decisionsOf.get(found.id) ?? [];
    const refusal = priorCaseRefusal(
      found,
      batch,
      had.some((d) => d.importBatchId === null)
    );
    if (refusal) return refuse(refusal);
    // A decision it came in with stands as it came in; one the source has
    // recorded since is added, and one it now tells differently is refused
    // rather than rewriting when somebody was told.
    type Told = {
      outcome: string;
      authorityCode: string | null;
      completedAt: Date | null;
    };
    const same = (a: Told, b: Told) =>
      a.outcome === b.outcome &&
      a.authorityCode === b.authorityCode &&
      a.completedAt?.getTime() === b.completedAt?.getTime();
    const changed = had.filter(
      (h) => !decisions.some((d) => d.kind === h.kind && same(d, h))
    );
    if (changed.length)
      return refuse(
        `${found.reference} came in saying something different about who was told. A decision once imported is not rewritten: record what changed on its page.`
      );
    return {
      action: 'update',
      recordId: found.id,
      breach: resolved(
        decisions.filter((d) => !had.some((h) => h.kind === d.kind))
      )
    };
  };
}

/** A step a complaint comes in with: when the complainant heard from the organisation there. */
type ComplaintStep = {
  kind: 'acknowledged' | 'progress_update' | 'outcome_sent' | 'withdrawn';
  occurredAt: Date;
  channel: string | null;
};

const STATUS_WORDS: Record<ComplaintStatus, string> = {
  received: 'received',
  acknowledged: 'acknowledged',
  investigating: 'being investigated',
  outcome_sent: 'answered',
  withdrawn: 'withdrawn',
  closed: 'closed'
};

/**
 * What a complaint's status needs of its dates, as recording it here does:
 * a closed one its outcome, a withdrawn one none, and each its own date.
 */
function complaintStatusRefusal(
  status: ComplaintStatus,
  data: Of<'data_protection_complaint'>['data']
): string | null {
  const is = `It is ${STATUS_WORDS[status]} there`;
  const ended = status === 'closed' || status === 'withdrawn';
  if (ended && !data.closedAt) return `${is}, but gives no date it ended.`;
  if (!ended && data.closedAt)
    return `${is}, but gives a date it was closed. Say which it is.`;
  if (status === 'closed' && !data.outcomeAt)
    return `${is}, but gives no outcome. Give the outcome and the date it was sent, or mark it withdrawn if the complainant withdrew it.`;
  if (status === 'withdrawn' && data.outcomeAt)
    return 'It says it was withdrawn, and gives a date the outcome was sent. An answered complaint was not withdrawn: say which it was.';
  if (status === 'outcome_sent' && !data.outcomeAt)
    return `${is}, but gives no date the outcome was sent.`;
  if (
    (status === 'received' ||
      status === 'acknowledged' ||
      status === 'investigating') &&
    data.outcomeAt
  )
    return `${is}, but gives a date the outcome was sent. Say which it is.`;
  if (status === 'acknowledged' && !data.acknowledgedAt)
    return `${is}, but gives no date it was acknowledged.`;
  if (status === 'received' && data.acknowledgedAt)
    return `${is}, but gives a date it was acknowledged. Say which it is.`;
  return null;
}

/**
 * Complaints to the batch's entity, each read into this organisation's
 * terms: its law within the entity's, its dates checked for what its status
 * needs, and its thirty days and the organisation's own targets worked out
 * as they would be had it been recorded here. A closed one that ended before
 * the batch's retention cut-off is left out (decision 10). One worked on
 * here since it was imported is not written over.
 */
async function complaintResolver(
  tx: Tx,
  batch: Batch,
  refs: readonly string[],
  requestRefs: readonly string[]
) {
  const [[entity], memberOf, earlier, [targets], requests] = await Promise.all([
    tx
      .select({ name: entities.name, law: entities.dataProtectionLaw })
      .from(entities)
      .where(eq(entities.id, batch.entityId!)),
    membersByEmail(tx, batch.organisationId),
    priorCases(tx, batch, dataProtectionComplaints, refs),
    tx
      .select({
        outcomeTargetDays: organisations.complaintOutcomeTargetDays,
        updateIntervalDays: organisations.complaintUpdateIntervalDays
      })
      .from(organisations)
      .where(eq(organisations.id, batch.organisationId)),
    // The requests the file's complaints name: by their reference here, or
    // by their ID in a platform they were imported from.
    requestRefs.length
      ? tx
          .select({
            id: dataSubjectRequests.id,
            reference: dataSubjectRequests.reference,
            ref: dataSubjectRequests.externalRef,
            sourceId: dataSubjectRequests.importSourceId,
            entityId: dataSubjectRequests.entityId
          })
          .from(dataSubjectRequests)
          .where(
            and(
              eq(dataSubjectRequests.organisationId, batch.organisationId),
              or(
                inArray(
                  sql`lower(${dataSubjectRequests.reference})`,
                  requestRefs.map((r) => r.toLowerCase())
                ),
                inArray(
                  sql`lower(${dataSubjectRequests.externalRef})`,
                  requestRefs.map((r) => r.toLowerCase())
                )
              )
            )
          )
      : []
  ]);
  const own = new Map(earlier.map((r) => [r.ref?.toLowerCase(), r]));
  // Its reference here first; then its ID in this platform, or in the one
  // other platform it was imported from.
  const requestNamed = (given: string) => {
    const key = given.toLowerCase();
    const here = requests.find((r) => r.reference.toLowerCase() === key);
    if (here) return here;
    const there = requests.filter((r) => r.ref?.toLowerCase() === key);
    return (
      there.find((r) => r.sourceId === batch.sourceId) ??
      (there.length > 1 ? 'ambiguous' : (there[0] ?? null))
    );
  };
  // Each earlier complaint's steps: one recorded here, not brought in by an
  // import, means it has been worked on here.
  const stepsOf = Map.groupBy(
    earlier.length
      ? await tx
          .select({
            complaintId: dataProtectionComplaintEvents.complaintId,
            kind: dataProtectionComplaintEvents.kind,
            occurredAt: dataProtectionComplaintEvents.occurredAt,
            importBatchId: dataProtectionComplaintEvents.importBatchId
          })
          .from(dataProtectionComplaintEvents)
          .where(
            inArray(
              dataProtectionComplaintEvents.complaintId,
              earlier.map((r) => r.id)
            )
          )
      : [],
    (e) => e.complaintId
  );
  const cutOff = cutOffOf(batch);
  const now = new Date();
  return (
    data: Of<'data_protection_complaint'>['data'],
    sourceRef: string
  ): Decision => {
    const refuse = (reason: string): Decision => ({ action: 'refuse', reason });
    const jurisdiction = data.jurisdiction ?? entity.law;
    const outsideLaw = jurisdictionRefusal(entity, jurisdiction, 'complaint');
    if (outsideLaw) return refuse(outsideLaw);
    const controllerRole = data.controllerRole ?? 'controller';
    if (
      data.outcome === 'passed_to_controller' &&
      controllerRole === 'controller'
    )
      return refuse(
        'As the controller, the complaint was its to answer. Passing it on is for a processor or a joint controller.'
      );

    const at = (iso?: string) => (iso ? new Date(iso) : null);
    const receivedAt = new Date(data.receivedAt);
    if (receivedAt > now)
      return refuse('It cannot have arrived in the future.');
    // Each date after it arrived and none in the future, and in the order
    // they can happen in: nothing is owed once the outcome is sent.
    const dated = [
      ['acknowledged', data.acknowledgedAt],
      ['last updated', data.lastUpdateAt],
      ['answered', data.outcomeAt],
      ['closed', data.closedAt]
    ] as const;
    for (const [what, iso] of dated) {
      const when = at(iso);
      if (when && when < receivedAt)
        return refuse(`It gives a date it was ${what} before it arrived.`);
      if (when && when > now)
        return refuse(`It gives a date it was ${what} in the future.`);
    }
    const outcomeAt = at(data.outcomeAt);
    const closedAt = at(data.closedAt);
    for (const [what, iso] of dated.slice(0, 2)) {
      const when = at(iso);
      if (when && outcomeAt && when > outcomeAt)
        return refuse(
          `It gives a date it was ${what} after the outcome was sent.`
        );
    }
    for (const [what, iso] of dated.slice(0, 3)) {
      const when = at(iso);
      if (when && closedAt && when > closedAt)
        return refuse(`It gives a date it was ${what} after it was closed.`);
    }
    if (data.outcome && !data.outcomeAt)
      return refuse(
        'It gives the outcome, but not when it was sent. Give the date the complainant was told.'
      );
    if (data.outcomeAt && !data.outcome)
      return refuse(
        'It gives a date the outcome was sent, but not what it was: upheld, partly upheld, not upheld, or passed to the controller.'
      );

    const status: ComplaintStatus =
      data.status ??
      (data.closedAt
        ? 'closed'
        : data.outcomeAt
          ? 'outcome_sent'
          : data.acknowledgedAt
            ? 'acknowledged'
            : 'received');
    const statusRefusal = complaintStatusRefusal(status, data);
    if (statusRefusal) return refuse(statusRefusal);

    let requestId: string | null = null;
    if (data.requestRef) {
      const request = requestNamed(data.requestRef);
      if (!request)
        return refuse(
          `"${data.requestRef}" is not a request in Govern, by its reference here or its ID in a platform it was imported from. Import the requests first, or leave the request it is about empty.`
        );
      if (request === 'ambiguous')
        return refuse(
          `"${data.requestRef}" is the ID of requests imported from more than one platform. Give its reference here instead, such as DSR-2026-0001.`
        );
      if (request.entityId !== batch.entityId)
        return refuse(
          `The request "${data.requestRef}" belongs to another entity. A complaint and the request it is about are answered by the same controller.`
        );
      requestId = request.id;
    }

    const skipped = beforeCutOff(closedAt, cutOff);
    if (skipped) return skipped;

    const steps: ComplaintStep[] = [
      ...(data.acknowledgedAt
        ? [
            {
              kind: 'acknowledged' as const,
              occurredAt: new Date(data.acknowledgedAt),
              channel: data.acknowledgementChannel ?? null
            }
          ]
        : []),
      ...(data.lastUpdateAt
        ? [
            {
              kind: 'progress_update' as const,
              occurredAt: new Date(data.lastUpdateAt),
              channel: null
            }
          ]
        : []),
      ...(outcomeAt
        ? [
            {
              kind: 'outcome_sent' as const,
              occurredAt: outcomeAt,
              channel: data.outcomeChannel ?? null
            }
          ]
        : []),
      ...(status === 'withdrawn' && closedAt
        ? [{ kind: 'withdrawn' as const, occurredAt: closedAt, channel: null }]
        : [])
    ];
    // Sending the outcome tells the complainant it arrived, so it
    // acknowledges it where nothing did before, as recording it here does.
    const acknowledgedAt = at(data.acknowledgedAt) ?? outcomeAt;
    // How it stands as it would here: late, or overdue where it is still
    // owed an outcome, which is all the sweep reads.
    const clock = complaintClock({
      jurisdiction,
      controllerRole,
      receivedAt,
      acknowledgedAt,
      lastUpdateAt: at(data.lastUpdateAt),
      outcomeAt,
      ended: status === 'withdrawn',
      outcomeTargetDays: targets.outcomeTargetDays,
      updateIntervalDays: targets.updateIntervalDays,
      now
    });
    const open = !outcomeAt && !closedAt;
    const resolved = (toWrite: ComplaintStep[]): ComplaintResolved => ({
      jurisdiction,
      controllerRole,
      subject: data.subject ?? 'other',
      status,
      acknowledgedAt,
      acknowledgementChannel:
        data.acknowledgementChannel ??
        (data.acknowledgedAt ? null : (data.outcomeChannel ?? null)),
      requestId,
      ownerId: data.owner ? memberOf(data.owner) : null,
      steps: toWrite,
      acknowledgedLate: clock.acknowledgement.state === 'late',
      outcomeLate: clock.outcome.state === 'late',
      overdue: open && pressingDials(clock).some((d) => d.state === 'overdue')
    });
    const found = own.get(sourceRef.toLowerCase());
    if (!found)
      return { action: 'create', recordId: null, complaint: resolved(steps) };
    const had = stepsOf.get(found.id) ?? [];
    const refusal = priorCaseRefusal(
      found,
      batch,
      had.some((e) => e.importBatchId === null)
    );
    if (refusal) return refuse(refusal);
    // A step it came in with stands as it came in; one the source has
    // recorded since is added, and one it now dates differently is refused
    // rather than rewriting when the complainant heard. A later update is
    // another update, not a different one.
    const latest = (
      kind: ComplaintStep['kind'],
      of: ReadonlyArray<{ kind: string; occurredAt: Date }>
    ) =>
      Math.max(
        ...of.filter((s) => s.kind === kind).map((s) => s.occurredAt.getTime()),
        -Infinity
      );
    const changed = had.some((h) =>
      h.kind === 'progress_update'
        ? latest('progress_update', steps) < h.occurredAt.getTime()
        : !steps.some(
            (s) =>
              s.kind === h.kind &&
              s.occurredAt.getTime() === h.occurredAt.getTime()
          )
    );
    if (changed)
      return refuse(
        `${found.reference} came in saying something different about when the complainant heard from you. A step once imported is not rewritten: record what changed on its page.`
      );
    const hadUpdate = latest('progress_update', had);
    return {
      action: 'update',
      recordId: found.id,
      complaint: resolved(
        steps.filter((s) =>
          s.kind === 'progress_update'
            ? s.occurredAt.getTime() > hadUpdate
            : !had.some((h) => h.kind === s.kind)
        )
      )
    };
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
      // A choice made for every row, only for a field that allows it, only
      // where no column is matched, and only one of its own values.
      const everyRow = Object.fromEntries(
        Object.entries(input.mapping.everyRow ?? {}).filter(([key, value]) => {
          const f = defs.find((d) => d.key === key);
          return (
            f?.everyRow &&
            !fields[key] &&
            (f.choices ?? []).some((c) => c.value === value)
          );
        })
      );
      for (const f of defs.filter((d) => d.required))
        if (!fields[f.key] && !everyRow[f.key])
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
        ...(Object.keys(values).length ? { values } : {}),
        ...(Object.keys(everyRow).length ? { everyRow } : {}),
        ...(CASE_HISTORY.has(batch.recordType) && input.mapping.closedBefore
          ? { closedBefore: cutOffDate(input.mapping.closedBefore) }
          : {})
      };

      const table = await readFile(batch.file);
      const all = table.rows.map((cells) =>
        convertRow(batch.recordType, mapping, rowObject(table, cells))
      );
      const decide = await matcher(
        tx,
        { ...batch, mapping },
        all.flatMap((c) =>
          c.action === 'skip' || c.action === 'refuse' ? [] : [c]
        )
      );
      const seen = new Map<string, number>();
      // Open cases already past their deadline, to say before importing.
      let overdue = 0;
      const rows: Array<typeof importRows.$inferInsert> = [];
      for (const [i, converted] of all.entries()) {
        const rowNumber = i + 2;
        if (converted.action === 'skip' || converted.action === 'refuse') {
          rows.push({
            organisationId: input.organisationId,
            batchId: batch.id,
            rowNumber,
            sourceRef:
              converted.action === 'refuse' ? converted.sourceRef : null,
            action: converted.action,
            reason:
              converted.action === 'refuse'
                ? converted.reason
                : 'The row is empty.'
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
        // Only new ones: a case imported before is already raising its tasks.
        if (
          decision.action === 'create' &&
          (decision.request ?? decision.breach ?? decision.complaint)?.overdue
        )
          overdue += 1;
        rows.push({
          organisationId: input.organisationId,
          batchId: batch.id,
          rowNumber,
          sourceRef: converted.sourceRef,
          ...(decision.action === 'refuse' || decision.action === 'skip'
            ? { action: decision.action, reason: decision.reason }
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
          valuesFound: valuesIn(table, batch.recordType, mapping),
          previewNotes: CASE_HISTORY.has(batch.recordType) ? { overdue } : null
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
    'assessmentId',
    ...IMPORT_KEYS
  ],
  data_subject_request: [
    'jurisdiction',
    'regime',
    'rights',
    'channel',
    'receivedAt',
    'description',
    'requesterName',
    'requesterContact',
    'representative',
    'identityRequestedAt',
    'identityVerifiedAt',
    'identityMethod',
    'status',
    'ownerId',
    'respondedAt',
    'responseSummary',
    'closedAt',
    'closureRationale',
    ...IMPORT_KEYS
  ],
  data_protection_complaint: [
    'jurisdiction',
    'controllerRole',
    'channel',
    'receivedAt',
    'subject',
    'description',
    'complainantName',
    'complainantContact',
    'representative',
    'requestId',
    'status',
    'ownerId',
    'acknowledgedAt',
    'acknowledgementChannel',
    'acknowledgementLateReason',
    'outcome',
    'outcomeAt',
    'outcomeChannel',
    'outcomeSummary',
    'remedialAction',
    'toldOfRegulatorRight',
    'outcomeLateReason',
    'closedAt',
    'closureRationale',
    ...IMPORT_KEYS
  ],
  breach: [
    'title',
    'description',
    'controllerRole',
    'regime',
    'laws',
    'affectedStates',
    'discoveredAt',
    'occurredAt',
    'containedAt',
    'categories',
    'subjectsAffected',
    'recordsAffected',
    'specialCategory',
    'likelyConsequences',
    'measuresTaken',
    'dataUnintelligible',
    'pecrServiceBreach',
    'status',
    'ownerId',
    'closedAt',
    'closureRationale',
    ...IMPORT_KEYS
  ],
  assessment: [
    'title',
    'subjectType',
    'subjectId',
    'ownerId',
    'status',
    'importedOutcome',
    'submittedAt',
    'completedAt',
    'reviewDueAt',
    'sourceHistory',
    'sourceAnswers',
    ...IMPORT_KEYS
  ],
  policy_document: [
    'title',
    'version',
    'ownerId',
    'conditions',
    'lastReviewedAt',
    'withdrawnAt',
    ...IMPORT_KEYS
  ],
  policy: [
    'title',
    'summary',
    'ownerId',
    'status',
    'reviewIntervalMonths',
    'nextReviewAt',
    'lastReviewedAt',
    'withdrawnAt',
    'withdrawnReason',
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
  'implementedAt',
  'lastReviewedAt',
  'withdrawnAt',
  'submittedAt',
  'completedAt',
  'receivedAt',
  'identityRequestedAt',
  'identityVerifiedAt',
  'respondedAt',
  'discoveredAt',
  'occurredAt',
  'containedAt',
  'acknowledgedAt',
  'outcomeAt'
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
  mitigation: mitigations,
  policy_document: policyDocuments,
  policy: policies,
  assessment: assessments,
  data_subject_request: dataSubjectRequests,
  breach: breaches,
  data_protection_complaint: dataProtectionComplaints
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
  decision: Exclude<Decision, { action: 'refuse' | 'skip' }>;
  /** The platform the batch came from, as named here. */
  sourceName: string;
  /** The entity's default regime, for a new processing activity. */
  regime?: (typeof processingActivities.$inferInsert)['regime'] | null;
  /** The entity's data protection law: a new activity takes it, and bases are read under it. */
  law?: (typeof processingActivities.$inferInsert)['laws'] | null;
  /** Imported templates found or made in this import, by kind. */
  importedTemplates?: Map<string, string>;
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
  subject: {
    type:
      | 'dpa'
      | 'evidence'
      | 'policy_document'
      | 'policy'
      | 'assessment'
      | 'data_subject_request'
      | 'breach'
      | 'data_protection_complaint';
    id: string;
    /** The entity the file is for, where the record has one. */
    entityId?: string | null;
  },
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
    entityId:
      subject.type === 'evidence'
        ? c.batch.entityId
        : (subject.entityId ?? null),
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
    case 'policy_document':
      return writePolicyDocument(c, record);
    case 'policy':
      return writePolicy(c, record);
    case 'assessment':
      return writeAssessment(c, record);
    case 'data_subject_request':
      return writeRequest(c, record);
    case 'breach':
      return writeBreach(c, record);
    case 'data_protection_complaint':
      return writeComplaint(c, record);
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
    if (link.kind === 'risk_assessment') {
      await tx
        .update(risks)
        .set({ assessmentId: null })
        .where(and(eq(risks.id, link.from), eq(risks.assessmentId, link.to)));
      continue;
    }
    if (link.kind === 'policy_activity') {
      await tx
        .delete(policyActivities)
        .where(
          and(
            eq(policyActivities.policyId, link.from),
            eq(policyActivities.activityId, link.to)
          )
        );
      continue;
    }
    if (link.kind === 'policy_ai_system') {
      await tx
        .delete(policyAiSystems)
        .where(
          and(
            eq(policyAiSystems.policyId, link.from),
            eq(policyAiSystems.aiUseCaseId, link.to)
          )
        );
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

/** Where a risk keeps the assessment it named there, until that is imported. */
const RISK_ASSESSMENT_KEY = 'Assessment there';

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
  // Linked to the assessment it named there, where that is imported and
  // nothing here has linked it to another.
  const raisedFrom =
    resolved.assessmentId && !was?.assessmentId
      ? { assessmentId: resolved.assessmentId }
      : {};
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
    ...(data.status === 'accepted' ? { Status: 'Accepted' } : {}),
    ...(data.assessment ? { [RISK_ASSESSMENT_KEY]: data.assessment } : {})
  };
  const kept = provenance(c, { ...record, legacy });
  let id: string;
  if (c.decision.recordId) {
    // What the file leaves out stays as recorded, its history included.
    await c.tx
      .update(risks)
      .set({ ...said(described), ...owner, ...raisedFrom, ...kept })
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
        ...raisedFrom,
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

/**
 * A data subject request handled in another platform, from a checked row,
 * with its real dates. Written directly, as every import is: no
 * acknowledgement goes to the requester, no webhook or notification is sent,
 * and no search scope is seeded. What moved its clock there comes in as
 * decisions, dated when they took effect, said to have been made there, and
 * marked with this import; they are written when the request first comes in,
 * and a later import leaves them as they are.
 */
async function writeRequest(
  c: WriteContext,
  record: Of<'data_subject_request'>
): Promise<Written> {
  const resolved = c.decision.request!;
  const { data } = record;
  const at = (iso?: string) => (iso ? new Date(iso) : null);
  const was = c.decision.recordId
    ? await rowBefore(c, 'data_subject_request', c.decision.recordId)
    : null;
  const described = {
    jurisdiction: resolved.jurisdiction,
    regime: resolved.regime,
    rights: resolved.rights,
    channel: data.channel,
    receivedAt: new Date(data.receivedAt),
    description: data.description,
    requesterName: data.requesterName,
    requesterContact: data.requesterContact ?? null,
    representative: data.representative ?? null,
    identityRequestedAt: at(data.identityRequestedAt),
    identityVerifiedAt: at(data.identityVerifiedAt),
    identityMethod: data.identityMethod ?? null,
    status: resolved.status,
    respondedAt: at(data.respondedAt),
    responseSummary: data.responseSummary ?? null,
    closedAt: at(data.closedAt),
    closureRationale: data.closureRationale ?? null
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const kept = provenance(c, {
    ...record,
    legacy: {
      ...record.legacy,
      ...(data.owner && !resolved.ownerId ? { Handler: data.owner } : {})
    }
  });
  let id: string;
  if (c.decision.recordId) {
    await c.tx
      .update(dataSubjectRequests)
      .set({ ...said(described), ...owner, ...kept })
      .where(eq(dataSubjectRequests.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      'DSR',
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(dataSubjectRequests)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        reference,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...described,
        // Required here; a source that kept neither still had a request.
        // Read as "received on <date> by <channel>".
        channel:
          described.channel ?? `a channel ${c.sourceName} did not record`,
        description:
          described.description ??
          `Imported from ${c.sourceName}, which did not export what was asked.`,
        ...owner,
        ...kept
      })
      .returning({ id: dataSubjectRequests.id });
    id = created.id;
    const made = (
      kind: 'clarification_requested' | 'clarification_received' | 'extension',
      effectiveAt: Date,
      rationale: string,
      statutoryBasis: string
    ) => ({
      organisationId: c.batch.organisationId,
      requestId: id,
      kind,
      rationale,
      statutoryBasis,
      effectiveAt,
      decidedByLabel: `In ${c.sourceName}`,
      decidedAt: c.at,
      importBatchId: c.batch.id
    });
    const decisions = [
      ...(data.clarificationRequestedAt
        ? [
            made(
              'clarification_requested',
              new Date(data.clarificationRequestedAt),
              `Clarification asked for, as ${c.sourceName} recorded it.`,
              'Article 12(3A)'
            )
          ]
        : []),
      ...(data.clarificationReceivedAt
        ? [
            made(
              'clarification_received',
              new Date(data.clarificationReceivedAt),
              `Clarification received, as ${c.sourceName} recorded it.`,
              'Article 12(3A)'
            )
          ]
        : []),
      ...(data.extendedAt
        ? [
            made(
              'extension',
              new Date(data.extendedAt),
              data.extensionReason ??
                `Extended, as ${c.sourceName} recorded it; it gave no reason.`,
              'Article 12(3)'
            )
          ]
        : [])
    ];
    if (decisions.length)
      await c.tx.insert(dataSubjectRequestDecisions).values(decisions);
  }
  const earlier = was
    ? await earlierImports(c, 'data_subject_request', id)
    : null;
  const { documentId } = await attachImportFile(
    c,
    data.file,
    { type: 'data_subject_request', id, entityId: c.batch.entityId },
    earlier?.documentIds
  );
  // The requester's name and contact stay out of the audit chain, as for a
  // request recorded here.
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'dsr.updated' : 'dsr.recorded',
    subjectType: 'data_subject_request',
    subjectId: id,
    after: {
      rights: resolved.rights,
      receivedAt: data.receivedAt,
      jurisdiction: resolved.jurisdiction,
      status: resolved.status,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return {
    id,
    before: was && snapshot(was, KEYS.data_subject_request),
    documentId
  };
}

/**
 * A breach handled in another platform, written with its real dates. Nobody
 * is notified and no task is raised here; the sweep reads its clocks from
 * those dates afterwards. Who was told there comes in as decisions, completed
 * on the dates the source gave, said to have been made there, and marked with
 * this import. A later import adds what the source has recorded since and
 * leaves the rest as they came in.
 */
async function writeBreach(
  c: WriteContext,
  record: Of<'breach'>
): Promise<Written> {
  const resolved = c.decision.breach!;
  const { data } = record;
  const at = (iso?: string) => (iso ? new Date(iso) : null);
  const was = c.decision.recordId
    ? await rowBefore(c, 'breach', c.decision.recordId)
    : null;
  const described = {
    title: data.title,
    description: data.description,
    controllerRole: data.controllerRole,
    regime: resolved.regime,
    laws: resolved.laws,
    affectedStates: resolved.affectedStates,
    discoveredAt: new Date(data.discoveredAt),
    occurredAt: at(data.occurredAt),
    containedAt: at(data.containedAt),
    categories: resolved.categories,
    subjectsAffected: data.subjectsAffected ?? null,
    recordsAffected: data.recordsAffected ?? null,
    specialCategory: data.specialCategory ?? null,
    likelyConsequences: data.likelyConsequences ?? null,
    measuresTaken: data.measuresTaken ?? null,
    dataUnintelligible: data.dataUnintelligible ?? null,
    pecrServiceBreach: data.pecrServiceBreach ?? null,
    status: resolved.status,
    closedAt: at(data.closedAt),
    closureRationale: data.closureRationale ?? null
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const kept = provenance(c, {
    ...record,
    legacy: {
      ...record.legacy,
      ...(data.owner && !resolved.ownerId ? { Handler: data.owner } : {})
    }
  });
  let id: string;
  if (c.decision.recordId) {
    // Its dates follow the source exactly, emptied ones too: the clocks
    // and the sweep read them.
    await c.tx
      .update(breaches)
      .set({
        ...said(described),
        occurredAt: described.occurredAt,
        containedAt: described.containedAt,
        closedAt: described.closedAt,
        ...owner,
        ...kept
      })
      .where(eq(breaches.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      'BR',
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(breaches)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        reference,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...described,
        controllerRole: described.controllerRole ?? 'controller',
        // Required here; a source that kept none still had a breach.
        description:
          described.description ??
          `Imported from ${c.sourceName}, which did not export what happened.`,
        ...owner,
        ...kept
      })
      .returning({ id: breaches.id });
    id = created.id;
  }
  const part3 = resolved.regime === 'dpa_part3';
  const told = (d: BreachDecisionResolved) => {
    switch (d.kind) {
      case 'supervisory_authority':
        return {
          rationale:
            data.authorityRationale ??
            (d.outcome === 'done'
              ? `Notified, as ${c.sourceName} recorded it.`
              : `Judged not to need notifying, as ${c.sourceName} recorded it; it gave no reason.`),
          statutoryBasis: part3 ? 's.67(1)' : 'Article 33(1)',
          ...(d.outcome === 'done'
            ? {
                recipient: authorityByCode(d.authorityCode)?.name ?? null,
                externalRef: data.authorityRef ?? null,
                lateReason: data.lateReason ?? null
              }
            : {})
        };
      case 'data_subjects':
        return {
          rationale:
            data.subjectsRationale ??
            (d.outcome === 'done'
              ? `The people affected were told, as ${c.sourceName} recorded it.`
              : `Judged not to need telling the people affected, as ${c.sourceName} recorded it; it gave no reason.`),
          statutoryBasis: part3 ? 's.68(1)' : 'Article 34(1)'
        };
      case 'pecr_commissioner':
        return {
          rationale: `The Information Commission was told, as ${c.sourceName} recorded it.`,
          statutoryBasis: 'PECR reg 5A(2)'
        };
    }
  };
  if (resolved.decisions.length)
    await c.tx.insert(breachDecisions).values(
      resolved.decisions.map((d) => ({
        organisationId: c.batch.organisationId,
        breachId: id,
        ...d,
        ...told(d),
        decidedByLabel: `In ${c.sourceName}`,
        decidedAt: c.at,
        importBatchId: c.batch.id
      }))
    );
  const earlier = was ? await earlierImports(c, 'breach', id) : null;
  const { documentId } = await attachImportFile(
    c,
    data.file,
    { type: 'breach', id, entityId: c.batch.entityId },
    earlier?.documentIds
  );
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'breach.updated' : 'breach.recorded',
    subjectType: 'breach',
    subjectId: id,
    after: {
      discoveredAt: data.discoveredAt,
      laws: resolved.laws,
      status: resolved.status,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return { id, before: was && snapshot(was, KEYS.breach), documentId };
}

/**
 * A complaint handled in another platform, written with its real dates.
 * Nothing is sent to the complainant and no task is raised here; the sweep
 * reads its clocks from those dates afterwards. When the complainant heard
 * there comes in as steps, dated as the source gave them, said to have been
 * recorded there, and marked with this import. A later import adds what the
 * source has recorded since and leaves the rest as they came in.
 */
async function writeComplaint(
  c: WriteContext,
  record: Of<'data_protection_complaint'>
): Promise<Written> {
  const resolved = c.decision.complaint!;
  const { data } = record;
  const at = (iso?: string) => (iso ? new Date(iso) : null);
  const was = c.decision.recordId
    ? await rowBefore(c, 'data_protection_complaint', c.decision.recordId)
    : null;
  const described = {
    jurisdiction: resolved.jurisdiction,
    controllerRole: resolved.controllerRole,
    channel: data.channel,
    receivedAt: new Date(data.receivedAt),
    subject: resolved.subject,
    description: data.description,
    complainantName: data.complainantName,
    complainantContact: data.complainantContact ?? null,
    representative: data.representative ?? null,
    requestId: resolved.requestId,
    status: resolved.status,
    acknowledgedAt: resolved.acknowledgedAt,
    acknowledgementChannel: resolved.acknowledgementChannel,
    // Only where it was late, as recording it here keeps them; where the
    // source gave no reason, the record says so rather than nothing.
    acknowledgementLateReason: resolved.acknowledgedLate
      ? (data.acknowledgementLateReason ??
        `${c.sourceName} recorded no reason.`)
      : null,
    outcome: data.outcome ?? null,
    outcomeAt: at(data.outcomeAt),
    outcomeChannel: data.outcomeChannel ?? null,
    outcomeSummary:
      data.outcomeSummary ??
      (data.outcome
        ? `${OUTCOME_LABEL[data.outcome]}, as ${c.sourceName} recorded it; it gave no summary.`
        : null),
    remedialAction: data.remedialAction ?? null,
    toldOfRegulatorRight: data.toldOfRegulatorRight ?? null,
    outcomeLateReason: resolved.outcomeLate
      ? (data.outcomeLateReason ?? `${c.sourceName} recorded no reason.`)
      : null,
    closedAt: at(data.closedAt),
    closureRationale: data.closureRationale ?? null
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const kept = provenance(c, {
    ...record,
    legacy: {
      ...record.legacy,
      ...(data.owner && !resolved.ownerId ? { Handler: data.owner } : {})
    }
  });
  let id: string;
  if (c.decision.recordId) {
    // Its status and closing date follow the source exactly: the clocks and
    // the sweep read them.
    await c.tx
      .update(dataProtectionComplaints)
      .set({
        ...said(described),
        closedAt: described.closedAt,
        ...owner,
        ...kept
      })
      .where(eq(dataProtectionComplaints.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      'CMP',
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(dataProtectionComplaints)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        reference,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...described,
        // Required here; a source that kept neither still had a complaint.
        channel:
          described.channel ?? `a channel ${c.sourceName} did not record`,
        description:
          described.description ??
          `Imported from ${c.sourceName}, which did not export what was said.`,
        ...owner,
        ...kept
      })
      .returning({ id: dataProtectionComplaints.id });
    id = created.id;
  }
  const noteOf = (kind: ComplaintStep['kind']) => {
    switch (kind) {
      case 'acknowledged':
        return `Acknowledged, as ${c.sourceName} recorded it.`;
      case 'progress_update':
        return `The complainant was updated, as ${c.sourceName} recorded it.`;
      case 'outcome_sent':
        return described.outcomeSummary!;
      case 'withdrawn':
        return (
          data.closureRationale ?? `Withdrawn, as ${c.sourceName} recorded it.`
        );
    }
  };
  if (resolved.steps.length)
    await c.tx.insert(dataProtectionComplaintEvents).values(
      resolved.steps.map((s) => ({
        organisationId: c.batch.organisationId,
        complaintId: id,
        kind: s.kind,
        note: noteOf(s.kind),
        channel: s.channel,
        occurredAt: s.occurredAt,
        recordedByLabel: `In ${c.sourceName}`,
        recordedAt: c.at,
        importBatchId: c.batch.id
      }))
    );
  const earlier = was
    ? await earlierImports(c, 'data_protection_complaint', id)
    : null;
  const { documentId } = await attachImportFile(
    c,
    data.file,
    { type: 'data_protection_complaint', id, entityId: c.batch.entityId },
    earlier?.documentIds
  );
  // The complainant's name, contact and words stay out of the audit chain,
  // as for a complaint recorded here.
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'complaint.updated' : 'complaint.recorded',
    subjectType: 'data_protection_complaint',
    subjectId: id,
    after: {
      subject: resolved.subject,
      receivedAt: data.receivedAt,
      jurisdiction: resolved.jurisdiction,
      status: resolved.status,
      requestId: resolved.requestId,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return {
    id,
    before: was && snapshot(was, KEYS.data_protection_complaint),
    documentId
  };
}

const TEMPLATE_KIND_NAME: Record<Of<'assessment'>['data']['kind'], string> = {
  dpia: 'DPIA',
  lia: 'Legitimate interests assessment',
  tia: 'Transfer impact assessment',
  tra: 'Transfer risk assessment',
  ai_risk: 'AI risk assessment',
  screening: 'Screening',
  eia: 'Equality impact assessment',
  custom: 'Assessment'
};

/**
 * The template an imported assessment of a kind sits on: one per kind, with
 * no questions of its own, made the first time it is needed. Its one version
 * is retired from the start, so nothing new is ever started from it.
 */
async function importedTemplateVersion(
  c: WriteContext,
  kind: Of<'assessment'>['data']['kind']
): Promise<string> {
  const known = c.importedTemplates?.get(kind);
  if (known) return known;
  const name = `Imported from another platform: ${TEMPLATE_KIND_NAME[kind]}`;
  await c.tx
    .insert(templates)
    .values({
      organisationId: c.batch.organisationId,
      kind,
      name,
      description:
        "Holds assessments done in another platform, with that platform's questions and answers kept as they were asked. Not for new assessments.",
      isSystem: true
    })
    .onConflictDoNothing();
  const [template] = await c.tx
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.organisationId, c.batch.organisationId),
        eq(templates.name, name)
      )
    );
  await c.tx
    .insert(templateVersions)
    .values({
      templateId: template.id,
      version: 1,
      status: 'retired',
      definition: {
        schema: {
          sections: [
            {
              key: 'imported',
              title: 'Asked in another platform',
              description:
                'The questions and answers are kept with each assessment, as that platform asked them.',
              questions: [
                {
                  key: 'imported',
                  label: 'Kept with the assessment',
                  type: 'long_text',
                  required: false,
                  legalRefs: [],
                  evidence: 'none'
                }
              ]
            }
          ]
        },
        scoring: { method: 'none' }
      },
      notes: 'Made by the importer.',
      // Published and retired together: frozen, and never offered.
      publishedAt: c.at,
      retiredAt: c.at
    })
    .onConflictDoNothing();
  const [version] = await c.tx
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.templateId, template.id),
        eq(templateVersions.version, 1)
      )
    );
  c.importedTemplates?.set(kind, version.id);
  return version.id;
}

type AssessmentStatus = (typeof assessments.$inferSelect)['status'];

/** What the old platform recorded of an assessment's outcome: its account. */
function assessmentHistory(
  data: Of<'assessment'>['data'],
  source: string
): SourceEvent[] {
  if (data.outcome === 'unfinished')
    return [{ at: data.submittedAt ?? null, what: `Unfinished in ${source}` }];
  const what = {
    approved: 'Approved',
    rejected: 'Rejected',
    superseded: 'Superseded',
    withdrawn: 'Withdrawn'
  }[data.outcome];
  return [
    {
      at: data.completedAt ?? null,
      what: `${what} in ${source}`,
      ...(data.approvedBy ? { by: data.approvedBy } : {})
    }
  ];
}

/**
 * An assessment done in another platform, from a checked row: read only, on
 * the imported template of its kind, with its questions and answers kept as
 * that platform asked them (the columns no field reads). It waits, as
 * "imported", for a person here to confirm it; then it takes the outcome the
 * source gave it, and only then counts as an approved assessment anywhere.
 */
async function writeAssessment(
  c: WriteContext,
  record: Of<'assessment'>
): Promise<Written> {
  const resolved = c.decision.assessment!;
  const { data } = record;
  const was = c.decision.recordId
    ? await rowBefore(c, 'assessment', c.decision.recordId)
    : null;
  const outcome: AssessmentStatus =
    data.outcome === 'unfinished' ? 'withdrawn' : data.outcome;
  const sourceAnswers: SourceAnswer[] = data.answers;
  const described = {
    title: data.title,
    subjectType: resolved.subject?.type ?? null,
    subjectId: resolved.subject?.id ?? null,
    status: 'imported' as const,
    importedOutcome: outcome,
    submittedAt: data.submittedAt ? new Date(data.submittedAt) : null,
    completedAt: data.completedAt ? new Date(data.completedAt) : null,
    reviewDueAt: data.reviewDueAt ? new Date(data.reviewDueAt) : null,
    sourceHistory: assessmentHistory(data, c.sourceName),
    sourceAnswers: sourceAnswers.length ? sourceAnswers : null
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const kept = provenance(c, {
    ...record,
    legacy: data.owner && !resolved.ownerId ? { Owner: data.owner } : {}
  });
  let id: string;
  if (c.decision.recordId) {
    await c.tx
      .update(assessments)
      .set({ ...said(described), ...owner, ...kept })
      .where(eq(assessments.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const templateVersionId = await importedTemplateVersion(c, data.kind);
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      referencePrefixFor(data.kind),
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(assessments)
      .values({
        organisationId: c.batch.organisationId,
        entityId: c.batch.entityId!,
        templateVersionId,
        reference,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...described,
        ...owner,
        ...kept
      })
      .returning({ id: assessments.id });
    id = created.id;
  }
  // Risks imported from this source that named this assessment there now
  // point at it, where nothing here has said otherwise.
  const named = await c.tx
    .update(risks)
    .set({ assessmentId: id })
    .where(
      and(
        eq(risks.organisationId, c.batch.organisationId),
        eq(risks.entityId, c.batch.entityId!),
        eq(risks.importSourceId, c.batch.sourceId),
        isNull(risks.assessmentId),
        sql`lower(${risks.legacy} ->> ${RISK_ASSESSMENT_KEY}) = lower(${c.sourceRef})`
      )
    )
    .returning({ id: risks.id });
  const links: ImportLink[] = named.map((r) => ({
    kind: 'risk_assessment',
    from: r.id,
    to: id
  }));
  const earlier = was ? await earlierImports(c, 'assessment', id) : null;
  const { documentId } = await attachImportFile(
    c,
    data.file,
    { type: 'assessment', id, entityId: c.batch.entityId },
    earlier?.documentIds
  );
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: c.batch.entityId ?? undefined,
    action: was ? 'assessment.updated' : 'assessment.created',
    subjectType: 'assessment',
    subjectId: id,
    after: {
      title: data.title,
      status: 'imported',
      outcome,
      answers: sourceAnswers.length,
      risksLinked: links.length,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return {
    id,
    before: was && snapshot(was, KEYS.assessment),
    documentId,
    links
  };
}

/** An appropriate policy document, from a checked row. */
async function writePolicyDocument(
  c: WriteContext,
  record: Of<'policy_document'>
): Promise<Written> {
  const resolved = c.decision.policy!;
  const { data } = record;
  const was = c.decision.recordId
    ? await rowBefore(c, 'policy_document', c.decision.recordId)
    : null;
  const described = {
    title: data.title,
    version: data.version ?? null,
    conditions: resolved.conditions,
    lastReviewedAt: data.lastReviewedAt ? new Date(data.lastReviewedAt) : null,
    withdrawnAt: data.withdrawnAt ? new Date(data.withdrawnAt) : null
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const kept = provenance(c, {
    ...record,
    legacy: {
      ...record.legacy,
      ...(data.owner && !resolved.ownerId ? { Owner: data.owner } : {})
    }
  });
  let id: string;
  if (c.decision.recordId) {
    await c.tx
      .update(policyDocuments)
      .set({ ...said(described), ...owner, ...kept })
      .where(eq(policyDocuments.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const [created] = await c.tx
      .insert(policyDocuments)
      .values({
        organisationId: c.batch.organisationId,
        entityId: resolved.entityId,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...described,
        ...owner,
        ...kept
      })
      .returning({ id: policyDocuments.id });
    id = created.id;
  }
  const earlier = was ? await earlierImports(c, 'policy_document', id) : null;
  const { documentId } = await attachImportFile(
    c,
    data.file,
    { type: 'policy_document', id, entityId: resolved.entityId },
    earlier?.documentIds
  );
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: resolved.entityId ?? undefined,
    action: was ? 'policy_document.updated' : 'policy_document.created',
    subjectType: 'policy_document',
    subjectId: id,
    after: {
      title: data.title,
      conditions: resolved.conditions,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return {
    id,
    before: was && snapshot(was, KEYS.policy_document),
    documentId
  };
}

type PolicyStatus = (typeof policies.$inferSelect)['status'];

/** What the old platform recorded of a policy's approval: its account, not ours. */
function policyHistory(
  data: Of<'policy'>['data'],
  source: string
): SourceEvent[] | null {
  if (!data.approvedBy && !data.approvedAt && !data.approvalReference)
    return null;
  return [
    {
      at: data.approvedAt ?? null,
      what: data.version
        ? `Version ${data.version} approved in ${source}`
        : `Approved in ${source}`,
      ...(data.approvedBy ? { by: data.approvedBy } : {}),
      ...(data.approvalReference ? { detail: data.approvalReference } : {})
    }
  ];
}

const addMonths = (d: Date, months: number) => {
  const next = new Date(d);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

/**
 * A policy on the general register, from a checked row. In force there is in
 * force here, as a fact about the organisation, but with no version approved
 * here: approval is a decision with its own checks, so the source's is kept
 * as its history. Once a version has been drafted here, the register's own
 * cycle decides its status and review dates, and a re-import leaves them.
 */
async function writePolicy(
  c: WriteContext,
  record: Of<'policy'>
): Promise<Written> {
  const resolved = c.decision.policy!;
  const { data } = record;
  const was = c.decision.recordId
    ? await rowBefore(c, 'policy', c.decision.recordId)
    : null;
  const [versioned] = c.decision.recordId
    ? await c.tx
        .select({ id: policyVersions.id })
        .from(policyVersions)
        .where(eq(policyVersions.policyId, c.decision.recordId))
        .limit(1)
    : [];
  const interval =
    data.reviewIntervalMonths ??
    (was?.reviewIntervalMonths as number | undefined) ??
    12;
  const lastReviewedAt = data.lastReviewedAt
    ? new Date(data.lastReviewedAt)
    : null;
  // The next review the source gave, or the one its own dates imply, as
  // approving here sets it: never a date counted from the import.
  const reviewedOrApproved =
    lastReviewedAt ?? (data.approvedAt ? new Date(data.approvedAt) : null);
  // What the row says, or what the policy already is when it does not say.
  const status = (data.status ??
    (was?.status as PolicyStatus | undefined) ??
    'draft') as PolicyStatus;
  const nextReviewAt = data.nextReviewAt
    ? new Date(data.nextReviewAt)
    : status === 'in_force' && reviewedOrApproved
      ? addMonths(reviewedOrApproved, interval)
      : null;
  // A status the row states brings the fields that go with it, as
  // withdrawing or approving here does: a policy back in force is no longer
  // withdrawn, and a withdrawn one has no review coming. These are written
  // even when empty, which the file's other empty cells are not.
  const settled: Partial<typeof policies.$inferInsert> =
    data.status === 'withdrawn'
      ? { nextReviewAt: null }
      : data.status
        ? { withdrawnAt: null, withdrawnReason: null }
        : {};
  const cycle = versioned
    ? {}
    : {
        status,
        nextReviewAt,
        lastReviewedAt,
        withdrawnAt: data.withdrawnAt ? new Date(data.withdrawnAt) : null,
        withdrawnReason: data.withdrawnReason ?? null
      };
  const described = {
    title: data.title,
    summary: data.summary ?? null,
    reviewIntervalMonths: interval,
    sourceHistory: policyHistory(data, c.sourceName),
    ...cycle
  };
  const owner = resolved.ownerId ? { ownerId: resolved.ownerId } : {};
  const kept = provenance(c, {
    ...record,
    legacy: {
      ...record.legacy,
      ...(data.owner && !resolved.ownerId ? { Owner: data.owner } : {}),
      ...(data.version ? { 'Version there': data.version } : {})
    }
  });
  let id: string;
  if (c.decision.recordId) {
    await c.tx
      .update(policies)
      .set({
        ...said(described),
        ...(versioned ? {} : settled),
        ...owner,
        ...kept
      })
      .where(eq(policies.id, c.decision.recordId));
    id = c.decision.recordId;
  } else {
    const reference = await nextReference(
      c.tx,
      c.batch.organisationId,
      'POL',
      c.at.getUTCFullYear()
    );
    const [created] = await c.tx
      .insert(policies)
      .values({
        organisationId: c.batch.organisationId,
        entityId: resolved.entityId,
        reference,
        importSourceId: c.batch.sourceId,
        externalRef: c.sourceRef,
        createdAt: c.at,
        ...said(described),
        title: data.title,
        ...owner,
        ...kept
      })
      .returning({ id: policies.id });
    id = created.id;
  }
  // Links are added, never taken away, as for assets.
  const links: ImportLink[] = [];
  for (const activityId of resolved.activityIds) {
    const made = await c.tx
      .insert(policyActivities)
      .values({
        organisationId: c.batch.organisationId,
        policyId: id,
        activityId
      })
      .onConflictDoNothing()
      .returning();
    if (made.length)
      links.push({ kind: 'policy_activity', from: id, to: activityId });
  }
  for (const aiUseCaseId of resolved.aiSystemIds) {
    const made = await c.tx
      .insert(policyAiSystems)
      .values({
        organisationId: c.batch.organisationId,
        policyId: id,
        aiUseCaseId
      })
      .onConflictDoNothing()
      .returning();
    if (made.length)
      links.push({ kind: 'policy_ai_system', from: id, to: aiUseCaseId });
  }
  const earlier = was ? await earlierImports(c, 'policy', id) : null;
  const { documentId } = await attachImportFile(
    c,
    data.file,
    { type: 'policy', id, entityId: resolved.entityId },
    earlier?.documentIds
  );
  await appendAuditEvent(c.tx, {
    ...c.actor,
    organisationId: c.batch.organisationId,
    entityId: resolved.entityId ?? undefined,
    action: was ? 'policy.updated' : 'policy.created',
    subjectType: 'policy',
    subjectId: id,
    after: {
      title: data.title,
      status: described.status ?? (was?.status as string | undefined) ?? null,
      linked: links.length,
      imported: { batch: c.batch.id, ref: c.sourceRef }
    }
  });
  return {
    id,
    before: was && snapshot(was, KEYS.policy),
    documentId,
    links
  };
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
      const decide = await matcher(
        tx,
        batch,
        rows.flatMap((r) =>
          r.record && r.sourceRef
            ? [{ record: r.record, sourceRef: r.sourceRef }]
            : []
        )
      );
      const importedTemplates = new Map<string, string>();
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
        if (decision.action === 'refuse' || decision.action === 'skip') {
          // Changed since the preview: say so on the row, write nothing.
          actions.push(decision.action);
          await tx
            .update(importRows)
            .set({
              action: decision.action,
              reason: decision.reason,
              recordId: null
            })
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
            law: entity?.dataProtectionLaw,
            importedTemplates
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
  // A comment, or a task somebody picked up, finished or sent to another
  // tracker, is work on the record. An open task nobody has touched is not:
  // undo takes those away first.
  const [w] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(
      and(eq(comments.subjectType, table), inArray(comments.subjectId, ids))
    );
  const [t] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.subjectType, table), inArray(tasks.subjectId, ids)));
  return n + a.n + d.n + l.n + w.n + t.n;
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
      // Decisions the import brought in with its cases are its own, not work
      // done since; one recorded here since still counts below.
      if (kind === 'data_subject_request')
        await tx
          .delete(dataSubjectRequestDecisions)
          .where(eq(dataSubjectRequestDecisions.importBatchId, batch.id));
      if (kind === 'breach')
        await tx
          .delete(breachDecisions)
          .where(eq(breachDecisions.importBatchId, batch.id));
      if (kind === 'data_protection_complaint')
        await tx
          .delete(dataProtectionComplaintEvents)
          .where(eq(dataProtectionComplaintEvents.importBatchId, batch.id));
      const created = rows
        .filter((r) => r.action === 'create')
        .map((r) => r.recordId!);
      // The AI register keeps every system's stage history for good, so a
      // system once registered is retired, never removed.
      if (kind === 'ai_use_case' && created.length)
        throw new ImportRefused(
          `It registered ${created.length} AI system${created.length === 1 ? '' : 's'}. The AI register keeps every system's history, so ${created.length === 1 ? 'it' : 'they'} cannot be taken back out; retire any registered in error from ${created.length === 1 ? 'its' : 'their'} page.`
        );
      // The sweep raises deadline tasks from an imported case's dates as soon
      // as it runs. Those are the import's doing too, while nobody has picked
      // them up or sent them to another tracker.
      if (created.length)
        await tx
          .delete(tasks)
          .where(
            and(
              eq(tasks.subjectType, kind),
              inArray(tasks.subjectId, created),
              eq(tasks.status, 'open'),
              isNull(tasks.externalId)
            )
          );
      const linked = await referencesTo(tx, kind, created);
      if (linked > 0)
        throw new ImportRefused(
          'Some of the records it created are now linked to other records, such as an assessment, an agreement or a file, or have been worked on through a task or a comment, so it can no longer be undone as a whole.'
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
  | 'mitigation'
  | 'policy_document'
  | 'policy'
  | 'assessment'
  | 'data_subject_request'
  | 'breach'
  | 'data_protection_complaint';

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
        .set({
          importConfirmedAt: at,
          updatedAt: at,
          // An assessment takes the outcome the source gave it, and from now
          // counts as that outcome everywhere.
          ...(input.type === 'assessment'
            ? {
                status: sql`coalesce(${assessments.importedOutcome}, ${assessments.status})`
              }
            : {})
        })
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
