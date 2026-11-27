'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { reportedLocation, tagSrc } from '@/lib/analytics';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Cookiebot's events whenever consent is read or changed. */
const CONSENT_EVENTS = [
  'CookiebotOnConsentReady',
  'CookiebotOnAccept',
  'CookiebotOnDecline'
] as const;

function hasStatisticsConsent(): boolean {
  return window.Cookiebot?.consent?.statistics === true;
}

/**
 * Removes the tag's cookies. Withdrawing consent has to end the storage it
 * covered, not just the reporting. The tag sets them on this host alone
 * (`cookie_domain: 'none'`), so expiring them here reaches all of them.
 */
function removeTagCookies() {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim();
    if (name === '_ga' || name.startsWith('_ga_'))
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

/**
 * Adds the tag, once. Page views are sent here rather than by the tag, which
 * would report the full address, query and all, and only on the first load:
 * moving between pages in the app does not reload the document.
 * Advertising features are off, so the data serves only to count visits.
 */
function loadTag(id: string) {
  if (document.getElementById('google-analytics')) return;
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js acts only on an `arguments` object: it reads an array as a Tag
  // Manager command and drops it, so the rest parameters the rule asks for
  // would silently send nothing.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id, {
    // This host only, so consent given here governs no other Waivern site's
    // cookies, and withdrawing it can remove every one of them.
    cookie_domain: 'none',
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });
  const script = document.createElement('script');
  script.id = 'google-analytics';
  script.src = tagSrc(id);
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Google Analytics, loaded only once the visitor has given statistics consent
 * in the Cookiebot banner (`lib/analytics.ts`), and stopped the moment they
 * withdraw it. Before consent nothing is fetched from Google, so no cookie or
 * request reaches it.
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const [consented, setConsented] = useState(false);
  // The path last reported, so giving consent again on the same page does not
  // count a second visit to it.
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const read = () => {
      const given = hasStatisticsConsent();
      setConsented(given);
      return given;
    };
    // Cookiebot's events fire only once it has read the visitor's choice, so
    // a refusal here is a real one rather than a banner still loading.
    const decided = () => {
      if (!read()) removeTagCookies();
    };
    read();
    for (const e of CONSENT_EVENTS) window.addEventListener(e, decided);
    return () => {
      for (const e of CONSENT_EVENTS) window.removeEventListener(e, decided);
    };
  }, []);

  useEffect(() => {
    // Google's own switch: a loaded tag sends nothing while it is set.
    (window as unknown as Record<string, unknown>)[
      `ga-disable-${measurementId}`
    ] = !consented;
    if (consented) loadTag(measurementId);
  }, [consented, measurementId]);

  useEffect(() => {
    if (!consented || reported.current === pathname) return;
    // A frame later, once the new page has written its title: the effect runs
    // as soon as the path changes, while the old title may still be showing.
    const frame = requestAnimationFrame(() => {
      reported.current = pathname;
      const location = reportedLocation(window.location.origin, pathname);
      // Set for every hit, not just this one, so anything else the tag sends
      // carries the same trimmed address.
      window.gtag?.('set', { page_location: location });
      window.gtag?.('event', 'page_view', {
        page_location: location,
        page_title: document.title
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [consented, pathname]);

  return null;
}
