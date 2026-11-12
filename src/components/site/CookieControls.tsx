'use client';

import { useEffect, useRef } from 'react';

import { COOKIEBOT_BANNER_SRC, declarationSrc } from '@/lib/cookiebot';

declare global {
  interface Window {
    Cookiebot?: { renew: () => void };
  }
}

/**
 * Loads the consent banner, once, after the page has hydrated.
 *
 * Added by script rather than server-rendered, so it neither holds up the
 * page while Cookiebot's servers answer nor puts nodes into the part of the
 * document React hydrates (Cookiebot inserts its own scripts next to it).
 * Manual blocking mode, Cookiebot's default: the service sets only strictly
 * necessary cookies, so there is nothing for automatic blocking to hold back,
 * and Cookiebot says automatic blocking is not fully compatible with a
 * Content-Security-Policy. Like any script the page's own code adds, it
 * needs no nonce: the policy's `'strict-dynamic'` covers it.
 */
export function CookieBanner({ cookiebotId }: { cookiebotId: string }) {
  useEffect(() => {
    if (document.getElementById('Cookiebot')) return;
    const script = document.createElement('script');
    script.id = 'Cookiebot';
    script.src = COOKIEBOT_BANNER_SRC;
    script.dataset.cbid = cookiebotId;
    script.async = true;
    document.head.appendChild(script);
  }, [cookiebotId]);
  return null;
}

/**
 * Reopens the consent banner, so changing your mind is as easy as giving
 * consent was. Does nothing if the banner failed to load.
 */
export function CookieSettingsButton({ className }: { className: string }) {
  return (
    <button
      type="button"
      onClick={() => window.Cookiebot?.renew()}
      className={className}
    >
      Cookie settings
    </button>
  );
}

/**
 * The cookies the banner asks about, as Cookiebot keeps them.
 *
 * Its script writes the table next to itself. Server-rendered, that would put
 * nodes inside React's tree that React did not render, so the script is added
 * here instead, after hydration, into an element React never fills.
 */
export function CookieDeclaration({ cookiebotId }: { cookiebotId: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el || el.childElementCount > 0) return;
    const script = document.createElement('script');
    script.id = 'CookieDeclaration';
    script.src = declarationSrc(cookiebotId);
    script.async = true;
    el.appendChild(script);
  }, [cookiebotId]);
  return (
    <div
      ref={host}
      className="cookie-declaration text-sm"
    />
  );
}
