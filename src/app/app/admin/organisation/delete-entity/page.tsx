import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { isPlatformAdmin } from '@/lib/platform';
import { mayDeleteEntity, mayExportOrganisation } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';
import { entitiesOf } from '@/services/entities';
import {
  deletedEntities,
  deletionBy,
  erasureBlockers,
  LINK_MINUTES
} from '@/services/entity-erasure';

import { RequestForm } from './Forms';
import { IrrevocableWarning, RetentionDuties } from './Warning';

export default async function DeleteEntityPage({
  searchParams
}: {
  searchParams: Promise<{ deleted?: string; emailed?: string }>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const { deleted, emailed } = await searchParams;

  const organisationId = active.membership.organisationId;
  const platformAdmin = isPlatformAdmin(active.email);
  const mine = (await entitiesOf(organisationId)).filter((e) =>
    mayDeleteEntity(active.membership.grants, e.id, platformAdmin)
  );
  // Only the person who did it is told it is done, from their own record of
  // it: the name shown is never taken from the address.
  const done = deleted
    ? await deletionBy(organisationId, deleted, active.userId)
    : null;
  if (mine.length === 0 && !done) {
    return (
      <NotPermitted
        what="Deleting a legal entity"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const [choices, history] = await Promise.all([
    Promise.all(
      mine.map(async (e) => ({
        id: e.id,
        name: e.name,
        blockedBy:
          (await erasureBlockers(organisationId, e.id)).join(' ') || null
      }))
    ),
    mine.length > 0 ? deletedEntities(organisationId) : []
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/admin/organisation"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Organisation
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Delete a legal entity
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          Deletes one legal entity and every record held for it, with their
          files, from {active.membership.organisationName}.
        </p>
      </header>

      {done ? (
        <p
          role="status"
          className="rounded border border-line bg-surface px-4 py-3 text-sm"
        >
          {done.entityName} and every record held for it have been deleted.{' '}
          {emailed
            ? 'We have emailed you written confirmation.'
            : 'This deployment could not email you written confirmation; the list of deleted entities below is the record.'}
        </p>
      ) : null}

      <HelpLink topic="delete-entity" />

      <IrrevocableWarning />

      <section className="space-y-2 rounded border border-line bg-surface p-5 text-sm">
        <h2 className="font-semibold">First, take a copy</h2>
        <p className="max-w-prose text-ink-soft">
          Once deleted, nothing can be recovered, by you or by Waivern. Export
          what you hold before you go any further.
        </p>
        {mayExportOrganisation(active.membership.grants) ? (
          <Link
            href="/app/exports#everything"
            className="inline-block rounded border border-brand px-3 py-1.5 font-medium text-brand hover:bg-brand hover:text-white"
          >
            Export everything the organisation holds
          </Link>
        ) : (
          <Link
            href="/app/exports"
            className="inline-block rounded border border-brand px-3 py-1.5 font-medium text-brand hover:bg-brand hover:text-white"
          >
            Export the registers you can see
          </Link>
        )}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="font-semibold">What is deleted, and what is kept</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          <li>
            Deleted: every register entry, assessment, risk, request, complaint,
            breach, document and file held for the entity, with their comments,
            tasks and history, and the access people had to it alone.
          </li>
          <li>
            The activity log stays whole: each entry about the entity keeps who
            did what, when and to which record, but what changed is erased, so
            the chain still verifies.
          </li>
          <li>
            Kept: what belongs to the whole organisation (suppliers, templates,
            workflows, people), and the record that the entity accepted the
            terms and the Data Processing Agreement.
          </li>
          <li>
            Integration connections whose records landed in the entity are
            switched off until somebody chooses where they go now.
          </li>
        </ul>
      </section>

      <RetentionDuties />

      <section className="space-y-4 rounded border border-line bg-surface p-5">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Ask for the deletion</h2>
          <p className="max-w-prose text-sm text-ink-soft">
            We email a link to the address we hold for you,{' '}
            <span className="font-medium">{active.email}</span>. It works once,
            for {LINK_MINUTES} minutes. Opening it, signing in as yourself and
            typing the confirmation is what deletes the entity; until then
            nothing is deleted.
          </p>
        </div>
        {choices.some((c) => c.blockedBy) ? (
          <ul className="space-y-1 text-sm text-ink-soft">
            {choices
              .filter((c) => c.blockedBy)
              .map((c) => (
                <li key={c.id}>
                  <span className="font-medium text-ink">{c.name}</span> cannot
                  be deleted: {c.blockedBy}
                </li>
              ))}
          </ul>
        ) : null}
        <RequestForm entities={choices} />
      </section>

      {history.length > 0 ? (
        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">Deleted legal entities</h2>
          <ul className="divide-y divide-line rounded border border-line">
            {history.map((h) => (
              <li
                key={h.id}
                className="px-4 py-2.5"
              >
                <span className="font-medium">{h.entityName}</span>
                {h.legalEntityRef ? ` (${h.legalEntityRef})` : ''}, deleted{' '}
                {h.completedAt?.toISOString().slice(0, 10)} by{' '}
                {h.requestedByEmail}:{' '}
                {Object.values(h.counts ?? {}).reduce((s, n) => s + n, 0)}{' '}
                records
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
