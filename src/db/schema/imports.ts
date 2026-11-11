import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import type { ImportMapping, ImportRecord } from '@/lib/import/types';

import { bytea } from '../columns';
import { entities, organisations, users } from './tenancy';

/**
 * Records moved in from another governance platform: see
 * docs/migration-plan.md. A batch is one uploaded file and what became of
 * each of its rows; an import source is the platform it came from, whose own
 * identifiers make a re-import update rather than duplicate.
 */

export const importRecordType = pgEnum('import_record_type', [
  'supplier',
  'processing_activity'
]);

export const importBatchStatus = pgEnum('import_batch_status', [
  /** Uploaded, columns not yet matched to fields. */
  'uploaded',
  /** Matched and previewed: every row has the outcome it would have. */
  'previewed',
  'committed',
  'undone'
]);

export const importRowAction = pgEnum('import_row_action', [
  'create',
  'update',
  /** A supplier of the same name is already recorded: the row adds to it. */
  'merge',
  'refuse',
  /** An empty row. */
  'skip'
]);

/** A platform records come from: "OneTrust", "Vanta", "Our spreadsheet". */
export const importSources = pgTable(
  'import_source',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('import_source_name_key').on(
      t.organisationId,
      sql`lower(${t.name})`
    )
  ]
);

export const importBatches = pgTable(
  'import_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => importSources.id, { onDelete: 'restrict' }),
    recordType: importRecordType('record_type').notNull(),
    /** Where processing activities land. Suppliers belong to the organisation. */
    entityId: uuid('entity_id').references(() => entities.id, {
      onDelete: 'restrict'
    }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    /** The file as uploaded, kept with what was made of it. */
    file: bytea('file').notNull(),
    /** The header row, in order. */
    columns: jsonb('columns').$type<string[]>().notNull(),
    rowCount: integer('row_count').notNull(),
    mapping: jsonb('mapping').$type<ImportMapping>(),
    status: importBatchStatus('status').notNull().default('uploaded'),
    counts: jsonb('counts')
      .$type<
        Partial<Record<(typeof importRowAction.enumValues)[number], number>>
      >()
      .notNull()
      .default({}),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    createdByLabel: text('created_by_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    committedByLabel: text('committed_by_label'),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneByLabel: text('undone_by_label')
  },
  (t) => [index('import_batch_org_idx').on(t.organisationId, t.createdAt)]
);

/** One row of a batch, and what it became. */
export const importRows = pgTable(
  'import_row',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    /** Counting the header as row 1, as a spreadsheet shows it. */
    rowNumber: integer('row_number').notNull(),
    /** The record's identifier in the source platform. */
    sourceRef: text('source_ref'),
    action: importRowAction('action').notNull(),
    reason: text('reason'),
    /** What the row becomes, checked, so committing writes what was previewed. */
    record: jsonb('record').$type<ImportRecord>(),
    /** The record it created or changed. */
    recordId: uuid('record_id'),
    /** The fields it changed, as they were, so an undo can put them back. */
    before: jsonb('before').$type<Record<string, unknown>>()
  },
  (t) => [index('import_row_batch_idx').on(t.batchId, t.rowNumber)]
);

/** The column matching last used for a source and record type, offered again. */
export const importMappings = pgTable(
  'import_mapping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => importSources.id, { onDelete: 'cascade' }),
    recordType: importRecordType('record_type').notNull(),
    mapping: jsonb('mapping').$type<ImportMapping>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex('import_mapping_key').on(
      t.organisationId,
      t.sourceId,
      t.recordType
    )
  ]
);
