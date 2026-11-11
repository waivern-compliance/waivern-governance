import { createHash } from 'node:crypto';
import { sql as sqlTag } from 'drizzle-orm';
import postgres from 'postgres';

import { db, withOrganisation } from '@/db/client';
import { appendAuditEvent } from '@/lib/audit';
import { PRODUCT_NAME } from '@/lib/product';
import { zip, type ZipEntry } from '@/lib/zip';

import {
  DATASET_LABEL,
  renderDataset,
  verificationManifest,
  type Dataset
} from './exports';
import {
  isExported,
  TABLES,
  type ExportedTable
} from './organisation-export-tables';
import type { Actor } from './templates';
import { queueNotification } from './workflow';

/**
 * Everything an organisation holds, in one archive it can take away.
 *
 * The terms and the DPA promise that a client leaving gets its data back by
 * exporting it itself. That promise is only as good as the export is complete,
 * so this does not pick record types: it walks every table the database holds
 * for the organisation, as `organisation-export-tables.ts` classifies them,
 * and says in the archive what was left out and why.
 *
 * It reads on a connection of its own, in one read-only REPEATABLE READ
 * transaction, so every table is the same moment's and nothing written during
 * the download makes the archive disagree with itself. A separate connection
 * also keeps the export off the instance's shared one, which a long download
 * would otherwise hold for its whole length.
 *
 * Nothing is written to disk or to the database on the way: the archive is
 * built as it is sent. A stored copy would be a second, complete copy of every
 * requester's personal data, with its own retention to manage and its own
 * deletion to prove.
 */

export const FORMAT_VERSION = 1;

export type ExportRefusal = 'busy' | 'too_large';

export class ExportRefused extends Error {
  constructor(
    readonly reason: ExportRefusal,
    message: string
  ) {
    super(message);
  }
}

export type OpenedExport = {
  filename: string;
  /** What the archive's data comes to on disk, roughly; the archive differs. */
  estimatedBytes: number;
  /** The archive. Consuming it to the end records the export as complete. */
  stream: () => AsyncGenerator<Uint8Array>;
  /** Release the connection, for a caller that decides not to stream. */
  close: () => Promise<void>;
};

