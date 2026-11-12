/**
 * The addresses this deployment is reached at.
 *
 * `AUTH_URL` names a single address, and Auth.js then sends every sign-in back
 * to it: a sign-in begun anywhere else returns without its cookies and fails.
 * A deployment reached at more than one address (its Railway domain and its
 * own, say) leaves `AUTH_URL` unset and lists them instead:
 *
 * - `APP_URL`: the main address, used for links in emails;
 * - `APP_ALIAS_URLS`: any others, comma-separated, where sign-in also works.
 *
 * A request on one of these addresses signs in there; a request claiming any
 * other host is treated as arriving at `APP_URL`, so a forged `Host` header
 * cannot steer where the identity provider sends people.
 */

type Env = Record<string, string | undefined>;

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/**
 * The address for links that leave the page: emails, and links people copy
 * and send on. `APP_URL`, else `AUTH_URL`, else empty.
 */
export function appUrl(env: Env = process.env): string {
  return trimSlash(env.APP_URL?.trim() || env.AUTH_URL?.trim() || '');
}

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** `APP_URL`, then each of `APP_ALIAS_URLS`, as origins. Empty when unset. */
export function servedOrigins(env: Env = process.env): string[] {
  const listed = [env.APP_URL, ...(env.APP_ALIAS_URLS ?? '').split(',')]
    .map((u) => u?.trim())
    .filter((u): u is string => !!u)
    .map(origin)
    .filter((o): o is string => o !== null);
  return [...new Set(listed)];
}

/** The origin a browser reached this deployment at, from the proxy's headers. */
export function originFromHeaders(h: Headers): string {
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  const host =
    h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host');
  return `${proto}://${host}`;
}

/**
 * The origin sign-in should use for this request, or null to leave it to
 * Auth.js (`AUTH_URL` set, or no addresses listed). One of `servedOrigins`.
 */
export function signInOrigin(
  h: Headers,
  env: Env = process.env
): string | null {
  if (env.AUTH_URL?.trim() || env.NEXTAUTH_URL?.trim()) return null;
  const served = servedOrigins(env);
  if (served.length === 0) return null;
  const seen = originFromHeaders(h).toLowerCase();
  return served.find((o) => o.toLowerCase() === seen) ?? served[0];
}
