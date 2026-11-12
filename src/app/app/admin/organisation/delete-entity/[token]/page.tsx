import Link from 'next/link';

import { CONFIRM_PHRASE } from '@/lib/email/entity-erasure';
import { isPlatformAdmin } from '@/lib/platform';
import { mayDeleteEntity } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';
import { erasureForToken, previewErasure } from '@/services/entity-erasure';

import { ConfirmForm } from '../Forms';
import { IrrevocableWarning, RetentionDuties } from '../Warning';

/**
 * Where the emailed link lands. Deletes nothing by being opened: the person
 * must be signed in as whoever asked, still be allowed to, and type the
 * confirmation.
 */
export default async function ConfirmDeletionPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await erasureForToken(token);

  if (link.state !== 'open') {
    return (
      <Shell>
        <p className="text-sm">
          {link.state === 'expired'
            ? 'This link has expired. Nothing has been deleted. If you still want to delete the entity, ask again.'
            : link.state === 'used'
              ? 'This link has already been used, or a newer one has replaced it.'
              : 'This link is not valid. Nothing has been deleted.'}
        </p>
        <Link
          href="/app/admin/organisation/delete-entity"
          className="text-sm text-brand underline"
        >
          Delete a legal entity
        </Link>
      </Shell>
    );
  }

  const { erasure } = link;
  const active = await getActiveSession(erasure.organisationId);
  if (!active) {
    return (
      <Shell>
        <p className="text-sm">
          Sign in as the person who asked for this deletion, then open the link
          from your email again. Nothing has been deleted.
        </p>
        <Link
          href="/sign-in"
          className="text-sm text-brand underline"
        >
          Sign in
        </Link>
      </Shell>
    );
  }
  if (active.userId !== erasure.requestedBy) {
    return (
      <Shell>
        <p className="text-sm">
          This link was sent to somebody else. Only the person who asked can
          confirm it. Nothing has been deleted.
        </p>
      </Shell>
    );
  }
  if (
    !mayDeleteEntity(
      active.membership.grants,
      erasure.entityId,
      isPlatformAdmin(active.email)
    )
  ) {
    return (
      <Shell>
        <p className="text-sm">
          You are no longer allowed to delete this legal entity. Nothing has
          been deleted.
        </p>
      </Shell>
    );
  }

  const preview = await previewErasure(
    erasure.organisationId,
    erasure.entityId
  );

  return (
    <Shell>
      <p className="text-sm">
        You are about to delete{' '}
        <span className="font-semibold">{erasure.entityName}</span>
        {erasure.legalEntityRef ? ` (${erasure.legalEntityRef})` : ''} from{' '}
        {active.membership.organisationName}, with{' '}
        <span className="font-semibold">{preview.records} records</span> held
        for it.
      </p>
      <IrrevocableWarning />
      <RetentionDuties />
      <section className="space-y-3 rounded border border-line bg-surface p-5">
        <p className="text-sm">
          Last chance to{' '}
          <Link
            href="/app/exports"
            className="text-brand underline"
          >
            export
          </Link>{' '}
          first. Typing the words below and pressing the button deletes{' '}
          {erasure.entityName} at once.
        </p>
        <ConfirmForm
          token={token}
          entityName={erasure.entityName}
          phrase={CONFIRM_PHRASE}
        />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Confirm: permanently delete a legal entity
        </h1>
      </header>
      {children}
    </main>
  );
}
