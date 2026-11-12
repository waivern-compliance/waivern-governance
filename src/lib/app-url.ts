import { NextRequest } from 'next/server';

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
 * A request on one of these addresses is handled there; a request claiming any
 * other host is treated as arriving at `APP_URL`. The proxy (`src/proxy.ts`)
 * applies this to every page request, which covers the sign-in server action,
 * and the auth route to its own, so a forged `Host` or `X-Forwarded-Host`
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

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function listedOrigins(env: Env): string[] {
  const listed = [env.APP_URL, ...(env.APP_ALIAS_URLS ?? '').split(',')]
    .map((u) => u?.trim())
    .filter((u): u is string => !!u)
    .map((u) => parse(u)?.origin)
    .filter((o): o is string => !!o && o !== 'null');
  return [...new Set(listed)];
}

// The environment is fixed for the life of the process, so the list read from
// it is worked out once.
let fromProcessEnv: string[] | undefined;

/** `APP_URL`, then each of `APP_ALIAS_URLS`, as origins. Empty when unset. */
export function servedOrigins(env: Env = process.env): string[] {
  if (env !== process.env) return listedOrigins(env);
  return (fromProcessEnv ??= listedOrigins(env));
}

/**
 * Whether this deployment lists its addresses rather than naming one: some
 * listed, and neither `AUTH_URL` nor its old name `NEXTAUTH_URL` set.
 */
export function listsAddresses(env: Env = process.env): boolean {
  return (
    !env.AUTH_URL?.trim() &&
    !env.NEXTAUTH_URL?.trim() &&
    servedOrigins(env).length > 0
  );
}

const first = (v: string | null) => v?.split(',')[0]?.trim() || null;

/** The origin a browser reached this deployment at, from the proxy's headers. */
export function originFromHeaders(h: Headers): string {
  const proto = first(h.get('x-forwarded-proto')) || 'http';
  const host = first(h.get('x-forwarded-host')) || h.get('host');
  return `${proto}://${host}`;
}

const DEFAULT_PORTS = ['', '80', '443'];

/**
 * The listed origin for the host a request claims, compared as a parsed host
 * (case, a trailing dot and a default port ignored), with the scheme taken
 * from the list rather than from a header a proxy may leave out.
 */
function listedFor(h: Headers, served: string[]): string | undefined {
  const host = first(h.get('x-forwarded-host')) || h.get('host');
  const seen = host ? parse(`http://${host}`) : null;
  if (!seen) return undefined;
  const name = seen.hostname.replace(/\.$/, '');
  const matches = served.filter((o) => {
    const u = new URL(o);
    if (u.hostname !== name) return false;
    return u.port ? u.port === seen.port : DEFAULT_PORTS.includes(seen.port);
  });
  const proto = first(h.get('x-forwarded-proto'));
  return matches.find((o) => o.startsWith(`${proto}:`)) ?? matches[0];
}

/**
 * The origin to handle this request at, or null to leave it alone
 * (`AUTH_URL` set, or no addresses listed). Always one of `servedOrigins`.
 */
export function signInOrigin(
  h: Headers,
  env: Env = process.env
): string | null {
  if (!listsAddresses(env)) return null;
  const served = servedOrigins(env);
  return listedFor(h, served) ?? served[0];
}

/**
 * Point the forwarded-address headers at `signInOrigin`, so anything that
 * reads them (Auth.js's server actions among them) sees a listed address.
 * Unchanged when addresses are not listed.
 */
export function pinForwardedAddress(h: Headers, env: Env = process.env): void {
  const origin = signInOrigin(h, env);
  if (!origin) return;
  const { host, protocol } = new URL(origin);
  h.set('x-forwarded-host', host);
  h.set('x-forwarded-proto', protocol.replace(/:$/, ''));
}

/**
 * Next.js gives a route handler its own `localhost:PORT` as the request's
 * address, whatever the browser asked for, and Auth.js builds the provider's
 * callback from it. Put back the listed address the browser used.
 */
export function atListedAddress(
  req: NextRequest,
  env: Env = process.env
): NextRequest {
  const origin = signInOrigin(req.headers, env);
  if (!origin) return req;
  const { href, origin: given } = req.nextUrl;
  return new NextRequest(href.replace(given, origin), req);
}