/** The default ceiling for a download from the browser: 2 GB. */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** `EXPORT_MAX_BYTES`, or the default where unset or not a number. */
export function maxExportBytes(
  env: Record<string, string | undefined> = process.env
): number {
  const parsed = Number(env.EXPORT_MAX_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

type Snapshot = postgres.Sql;

type Column = { name: string; type: string };

type FileEntry = {
  path: string;
  table: string;
  row: Record<string, unknown>;
  bytes: number;
  sha256: string;
  recordedSha256?: string;
};

type Manifest = {
  tables: Array<{
    table: string;
    path: string;
    rows: number;
    sha256: string;
    belongsBy: string;
    withheldColumns: Record<string, string>;
  }>;
  files: FileEntry[];
  filesWithheld: Array<{
    table: string;
    row: Record<string, unknown>;
    reason: string;
  }>;
  fileWarnings: Array<{ path: string; problem: string }>;
  spreadsheets: Array<{ path: string; title: string; rows: number }>;
};

/**
 * Open an export: take the organisation's export lock, check its size, record
 * that it has started, and fix the snapshot it will be read from.
 *
 * Refuses, with `ExportRefused`, when another export for the organisation is
 * running, or when it is larger than `maxBytes` (null for no limit, as on the
 * command line). Nothing is recorded for a refusal: nothing left.
 */
export async function openOrganisationExport(input: {
  organisationId: string;
  actor: Actor;
  /** How it was asked for, for the audit record: "web" or "command line". */
  via: string;
  maxBytes: number | null;
  /** Who ran it, where the actor is the platform rather than a member. */
  operator?: string;
  connectionString?: string;
}): Promise<OpenedExport> {
  const connectionString = input.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const snapshot = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 0,
    onnotice: () => undefined,
    // Dates as stored. Parsed, a date becomes midnight UTC and gains a time
    // nobody recorded.
    types: {
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x
      }
    }
  });

  let open = true;
  const close = async () => {
    if (!open) return;
    open = false;
    await snapshot.end({ timeout: 5 });
  };

  try {
    // Session-level, so it lasts as long as this connection and goes with it
    // however the export ends, on whichever instance it runs.
    const [{ locked }] = await snapshot<[{ locked: boolean }]>`
      select pg_try_advisory_lock(hashtextextended(${`organisation-export:${input.organisationId}`}, 0)) as locked`;
    if (!locked) {
      throw new ExportRefused(
        'busy',
        'An export of this organisation is already running. Try again when it has finished.'
      );
    }

    const columns = await readColumns(snapshot);
    const estimatedBytes = await measure(
      snapshot,
      input.organisationId,
      columns
    );
    if (input.maxBytes !== null && estimatedBytes > input.maxBytes) {
      throw new ExportRefused(
        'too_large',
        `This organisation holds about ${gigabytes(estimatedBytes)} GB, more than can be downloaded from the browser (${gigabytes(input.maxBytes)} GB). Ask Waivern, who will run the same export for you and send it securely.`
      );
    }

    const startedAt = new Date();
    await withOrganisation(input.organisationId, () =>
      db.transaction((tx) =>
        appendAuditEvent(tx, {
          ...input.actor,
          organisationId: input.organisationId,
          action: 'organisation.export_started',
          subjectType: 'organisation',
          subjectId: input.organisationId,
          after: {
            via: input.via,
            estimatedBytes,
            ...(input.operator ? { operator: input.operator } : {})
          }
        })
      )
    );

    // Started after the audit event above, so the archive records itself.
    const [migration] = await snapshot<
      [{ applied: number; lastAppliedAt: Date | null }]
    >`select count(*)::int as applied, to_timestamp(max(created_at) / 1000.0) as "lastAppliedAt" from drizzle.__drizzle_migrations`;
    await snapshot`begin isolation level repeatable read read only`;
    await snapshot`select set_config('app.organisation_id', ${input.organisationId}, true), set_config('role', 'govern_tenant', true)`;
    const [organisation] = await snapshot<
      [{ id: string; name: string; slug: string }]
    >`select id, name, slug from organisation where id = ${input.organisationId}`;
    if (!organisation) throw new Error('No such organisation');

    return {
      filename: `govern-export-${organisation.slug}-${startedAt.toISOString().slice(0, 10)}.zip`,
      estimatedBytes,
      close,
      stream: async function* () {
        try {
          const manifest: Manifest = {
            tables: [],
            files: [],
            filesWithheld: [],
            fileWarnings: [],
            spreadsheets: []
          };
          let manifestSha256 = '';
          const entries = archiveEntries({
            snapshot,
            columns,
            organisation,
            manifest,
            startedAt,
            exportedBy: input.operator ?? input.actor.actorLabel,
            via: input.via,
            migration,
            onManifest: (sha) => {
              manifestSha256 = sha;
            }
          });
          yield* zip(entries);
          await snapshot`commit`;
          await recordCompletion({
            organisationId: organisation.id,
            organisationName: organisation.name,
            actor: input.actor,
            via: input.via,
            operator: input.operator,
            manifest,
            manifestSha256
          });
        } finally {
          await close();
        }
      }
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function readColumns(snapshot: Snapshot): Promise<Map<string, Column[]>> {
  const rows = await snapshot<
    Array<{ table_name: string; column_name: string; data_type: string }>
  >`
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position`;
  const byTable = new Map<string, Column[]>();
  for (const r of rows) {
    const list = byTable.get(r.table_name) ?? [];
    list.push({ name: r.column_name, type: r.data_type });
    byTable.set(r.table_name, list);
  }
  return byTable;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** FROM and WHERE for one organisation's rows of a table, as `c`. */
function fromClause(rule: ExportedTable): string {
  const user = rule.withUser
    ? ` left join app_user u on u.id = c.${quote(rule.withUser.column)}`
    : '';
  if (rule.scope === 'organisation') {
    return `from ${quote(rule.table)} c${user} where c.${quote(rule.column)} = $1`;
  }
  return `from ${quote(rule.table)} c join ${quote(rule.parent)} p on p.id = c.${quote(rule.via)}${user} where p.organisation_id = $1`;
}

function columnsOf(
  rule: ExportedTable,
  columns: Map<string, Column[]>
): Column[] {
  const list = columns.get(rule.table);
  if (!list) {
    throw new Error(`${rule.table} is listed for export but does not exist`);
  }
  return list;
}

/** The columns written to a table's JSON, in the database's order. */
function dataColumns(rule: ExportedTable, columns: Map<string, Column[]>) {
  return columnsOf(rule, columns).filter(
    (c) => c.type !== 'bytea' && !(c.name in (rule.withhold ?? {}))
  );
}

/** What is held, from the stored row sizes: a guard, not a promise. */
async function measure(
  snapshot: Snapshot,
  organisationId: string,
  columns: Map<string, Column[]>
): Promise<number> {
  await snapshot`begin read only`;
  try {
    await snapshot`select set_config('app.organisation_id', ${organisationId}, true), set_config('role', 'govern_tenant', true)`;
    let total = 0;
    for (const rule of TABLES.filter(isExported)) {
      columnsOf(rule, columns);
      // Stored files are compressed on disk but not in the archive, so they
      // count at their full length.
      const file = rule.file
        ? ` - coalesce(sum(pg_column_size(c.${quote(rule.file.column)})), 0) + coalesce(sum(octet_length(c.${quote(rule.file.column)})), 0)`
        : '';
      const [{ bytes }] = await snapshot.unsafe<[{ bytes: string }]>(
        `select (coalesce(sum(pg_column_size(c.*)), 0)${file})::text as bytes ${fromClause(rule)}`,
        [organisationId]
      );
      total += Number(bytes);
    }
    return total;
  } finally {
    await snapshot`rollback`;
  }
}

async function* archiveEntries(input: {
  snapshot: Snapshot;
  columns: Map<string, Column[]>;
  organisation: { id: string; name: string; slug: string };
  manifest: Manifest;
  startedAt: Date;
  exportedBy: string;
  via: string;
  migration: { applied: number; lastAppliedAt: Date | null };
  onManifest: (sha256: string) => void;
}): AsyncGenerator<ZipEntry> {
  const { snapshot, columns, organisation, manifest, startedAt } = input;
  const exported = TABLES.filter(isExported);

  yield {
    name: 'README.txt',
    data: readme(organisation.name, startedAt),
    compress: true,
    modifiedAt: startedAt
  };

  for (const rule of exported) {
    const path = `data/${rule.table}.jsonl`;
    const hash = createHash('sha256');
    const counter = { rows: 0 };
    yield {
      name: path,
      data: hashed(
        tableLines(snapshot, rule, columns, organisation.id, counter),
        hash
      ),
      compress: true,
      modifiedAt: startedAt
    };
    manifest.tables.push({
      table: rule.table,
      path,
      rows: counter.rows,
      sha256: hash.digest('hex'),
      belongsBy:
        rule.scope === 'organisation'
          ? `${rule.column} is the organisation`
          : `${rule.via} is one of the organisation's ${rule.parent} rows`,
      withheldColumns: rule.withhold ?? {}
    });
  }

  for (const rule of exported) {
    if (rule.file)
      yield* fileEntries(snapshot, rule, organisation.id, manifest, startedAt);
  }

  for (const key of Object.keys(DATASET_LABEL) as Dataset[]) {
    const path = key === 'audit' ? 'audit/audit-log.csv' : `csv/${key}.csv`;
    const { body, rows } = await renderDataset(
      key,
      organisation.id,
      organisation.name,
      null
    );
    manifest.spreadsheets.push({ path, title: DATASET_LABEL[key], rows });
    yield { name: path, data: body, compress: true, modifiedAt: startedAt };
  }

  const auditRows =
    manifest.tables.find((t) => t.table === 'audit_event')?.rows ?? 0;
  yield {
    name: 'audit/verification.txt',
    data:
      verificationManifest(organisation.name, auditRows) +
      '\n\nThe same events, with every column, are in data/audit_event.jsonl.\n',
    compress: true,
    modifiedAt: startedAt
  };

  const body = JSON.stringify(
    {
      format: 'govern-organisation-export',
      formatVersion: FORMAT_VERSION,
      product: PRODUCT_NAME,
      organisation,
      exportedAt: startedAt.toISOString(),
      exportedBy: input.exportedBy,
      via: input.via,
      schema: {
        migrationsApplied: input.migration.applied,
        lastMigratedAt: input.migration.lastAppliedAt?.toISOString() ?? null
      },
      consistency:
        'Every file in data/ and files/ was read in one read-only snapshot taken when the export started, so they agree with each other. The spreadsheets in csv/ and audit/ were produced alongside and may include changes made while the export ran.',
      tables: manifest.tables,
      excludedTables: TABLES.filter((r) => !isExported(r)).map((r) => ({
        table: r.table,
        reason: 'excluded' in r ? r.excluded : ''
      })),
      files: manifest.files,
      filesWithheld: manifest.filesWithheld,
      fileWarnings: manifest.fileWarnings,
      spreadsheets: manifest.spreadsheets
    },
    null,
    2
  );
  input.onManifest(createHash('sha256').update(body).digest('hex'));
  yield {
    name: 'manifest.json',
    data: body,
    compress: true,
    modifiedAt: startedAt
  };
}

async function* tableLines(
  snapshot: Snapshot,
  rule: ExportedTable,
  columns: Map<string, Column[]>,
  organisationId: string,
  counter: { rows: number }
): AsyncGenerator<Uint8Array> {
  const keep = dataColumns(rule, columns);
  const files = rule.file;
  // Whatever names a file's path must be read even if it is withheld.
  const select = [
    ...keep.map((c) => `c.${quote(c.name)}`),
    ...(rule.withUser
      ? [
          `u.email as ${quote(`${rule.withUser.prefix}_email`)}`,
          `u.name as ${quote(`${rule.withUser.prefix}_name`)}`
        ]
      : [])
  ];
  // A stable order makes two exports of the same data the same bytes. Most
  // tables have a primary key; the few that do not are ordered by every column.
  const order =
    (await primaryKey(snapshot, rule.table)) ?? keep.map((c) => c.name);
  const query = `select ${select.join(', ')} ${fromClause(rule)} order by ${order
    .map((c) => `c.${quote(c)}`)
    .join(', ')}`;

  for await (const batch of snapshot
    .unsafe<Record<string, unknown>[]>(query, [organisationId])
    .cursor(500)) {
    const lines = batch.map((row) => {
      if (files) {
        const reason = files.withholdWhen?.(row) ?? null;
        row[files.column] = reason
          ? { withheld: reason }
          : { file: files.path(row) };
      }
      return JSON.stringify(row) + '\n';
    });
    counter.rows += batch.length;
    yield Buffer.from(lines.join(''), 'utf8');
  }
}

async function* fileEntries(
  snapshot: Snapshot,
  rule: ExportedTable,
  organisationId: string,
  manifest: Manifest,
  startedAt: Date
): AsyncGenerator<ZipEntry> {
  const file = rule.file;
  if (!file) return;
  const order = await primaryKey(snapshot, rule.table);
  if (!order)
    throw new Error(`${rule.table} holds files but has no primary key`);
  // Two rows at a time: files run to 10 MB, and these are held in memory.
  const query = `select c.* ${fromClause(rule)} order by ${order
    .map((c) => `c.${quote(c)}`)
    .join(', ')}`;
  for await (const batch of snapshot
    .unsafe<Record<string, unknown>[]>(query, [organisationId])
    .cursor(2)) {
    for (const row of batch) {
      const key = Object.fromEntries(order.map((c) => [c, row[c]]));
      const reason = file.withholdWhen?.(row) ?? null;
      if (reason) {
        manifest.filesWithheld.push({ table: rule.table, row: key, reason });
        continue;
      }
      const content = row[file.column];
      if (!(content instanceof Uint8Array)) continue;
      const path = file.path(row);
      const sha256 = createHash('sha256').update(content).digest('hex');
      const recorded = file.sha256Column
        ? String(row[file.sha256Column] ?? '')
        : undefined;
      if (recorded !== undefined && recorded !== sha256) {
        // Handed back all the same, and said: a silent substitute would be
        // worse than a file the client is told does not match.
        manifest.fileWarnings.push({
          path,
          problem: `The file's SHA-256 is ${sha256}, but ${recorded} was recorded when it was uploaded.`
        });
      }
      manifest.files.push({
        path,
        table: rule.table,
        row: key,
        bytes: content.length,
        sha256,
        ...(recorded !== undefined ? { recordedSha256: recorded } : {})
      });
      yield {
        name: path,
        data: content,
        compress: false,
        modifiedAt:
          row.uploaded_at instanceof Date
            ? row.uploaded_at
            : row.created_at instanceof Date
              ? row.created_at
              : startedAt
      };
    }
  }
}

async function primaryKey(snapshot: Snapshot, table: string) {
  const rows = await snapshot<Array<{ name: string }>>`
    select a.attname as name
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${table}::regclass and i.indisprimary
    order by array_position(i.indkey, a.attnum)`;
  return rows.length > 0 ? rows.map((r) => r.name) : null;
}

async function* hashed(
  source: AsyncIterable<Uint8Array>,
  hash: ReturnType<typeof createHash>
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    hash.update(chunk);
    yield chunk;
  }
}

/**
 * Record that the archive was handed over in full, and tell the other owners.
 *
 * In one transaction, so an export recorded as complete has always been
 * announced. The notification is the in-app record; it is emailed too where
 * the deployment sends member email.
 */
async function recordCompletion(input: {
  organisationId: string;
  organisationName: string;
  actor: Actor;
  via: string;
  operator?: string;
  manifest: Manifest;
  manifestSha256: string;
}) {
  const { manifest } = input;
  const rows = manifest.tables.reduce((sum, t) => sum + t.rows, 0);
  const fileBytes = manifest.files.reduce((sum, f) => sum + f.bytes, 0);
  await withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const event = await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'organisation.exported',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        after: {
          via: input.via,
          ...(input.operator ? { operator: input.operator } : {}),
          rows,
          rowsByTable: Object.fromEntries(
            manifest.tables.map((t) => [t.table, t.rows])
          ),
          files: manifest.files.length,
          fileBytes,
          filesWithheld: manifest.filesWithheld.length,
          fileWarnings: manifest.fileWarnings,
          manifestSha256: input.manifestSha256
        }
      });

      const owners = await tx.execute<{ email: string }>(sqlOwners(input));
      const who = input.operator
        ? `Waivern (${input.operator})`
        : input.actor.actorLabel;
      for (const owner of owners) {
        if (owner.email.toLowerCase() === input.actor.actorLabel.toLowerCase())
          continue;
        await queueNotification(tx, {
          organisationId: input.organisationId,
          recipient: owner.email,
          kind: 'organisation.exported',
          subject: `${who} exported all of the organisation's data`,
          body: [
            `${who} downloaded a complete export of ${input.organisationName}: ${rows} records and ${manifest.files.length} files, including the personal data in data subject requests, breaches and complaints.`,
            'If you did not expect this, ask them about it, and check the activity log.',
            '/app/exports'
          ].join('\n'),
          idempotencyKey: `organisation-exported:${event.hash}:${owner.email}`
        });
      }
    })
  );
}

