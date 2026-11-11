import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import {
  assessments,
  documents,
  entities,
  importBatches,
  importMappings,
  importRows,
  importSources,
  processingActivities,
  recordLinks,
  suppliers
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { basesFromText } from '@/lib/gdpr/lawful-basis';
import {
  convertRow,
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

import { nextReference } from './ingest';
import { cleanLawfulBases } from './ropa';
import type { Actor } from './templates';
import { canonicalise } from './third-party';

/**
 * Moving records in from another platform: upload, match columns to fields,
 * preview every row's outcome, import, and undo. See docs/migration-plan.md.
 *
 * An import writes as one step: every row of the preview, or nothing. Each
 * record keeps the platform and batch it came from, its identifier there, and
 * the source's fields with no home here; an imported activity counts as
 * history until a person confirms it, as an imported supplier does.
 */

export class ImportRefused extends Error {}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Action = 'create' | 'update' | 'merge' | 'refuse' | 'skip';
type Counts = Partial<Record<Action, number>>;

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
      if (input.recordType === 'processing_activity') {
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
      const [found] = await tx
        .select()
        .from(importSources)
        .where(
          and(
            eq(importSources.organisationId, input.organisationId),
            sql`lower(${importSources.name}) = lower(${sourceName})`
          )
        );
      const source =
        found ??
        (
          await tx
            .insert(importSources)
            .values({ organisationId: input.organisationId, name: sourceName })
            .returning()
        )[0];
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
 * One batch with its rows, and the matching to offer: the batch's own, else
 * the one last used for this platform and record type, else a guess by name.
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
    const [rows, [saved]] = await Promise.all([
      db
        .select({
          id: importRows.id,
          rowNumber: importRows.rowNumber,
          sourceRef: importRows.sourceRef,
          action: importRows.action,
          reason: importRows.reason,
          recordId: importRows.recordId
        })
        .from(importRows)
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
        )
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
    return { batch, rows, mapping };
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

/** What one checked row would do now: create, update, or add to a supplier. */
async function decide(
  tx: Tx,
  batch: { organisationId: string; sourceId: string; recordType: RecordType },
  record: ImportRecord,
  sourceRef: string
): Promise<{ action: 'create' | 'update' | 'merge'; recordId: string | null }> {
  if (batch.recordType === 'processing_activity') {
    const [existing] = await tx
      .select({ id: processingActivities.id })
      .from(processingActivities)
      .where(
        and(
          eq(processingActivities.organisationId, batch.organisationId),
          eq(processingActivities.importSourceId, batch.sourceId),
          eq(processingActivities.externalRef, sourceRef)
        )
      );
    return existing
      ? { action: 'update', recordId: existing.id }
      : { action: 'create', recordId: null };
  }
  const [own] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.organisationId, batch.organisationId),
        eq(suppliers.importSourceId, batch.sourceId),
        eq(suppliers.externalRef, sourceRef)
      )
    );
  if (own) return { action: 'update', recordId: own.id };
  const [same] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.organisationId, batch.organisationId),
        eq(suppliers.canonicalKey, canonicalise(record.data.name))
      )
    );
  return same
    ? { action: 'merge', recordId: same.id }
    : { action: 'create', recordId: null };
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
        const key =
          batch.recordType === 'supplier'
            ? canonicalise(converted.record.data.name)
            : converted.sourceRef.toLowerCase();
        const first = seen.get(key);
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
        seen.set(key, rowNumber);
        const { action, recordId } = await decide(
          tx,
          batch,
          converted.record,
          converted.sourceRef
        );
        rows.push({
          organisationId: input.organisationId,
          batchId: batch.id,
          rowNumber,
          sourceRef: converted.sourceRef,
          action,
          record: converted.record,
          recordId
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
  data: Extract<ImportRecord, { kind: 'processing_activity' }>['data']
) {
  const bases = basesFromText(data.lawfulBasis);
  return {
    name: data.name,
    description: data.description ?? null,
    purposes: data.purposes,
    lawfulBasis: data.lawfulBasis ?? null,
    ...(bases ? cleanLawfulBases(bases, null) : {}),
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

/** The fields of a row as JSON, to put back on undo. */
const snapshot = (row: Record<string, unknown>, keys: string[]) =>
  JSON.parse(
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, row[k] ?? null])))
  ) as Record<string, unknown>;

const ACTIVITY_KEYS = [
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
  'legacy',
  'importBatchId',
  'importConfirmedAt',
  'updatedAt'
];

const SUPPLIER_KEYS = [
  'description',
  'categories',
  'legacy',
  'importBatchId',
  'importSourceId',
  'externalRef',
  'reviewedAt',
  'reviewedBy',
  'updatedAt'
];

const DATE_KEYS = new Set([
  'reviewDueAt',
  'importConfirmedAt',
  'reviewedAt',
  'updatedAt'
]);

