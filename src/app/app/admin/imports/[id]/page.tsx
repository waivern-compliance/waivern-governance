import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { RefusableForm } from '@/components/foi/RefusableForm';
import { inputClass } from '@/components/form-classes';
import { FIELDS } from '@/lib/import/fields';
import { mayImport } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';
import { loadImport } from '@/services/imports';

import {
  commitImportAction,
  previewImportAction,
  undoImportAction
} from '../actions';
import {
  ACTION_LABEL,
  countsWords,
  RECORD_TYPE_LABEL,
  STATUS_LABEL
} from '../words';

const when = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

const TONE: Record<string, string> = {
  create: 'text-emerald-900',
  update: 'text-ink',
  merge: 'text-ink',
  refuse: 'text-amber-900',
  skip: 'text-ink-soft'
};

export default async function ImportBatchPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!mayImport(active.membership.grants)) redirect('/app/admin/imports');

  const { id } = await params;
  const loaded = await loadImport(id, active.membership.organisationId);
  if (!loaded) notFound();
  const { batch, rows, mapping } = loaded;
  const defs = FIELDS[batch.recordType];
  const open = batch.status === 'uploaded' || batch.status === 'previewed';
  const written = rows.filter((r) =>
    ['create', 'update', 'merge'].includes(r.action)
  ).length;
  const recordHref = (recordId: string) =>
    batch.recordType === 'supplier'
      ? `/app/third-parties/${recordId}`
      : `/app/ropa/${recordId}`;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/admin/imports"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Imports
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {RECORD_TYPE_LABEL[batch.recordType]} from {batch.sourceName}
        </h1>
        <p className="text-sm text-ink-soft">
          {batch.filename} · {batch.rowCount} rows
          {batch.entityName ? ` · into ${batch.entityName}` : ''} ·{' '}
          {STATUS_LABEL[batch.status]}
        </p>
        <p className="text-xs text-ink-soft">
          Uploaded {when(batch.createdAt)} by {batch.createdByLabel}
          {batch.committedAt
            ? `. Imported ${when(batch.committedAt)} by ${batch.committedByLabel}`
            : ''}
          {batch.undoneAt
            ? `. Undone ${when(batch.undoneAt)} by ${batch.undoneByLabel}`
            : ''}
          .
        </p>
      </header>

      {open ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Match the columns</h2>
          <p className="max-w-prose text-sm text-ink-soft">
            For each field, the column of your file that holds it. Columns are
            matched by their names to start with; check them. Several values in
            one cell are read when separated by semicolons, bars or line breaks.
            A value that cannot be read stops that row, with the reason, rather
            than being guessed.
          </p>
          <RefusableForm
            action={previewImportAction.bind(null, batch.id)}
            submit={
              batch.status === 'previewed'
                ? 'Preview again'
                : 'Preview what each row becomes'
            }
            pendingLabel="Checking every row…"
            resetOnSuccess={false}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {defs.map((f) => (
                <label
                  key={f.key}
                  className="block space-y-1 text-sm"
                >
                  <span className="font-medium">
                    {f.label}
                    {f.required ? '' : ' '}
                    {f.required ? null : (
                      <span className="font-normal text-ink-soft">
                        (optional)
                      </span>
                    )}
                  </span>
                  {f.hint ? (
                    <span className="block text-xs text-ink-soft">
                      {f.hint}
                    </span>
                  ) : null}
                  <select
                    name={`field:${f.key}`}
                    defaultValue={mapping.fields[f.key] ?? ''}
                    required={f.required}
                    className={inputClass}
                  >
                    <option value="">Not in this file</option>
                    {batch.columns.map((c) => (
                      <option
                        key={c}
                        value={c}
                      >
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="keepUnmapped"
                defaultChecked={mapping.keepUnmapped}
                className="mt-1 accent-brand"
              />
              <span>
                Keep the other columns with each record
                <span className="block text-xs text-ink-soft">
                  Values from columns no field reads are kept on the record, to
                  read, so nothing from the old platform is lost.
                </span>
              </span>
            </label>
          </RefusableForm>
        </section>
      ) : null}

      {batch.status !== 'uploaded' ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            {batch.status === 'previewed'
              ? 'What would happen'
              : 'What happened'}
          </h2>
          <p className="text-sm">{countsWords(batch.counts)}.</p>

          {batch.status === 'previewed' ? (
            <div className="space-y-2 rounded border border-line bg-surface p-4">
              <p className="max-w-prose text-sm text-ink-soft">
                Importing writes the {written} record
                {written === 1 ? '' : 's'} below as one step: all of them, or
                none. Rows marked not imported are left out; fix them in the
                file and import it again later. Imported records show where they
                came from, and each processing activity shows as not yet
                confirmed until a person checks it.
              </p>
              <RefusableForm
                action={commitImportAction.bind(null, batch.id)}
                submit={`Import ${written} record${written === 1 ? '' : 's'}`}
                pendingLabel="Importing…"
                className="space-y-2"
              >
                <span className="sr-only">Import these records</span>
              </RefusableForm>
            </div>
          ) : null}

          {batch.status === 'committed' ? (
            <div className="space-y-2 rounded border border-line bg-surface p-4">
              <p className="max-w-prose text-sm text-ink-soft">
                Undoing removes the records this import created and puts back
                what it changed. It is possible only while nobody has worked on
                any of them since, and none is linked to an assessment, an
                agreement or another record.
              </p>
              <RefusableForm
                action={undoImportAction.bind(null, batch.id)}
                submit="Undo this import"
                pendingLabel="Undoing…"
                className="space-y-2"
              >
                <span className="sr-only">Undo this import</span>
              </RefusableForm>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">
                    In {batch.sourceName}
                  </th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {r.rowNumber}
                    </td>
                    <td className="px-3 py-1.5">{r.sourceRef ?? ''}</td>
                    <td className={`px-3 py-1.5 ${TONE[r.action]}`}>
                      {ACTION_LABEL[r.action]}
                      {r.reason ? `: ${r.reason}` : ''}
                      {r.recordId && batch.status === 'committed' ? (
                        <>
                          {' '}
                          <Link
                            href={recordHref(r.recordId)}
                            className="text-brand underline"
                          >
                            Open
                          </Link>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
