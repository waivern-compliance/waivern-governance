/**
 * A cookie consent banner (Cookiebot), on when `COOKIEBOT_ID` names a
 * Cookiebot domain group.
 *
 * A setting rather than a constant, so each deployment uses its own domain
 * group (or none): Waivern's hosted service and its staging copy, and anybody
 * else running the open-source code with their own Cookiebot account.
 * Everything the browser fetches for it is named here, so the
 * Content-Security-Policy (`src/proxy.ts`) and the scripts cannot drift.
 *
 * Never on a public request form (`/request/`). Those are an organisation's
 * own forms, often framed in its own website, and a banner there would be
 * the operator's, asking a stranger about cookies the organisation does not
 * set.
 */

const DOMAIN_GROUP =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The configured domain group, or null for none. Anything that is not a
 * domain group ID is treated as none, since it ends up in a script address.
 */
export function cookiebotId(
  env: Record<string, string | undefined> = process.env
): string | null {
  const id = env.COOKIEBOT_ID?.trim();
  return id && DOMAIN_GROUP.test(id) ? id.toLowerCase() : null;
}

/** Whether a page at this path is a public request form, outside the operator's own pages. */
export function isPublicForm(pathname: string): boolean {
  return pathname.startsWith('/request/');
}

/** The domain group whose banner this page shows, or null for no banner. */
export function bannerFor(
  pathname: string,
  env: Record<string, string | undefined> = process.env
): string | null {
  return isPublicForm(pathname) ? null : cookiebotId(env);
}

/** The banner script, which the footer adds to the page once it has loaded. */
export const COOKIEBOT_BANNER_SRC = 'https://consent.cookiebot.com/uc.js';

/** The table of cookies the banner asks about, shown in the footer. */
export function declarationSrc(id: string): string {
  return `https://consent.cookiebot.com/${id}/cd.js`;
}

/**
 * What the banner needs the Content-Security-Policy to allow, from
 * Cookiebot's own guide to a nonce-based policy. Its scripts need no host: the
 * banner carries the page's nonce, and `'strict-dynamic'` trusts what it loads.
 */
export const COOKIEBOT_CSP = {
  connect: [
    'https://consent.cookiebot.com',
    'https://consentcdn.cookiebot.com'
  ],
  frame: ['https://consentcdn.cookiebot.com'],
  img: ['https://imgsct.cookiebot.com']
} as const;

/**
 * Request headers the proxy sets for the root layout, which cannot see the
 * path itself. Whatever a browser sends under these names is replaced.
 */
export const BANNER_HEADER = 'x-cookiebot-id';
export const PUBLIC_FORM_HEADER = 'x-public-form';
