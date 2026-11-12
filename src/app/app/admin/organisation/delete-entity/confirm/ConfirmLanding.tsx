'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { CONFIRM_PHRASE } from '@/lib/email/entity-erasure';
import type { ErasureView } from '@/services/entity-erasure';

import { openErasureAction } from '../actions';
import { ConfirmForm } from '../Forms';

/**
 * Takes the token from after `#`, clears it from the address bar and history,
 * and shows what the server says about it.
 */
export function ConfirmLanding({ warnings }: { warnings: React.ReactNode }) {
  const [token, setToken] = useState('');
  const [view, setView] = useState<ErasureView | null>(null);
  // Read once: the hash is cleared straight after, and an effect can run
  // twice (React's development mode does), which would read it empty.
  const read = useRef<string | null>(null);

  useEffect(() => {
    read.current ??= window.location.hash.slice(1);
    const found = read.current;
    if (window.location.hash)
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    let live = true;
    void openErasureAction(found).then((v) => {
      if (!live) return;
      setToken(found);
      setView(v);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!view) return <p className="text-sm text-ink-soft">Checking the link…</p>;

  if (view.state !== 'open')
    return (
      <>
        <p className="text-sm">
          {view.state === 'refused'
            ? view.message
            : view.state === 'expired'
              ? 'This link has expired. Nothing has been deleted. If you still want to delete the entity, ask again.'
              : view.state === 'used'
                ? 'This link has already been used, or a newer one has replaced it.'
                : 'This link is not valid. Nothing has been deleted.'}
        </p>
        <Link
          href={
            view.state === 'refused'
              ? '/sign-in'
              : '/app/admin/organisation/delete-entity'
          }
          className="text-sm text-brand underline"
        >
          {view.state === 'refused' ? 'Sign in' : 'Delete a legal entity'}
        </Link>
      </>
    );

  return (
    <>
      <p className="text-sm">
        You are about to delete{' '}
        <span className="font-semibold">{view.entityName}</span>
        {view.legalEntityRef ? ` (${view.legalEntityRef})` : ''}, with{' '}
        <span className="font-semibold">{view.records} records</span> held for
        it.
      </p>
      {warnings}
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
          {view.entityName} at once.
        </p>
        <ConfirmForm
          token={token}
          entityName={view.entityName}
          phrase={CONFIRM_PHRASE}
        />
      </section>
    </>
  );
}
