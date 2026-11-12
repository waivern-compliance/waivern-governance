import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HelpLink } from '@/components/help/HelpLink';
import { ConfirmImported } from '@/components/imports/ConfirmImported';
import { ImportedFrom } from '@/components/imports/ImportedFrom';
import { NotPermitted } from '@/components/NotPermitted';
import { can, scopedEntityIds } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';
import { evidenceRegister } from '@/services/evidence';

const day = (d: Date) => d.toISOString().slice(0, 10);

const KIND: Record<string, string> = {
  document: 'Document',
  scan: 'Scan',
  attestation: 'Attestation',
  link: 'Link'
};

/** Only web links are offered: a stored link is what another system said. */
const webLink = (uri: string | null) =>
  uri && /^https?:\/\//i.test(uri) ? uri : null;

const HREF: Record<string, string> = {
  assessment: '/app/assessments/',
  processing_activity: '/app/ropa/',
  risk: '/app/risks/'
};

export default async function EvidencePage() {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const { grants, organisationId, organisationName } = active.membership;

  if (!can(grants, 'record.read')) {
    return (
      <NotPermitted
        what="The evidence register"
        organisationName={organisationName}
      />
    );
  }

  const items = await evidenceRegister(
    organisationId,
    scopedEntityIds(grants, 'record.read')
  );
  const waiting = items.filter(
    (e) => e.importBatchId && !e.importConfirmedAt
  ).length;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← {organisationName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Evidence</h1>
        <p className="max-w-prose text-sm text-ink-soft">
          What supports the organisation&rsquo;s records: documents, scans,
          attestations and links, sent by connected tools or imported from
          another platform, and the records each one supports.
        </p>
        <p className="text-sm">
          {items.length} piece{items.length === 1 ? '' : 's'} of evidence
          {waiting ? `, ${waiting} imported and not yet confirmed` : ''}.
        </p>
      </header>

      <HelpLink topic="evidence" />

      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">
          None yet. Connected tools send evidence through the Integration API,
          and an owner or privacy administrator can import it under Settings.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((e) => (
            <li
              key={e.id}
              id={e.id}
              className="space-y-2 rounded border border-line bg-surface p-4 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-medium">{e.title}</span>
                <span className="font-mono text-[11px] text-ink-soft">
                  {KIND[e.kind] ?? e.kind}
                  {e.collectedAt ? ` · gathered ${day(e.collectedAt)}` : ''}
                  {` · ${e.entityName}`}
                </span>
              </div>
              {e.description ? (
                <p className="max-w-prose whitespace-pre-wrap text-xs text-ink-soft">
                  {e.description}
                </p>
              ) : null}
              <p className="text-xs text-ink-soft">
                {e.connectionName
                  ? `Sent by ${e.connectionName}`
                  : e.importSourceName
                    ? `Imported from ${e.importSourceName}`
                    : 'Recorded here'}
                {e.supports.length > 0 ? ' · supports ' : ''}
                {e.supports.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 ? ', ' : ''}
                    {HREF[s.type] ? (
                      <Link
                        href={`${HREF[s.type]}${s.id}`}
                        className="text-brand underline"
                      >
                        {s.reference ?? s.type}
                      </Link>
                    ) : (
                      (s.reference ?? s.type)
                    )}
                  </span>
                ))}
              </p>
              {webLink(e.uri) || e.files.length > 0 ? (
                <p className="flex flex-wrap gap-x-4 text-xs">
                  {e.files.map((f) => (
                    <a
                      key={f.id}
                      href={`/api/documents/${f.id}`}
                      className="text-brand underline"
                    >
                      {f.filename}
                    </a>
                  ))}
                  {webLink(e.uri) ? (
                    <a
                      href={webLink(e.uri)!}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="text-brand underline"
                    >
                      Open the link
                    </a>
                  ) : null}
                </p>
              ) : null}
              {e.importSourceId && e.importSourceName ? (
                <ImportedFrom
                  sourceName={e.importSourceName}
                  batchId={e.importBatchId}
                  confirmed={e.importConfirmedAt !== null}
                  legacy={e.legacy}
                  confirm={
                    can(grants, 'record.write', e.entityId) ? (
                      <ConfirmImported
                        type="evidence"
                        id={e.id}
                        revalidate="/app/evidence"
                        what="this evidence"
                      />
                    ) : null
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