/** A snapshot read back into column values. */
const restore = (before: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(before).map(([k, v]) => [
      k,
      DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : v
    ])
  );

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
            .select({ defaultRegime: entities.defaultRegime })
            .from(entities)
            .where(eq(entities.id, batch.entityId))
        : [];
      const at = new Date();
      const year = at.getUTCFullYear();
      const actions: Action[] = [];

      for (const row of rows) {
        if (!row.record || !row.sourceRef) {
          actions.push(row.action);
          continue;
        }
        const record = row.record;
        const { action, recordId } = await decide(
          tx,
          batch,
          record,
          row.sourceRef
        );
        let id: string;
        let before: Record<string, unknown> | null = null;

        if (record.kind === 'processing_activity') {
          const values = {
            ...activityValues(record.data),
            legacy: record.legacy,
            importBatchId: batch.id,
            // Changed by the import, so it is history again until confirmed.
            importConfirmedAt: null,
            updatedAt: at
          };
          if (action === 'update' && recordId) {
            const [was] = await tx
              .select()
              .from(processingActivities)
              .where(eq(processingActivities.id, recordId));
            before = snapshot(was, ACTIVITY_KEYS);
            await tx
              .update(processingActivities)
              .set(values)
              .where(eq(processingActivities.id, recordId));
            id = recordId;
          } else {
            const reference = await nextReference(
              tx,
              input.organisationId,
              'ROPA',
              year
            );
            const [created] = await tx
              .insert(processingActivities)
              .values({
                organisationId: input.organisationId,
                entityId: batch.entityId!,
                reference,
                regime: entity?.defaultRegime,
                importSourceId: batch.sourceId,
                externalRef: row.sourceRef,
                createdAt: at,
                ...values
              })
              .returning({ id: processingActivities.id });
            id = created.id;
          }
          await appendAuditEvent(tx, {
            ...input.actor,
            organisationId: input.organisationId,
            entityId: batch.entityId ?? undefined,
            action:
              action === 'create'
                ? 'processing_activity.created'
                : 'processing_activity.updated',
            subjectType: 'processing_activity',
            subjectId: id,
            after: {
              name: record.data.name,
              imported: { batch: batch.id, ref: row.sourceRef }
            }
          });
        } else {
          if (recordId) {
            const [was] = await tx
              .select()
              .from(suppliers)
              .where(eq(suppliers.id, recordId));
            before = snapshot(was, SUPPLIER_KEYS);
            await tx
              .update(suppliers)
              .set({
                // Added to, as a push adds to it: what is already known stays.
                description: was.description ?? record.data.description ?? null,
                categories: [
                  ...new Set([...was.categories, ...record.data.categories])
                ],
                legacy: { ...(was.legacy ?? {}), ...record.legacy },
                importBatchId: batch.id,
                importSourceId: was.importSourceId ?? batch.sourceId,
                externalRef: was.externalRef ?? row.sourceRef,
                updatedAt: at
              })
              .where(eq(suppliers.id, recordId));
            id = recordId;
          } else {
            const [created] = await tx
              .insert(suppliers)
              .values({
                organisationId: input.organisationId,
                name: record.data.name,
                canonicalKey: canonicalise(record.data.name),
                description: record.data.description,
                categories: record.data.categories,
                importSourceId: batch.sourceId,
                importBatchId: batch.id,
                externalRef: row.sourceRef,
                legacy: record.legacy,
                // Not confirmed: it came from another platform's list.
                reviewedAt: null,
                createdAt: at,
                updatedAt: at
              })
              .returning({ id: suppliers.id });
            id = created.id;
          }
          await appendAuditEvent(tx, {
            ...input.actor,
            organisationId: input.organisationId,
            action:
              action === 'create' ? 'supplier.created' : 'supplier.updated',
            subjectType: 'supplier',
            subjectId: id,
            after: {
              name: record.data.name,
              imported: { batch: batch.id, ref: row.sourceRef }
            }
          });
        }
        actions.push(action);
        await tx
          .update(importRows)
          .set({ action, recordId: id, before })
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
  table: 'processing_activity' | 'supplier',
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
  const subject = table;
  const [a] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(assessments)
    .where(
      and(
        eq(assessments.subjectType, subject),
        inArray(assessments.subjectId, ids)
      )
    );
  const [d] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(eq(documents.subjectType, subject), inArray(documents.subjectId, ids))
    );
  const [l] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(recordLinks)
    .where(
      sql`(${recordLinks.fromType} = ${subject} and ${recordLinks.fromId} in ${ids}) or (${recordLinks.toType} = ${subject} and ${recordLinks.toId} in ${ids})`
    );
  return n + a.n + d.n + l.n;
}

/**
 * Take an import back out: remove the records it created and put back what
 * it changed. Only while nobody has worked on any of them since; after that,
 * they are changed one by one like any other record.
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
      ).filter((r) => r.recordId);
      const table =
        batch.recordType === 'processing_activity'
          ? processingActivities
          : suppliers;
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
      const created = rows
        .filter((r) => r.action === 'create')
        .map((r) => r.recordId!);
      const linked = await referencesTo(tx, batch.recordType, created);
      if (linked > 0)
        throw new ImportRefused(
          'Some of the records it created are now linked to other records, such as an assessment or an agreement, so it can no longer be undone as a whole.'
        );

      for (const row of rows) {
        if (row.action === 'create')
          await tx.delete(table).where(eq(table.id, row.recordId!));
        else if (row.before)
          await tx
            .update(table)
            .set(restore(row.before))
            .where(eq(table.id, row.recordId!));
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

/** A person confirms an imported activity, which then counts as current. */
export async function confirmImportedActivity(input: {
  organisationId: string;
  activityId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(processingActivities)
        .set({ importConfirmedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(processingActivities.id, input.activityId),
            eq(processingActivities.organisationId, input.organisationId),
            sql`${processingActivities.importBatchId} is not null`,
            sql`${processingActivities.importConfirmedAt} is null`
          )
        )
        .returning();
      if (!row)
        throw new ImportRefused(
          'That activity is not waiting to be confirmed.'
        );
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: row.entityId,
        action: 'processing_activity.import_confirmed',
        subjectType: 'processing_activity',
        subjectId: row.id,
        after: { reference: row.reference, name: row.name }
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
