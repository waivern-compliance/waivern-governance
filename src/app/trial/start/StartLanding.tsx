'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import type { TrialLinkState } from '@/services/trials';

import {
  checkTrialLinkAction,
  startTrialAction,
  type TrialResult
} from '../actions';

/**
 * Takes the token from after `#`, clears it from the address bar and history,
 * and asks the server what it is. Nothing is used by opening the page, so a
 * mail scanner that fetches the link spends nothing: the button does it.
 */
export function StartLanding() {
  const [token, setToken] = useState('');
  const [state, setState] = useState<TrialLinkState | null>(null);
  // Read once: the hash is cleared straight after, and an effect can run
  // twice (React's development mode does), which would read it empty.
  const read = useRef<string | null>(null);
  const [result, start, starting] = useActionState<TrialResult, FormData>(
    startTrialAction,
    null
  );

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
    void checkTrialLinkAction(found).then((s) => {
      if (!live) return;
      setToken(found);
      setState(s);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!state)
    return <p className="text-sm text-ink-soft">Checking the link…</p>;

  if (state !== 'valid')
    return (
      <div className="space-y-3 text-sm">
        <p>
          {state === 'expired'
            ? 'This link has expired.'
            : state === 'used'
              ? 'This link has already been used.'
              : 'This link is not valid.'}{' '}
          Ask for a new one: it is the same form whether you are starting a
          trial or signing back in to one.
        </p>
        <Link
          href="/trial"
          className="text-brand underline"
        >
          Ask for a new link
        </Link>
      </div>
    );

  return (
    <form
      action={start}
      className="space-y-3"
    >
      <input
        type="hidden"
        name="token"
        value={token}
      />
      <button
        type="submit"
        disabled={starting}
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {starting ? 'Starting…' : 'Continue to your trial'}
      </button>
      {result && !result.ok ? (
        <p
          role="alert"
          className="text-sm text-red-800"
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
