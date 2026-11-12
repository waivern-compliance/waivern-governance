import { NextResponse, type NextRequest } from 'next/server';

import {
  BANNER_HEADER,
  bannerFor,
  COOKIEBOT_CSP,
  isPublicForm,
  PUBLIC_FORM_HEADER
} from '@/lib/cookiebot';
import { FORM_PATH, frameAncestors } from '@/lib/embedding';
import { frameOriginsForSlug } from '@/services/frame-origins';

/**
 * Where a sign-in form may send the browser. A server action that calls
 * `signIn` answers with a redirect to the identity provider, and browsers hold
 * redirects after a form submission to `form-action` — so the provider's origin
 * has to be named, or sign-in without JavaScript would be refused.
 */
function identityProviderOrigins(): string[] {
  const origins: string[] = [];
  if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
    const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
    try {
      origins.push(
        issuer ? new URL(issuer).origin : 'https://login.microsoftonline.com'
      );
    } catch {
      origins.push('https://login.microsoftonline.com');
    }
  }
  if (process.env.AUTH_GOOGLE_ID) origins.push('https://accounts.google.com');
  return origins;
}

/**
 * The Content-Security-Policy for one page response.
 *
 * Scripts run only if they carry this request's nonce, or were loaded by one
 * that did (`strict-dynamic`). Next.js reads the nonce back out of the request's
 * CSP header and stamps it on its own framework and inline scripts, which is why
 * the root layout forces every page to render per request. Styles still allow
 * inline: React's `style` attributes cannot carry a nonce, and a stylesheet is
 * a far smaller risk than a script.
 *
 * Development adds `'unsafe-eval'`, which React uses to rebuild server error
 * stacks in the browser, and leaves out the upgrade to HTTPS, which would break
 * plain-HTTP localhost.
 *
 * No page may be framed, except a public request form on the websites listed
 * against it (`lib/embedding.ts`), which the caller passes in.
 *
 * Where a page shows a cookie consent banner, it also needs to reach
 * Cookiebot and show its consent frame (`lib/cookiebot.ts`).
 */
export function contentSecurityPolicy(
  nonce: string,
  isDev: boolean,
  ancestors = "'none'",
  cookiebot = false
): string {
  const extra = (hosts: readonly string[]) =>
    cookiebot ? hosts.map((h) => ` ${h}`).join('') : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${extra(COOKIEBOT_CSP.img)}`,
    "font-src 'self'",
    `connect-src 'self'${extra(COOKIEBOT_CSP.connect)}`,
    ...(cookiebot ? [`frame-src 'self'${extra(COOKIEBOT_CSP.frame)}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    ["form-action 'self'", ...identityProviderOrigins()].join(' '),
    `frame-ancestors ${ancestors}`,
    ...(isDev ? [] : ['upgrade-insecure-requests'])
  ].join('; ');
}

/**
 * The websites that may frame this page: those listed against the form at a
 * public form address, and none anywhere else. A failed lookup frames nowhere.
 * Null outside `/request/`, where `next.config.ts` sends X-Frame-Options; an
 * empty list under it, where the config does not and this proxy must.
 */
async function framingFor(pathname: string): Promise<string[] | null> {
  if (!pathname.startsWith('/request/')) return null;
  const form = FORM_PATH.exec(pathname);
  if (!form) return [];
  try {
    return await frameOriginsForSlug(form[1]);
  } catch {
    return [];
  }
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const { pathname } = request.nextUrl;
  const framing = await framingFor(pathname);
  const banner = bannerFor(pathname);
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === 'development',
    frameAncestors(framing ?? []),
    banner !== null
  );

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  // For the root layout, which cannot see the path. Set or removed here, so a
  // browser cannot send its own.
  if (banner) requestHeaders.set(BANNER_HEADER, banner);
  else requestHeaders.delete(BANNER_HEADER);
  if (isPublicForm(pathname)) requestHeaders.set(PUBLIC_FORM_HEADER, '1');
  else requestHeaders.delete(PUBLIC_FORM_HEADER);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // `next.config.ts` sends X-Frame-Options everywhere but under `/request/`,
  // because it cannot list websites. There it is sent unless some are listed.
  if (framing !== null && framing.length === 0)
    response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

export const config = {
  matcher: [
    // Pages only. API routes, build assets and icons render no HTML, and a
    // prefetch is a data payload rather than a document.
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
};
