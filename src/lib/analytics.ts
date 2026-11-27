import { bannerFor } from '@/lib/cookiebot';

/**
 * Google Analytics, on when `GA_MEASUREMENT_ID` names a GA4 web stream.
 *
 * Only where the Cookiebot banner is shown, and only once the visitor has
 * given statistics consent in it (`components/site/GoogleAnalytics.tsx`):
 * analytics cookies need consent under the Irish ePrivacy Regulations, which
 * have no statistics exception, and this service does not lean on the UK's
 * (PECR regulation 6) for a third party's tag. Without a banner there is no
 * way to ask, so nothing is loaded.
 *
 * Never on a public request form, for the banner's reason (`lib/cookiebot.ts`),
 * nor on a contribution link, whose visitors are an organisation's
 * contacts rather than the operator's users.
 */

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/;

/**
 * The configured measurement ID, or null for none. Anything that is not one
 * is treated as none, since it ends up in a script address.
 */
export function measurementId(
  env: Record<string, string | undefined> = process.env
): string | null {
  const id = env.GA_MEASUREMENT_ID?.trim().toUpperCase();
  return id && MEASUREMENT_ID.test(id) ? id : null;
}

/** The measurement ID this page may report to, or null for none. */
export function analyticsFor(
  pathname: string,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (pathname.startsWith('/contribute/')) return null;
  return bannerFor(pathname, env) ? measurementId(env) : null;
}

/** The tag script, which the page adds once consent is given. */
export function tagSrc(id: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
}

/**
 * What the tag needs the Content-Security-Policy to allow, from Google's
 * guide to GA4 and a Content-Security-Policy. Its script needs no host: the
 * page's own code adds it, and `'strict-dynamic'` trusts that.
 */
export const ANALYTICS_CSP = {
  connect: [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com'
  ],
  img: ['https://*.google-analytics.com', 'https://*.googletagmanager.com']
} as const;

const RECORD_ID =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

/**
 * The address reported for a page view: the path alone, with record IDs
 * replaced. Queries carry searches and filters typed about an organisation's
 * records, and fragments carry a trial's sign-in token, so neither is sent.
 */
export function reportedLocation(origin: string, pathname: string): string {
  return `${origin}${pathname.replace(RECORD_ID, '/:id')}`;
}

/** Request header the proxy sets for the root layout, as for the banner. */
export const ANALYTICS_HEADER = 'x-ga-id';
