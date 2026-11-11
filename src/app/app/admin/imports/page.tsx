import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { RefusableForm } from '@/components/foi/RefusableForm';
import { inputClass } from '@/components/form-classes';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { db, scoped } from '@/db/client';
import { entities, importSources } from '@/db/schema';
import { MAX_FILE_BYTES, MAX_ROWS } from '@/lib/import/parse';
import { mayImport } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';
import { importBatchesFor } from '@/services/imports';

import { uploadImportAction } from './actions';
import { countsWords, RECORD_TYPE_LABEL, STATUS_LABEL } from './words';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Moving records in from another governance platform. Upload a file, match
 * its columns, preview every row, then import. See docs/migration-plan.md.
 */
export default async function ImportsPage() {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!mayImport(active.membership.grants))
    return (
      <NotPermitted
        what="Importing records"
        organisationName={active.membership.organisationName}
      />
    );

  const org = active.membership.organisationId;
  const [batches, legalEntities, sources] = await Promise.all([
    importBatchesFor(org),
    scoped(org, () =>
      db.select().from(entities).where(eq(entities.organisationId, org))
    ),
    scoped(org, () =>
      db
        .select({ name: importSources.name })
        .from(importSources)
        .where(eq(importSources.organisationId, org))
    )
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/admin"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Import records
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          Bring your records in from another platform, such as OneTrust or
          Vanta, or from a spreadsheet. Upload its export, match its columns to
          Govern&rsquo;s fields, and see what every row would become before
          anything is written. Importing the same file again updates what it
          brought in; it never duplicates. An import can be undone until anybody
          works on its records.
        </p>
      </header>

      <HelpLink topic="imports" />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          Start an import
        </h2>
        <RefusableForm
          action={uploadImportAction}
          submit="Upload and match columns"
          pendingLabel="Reading the file…"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">What the file holds</span>
              <select
                name="recordType"
                className={inputClass}
                defaultValue="processing_activity"
              >
                {Object.entries(RECORD_TYPE_LABEL).map(([value, label]) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Where it comes from</span>
              <input
                name="sourceName"
                required
                maxLength={80}
                list="import-sources"
                placeholder="OneTrust"
                className={inputClass}
              />
              <datalist id="import-sources">
                {[
                  ...new Set([
                    ...sources.map((s) => s.name),
                    'OneTrust',
                    'Vanta',
                    'Spreadsheet'
                  ])
                ].map((name) => (
                  <option
                    key={name}
                    value={name}
                  />
                ))}
              </datalist>
            </label>
          </div>
          {legalEntities.length > 1 ? (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">
                Legal entity{' '}
                <span className="font-normal text-ink-soft">
                  (for processing activities)
                </span>
              </span>
              <select
                name="entityId"
                className={inputClass}
                defaultValue={legalEntities.find((e) => e.isDefault)?.id}
              >
                {legalEntities.map((e) => (
                  <option
                    key={e.id}
                    value={e.id}
                  >
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span className="font-medium">The file</span>
            <span className="block text-xs text-ink-soft">
              CSV or Excel (.xlsx), with column names in the first row. Up to{' '}
              {MAX_ROWS} rows and {MAX_FILE_BYTES / 1024 / 1024} MB; split a
              larger register into several files.
            </span>
            <input
              type="file"
              name="file"
              required
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block text-sm"
            />
          </label>
        </RefusableForm>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          Imports ({batches.length})
        </h2>
        {batches.length === 0 ? (
          <p className="text-sm text-ink-soft">None yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded border border-line bg-surface">
            {batches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/app/admin/imports/${b.id}`}
                  className="block space-y-0.5 px-4 py-3 hover:bg-ground"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {RECORD_TYPE_LABEL[b.recordType]} from {b.sourceName}
                    </span>
                    <span className="font-mono text-[11px] text-ink-soft">
                      {STATUS_LABEL[b.status]} · {day(b.createdAt)}
                    </span>
                  </span>
                  <span className="block text-xs text-ink-soft">
                    {b.filename} · {b.rowCount} rows
                    {b.status === 'uploaded'
                      ? ''
                      : ` · ${countsWords(b.counts)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
