import { NextResponse, type NextRequest } from "next/server";

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
      origins.push(issuer ? new URL(issuer).origin : "https://login.microsoftonline.com");
    } catch {
      origins.push("https://login.microsoftonline.com");
    }
  }
  if (process.env.AUTH_GOOGLE_ID) origins.push("https://accounts.google.com");
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
 */
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    ["form-action 'self'", ...identityProviderOrigins()].join(" "),
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Pages only. API routes, build assets and icons render no HTML, and a
    // prefetch is a data payload rather than a document.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