function sqlOwners(input: { organisationId: string }) {
  return sqlTag`
    select distinct u.email
    from membership m
    join role_assignment r on r.membership_id = m.id
    join app_user u on u.id = m.user_id
    where m.organisation_id = ${input.organisationId}
      and m.is_active
      and r.role = 'owner'
      and r.scope = 'organisation'`;
}

function readme(organisationName: string, at: Date): string {
  return [
    `${PRODUCT_NAME} - everything held for ${organisationName}`,
    `Exported ${at.toISOString()}`,
    '',
    'What is here',
    '',
    '  data/<table>.jsonl   Every record, one table per file and one record per line,',
    '                       as JSON with the column names and values as stored.',
    '                       Records that hold a file name it, as {"file": "files/..."}.',
    '  files/               Every attached file, exactly as uploaded.',
    '  csv/                 The spreadsheets from the Exports page, for reading in a',
    '                       spreadsheet program. The JSON is the complete record.',
    '  audit/               The activity log as a spreadsheet, and how to check that',
    '                       nobody has altered it, without having to trust us.',
    '  manifest.json        What is in this archive: every table with its record count',
    '                       and SHA-256, every file with its size and SHA-256, and',
    '                       everything deliberately left out, with the reason.',
    '',
    'Checking it is complete',
    '',
    '  Every file in data/ and files/ is listed in manifest.json with its SHA-256.',
    '  Recompute them to confirm nothing was lost or changed on the way. The tables',
    '  the manifest lists as excluded are the only ones not here, and it says why.',
    '',
    'This archive contains personal data, including about people who made requests',
    'or complaints to you. Keep it as carefully as you kept the records themselves.',
    ''
  ].join('\n');
}

function gigabytes(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
