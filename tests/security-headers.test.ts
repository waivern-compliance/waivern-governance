import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { bannerFor, cookiebotId } from '@/lib/cookiebot';
import { contentSecurityPolicy } from '@/proxy';

import nextConfig from '../next.config';

const ENV_KEYS = [
  'AUTH_MICROSOFT_ENTRA_ID_ID',
  'AUTH_MICROSOFT_ENTRA_ID_ISSUER',
  'AUTH_GOOGLE_ID',
  'NODE_ENV'
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

function directive(csp: string, name: string): string | undefined {
  return csp.split('; ').find((d) => d === name || d.startsWith(`${name} `));
}

describe('content security policy', () => {
  it("allows scripts only by this request's nonce", () => {
    const csp = contentSecurityPolicy('abc123', false);
    assert.equal(
      directive(csp, 'script-src'),
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'"
    );
    assert.equal(directive(csp, 'frame-ancestors'), "frame-ancestors 'none'");
    assert.equal(directive(csp, 'object-src'), "object-src 'none'");
    assert.ok(directive(csp, 'upgrade-insecure-requests'));
  });

  it('adds eval and drops the HTTPS upgrade only in development', () => {
    const csp = contentSecurityPolicy('abc123', true);
    assert.match(directive(csp, 'script-src') ?? '', /'unsafe-eval'/);
    assert.equal(directive(csp, 'upgrade-insecure-requests'), undefined);
  });

  it('lets sign-in forms reach the configured identity providers and no others', () => {
    delete env.AUTH_MICROSOFT_ENTRA_ID_ID;
    delete env.AUTH_GOOGLE_ID;
    assert.equal(
      directive(contentSecurityPolicy('n', false), 'form-action'),
      "form-action 'self'"
    );

    env.AUTH_MICROSOFT_ENTRA_ID_ID = 'client';
    env.AUTH_MICROSOFT_ENTRA_ID_ISSUER =
      'https://login.microsoftonline.com/tenant-id/v2.0';
    env.AUTH_GOOGLE_ID = 'client';
    assert.equal(
      directive(contentSecurityPolicy('n', false), 'form-action'),
      "form-action 'self' https://login.microsoftonline.com https://accounts.google.com"
    );
  });

  it('reaches Cookiebot only where a consent banner is loaded', () => {
    const plain = contentSecurityPolicy('n', false);
    assert.equal(directive(plain, 'connect-src'), "connect-src 'self'");
    assert.equal(directive(plain, 'frame-src'), undefined);
    assert.doesNotMatch(plain, /cookiebot/);

    const withBanner = contentSecurityPolicy('n', false, "'none'", true);
    assert.equal(
      directive(withBanner, 'connect-src'),
      "connect-src 'self' https://consent.cookiebot.com https://consentcdn.cookiebot.com"
    );
    assert.equal(
      directive(withBanner, 'frame-src'),
      "frame-src 'self' https://consentcdn.cookiebot.com"
    );
    assert.match(
      directive(withBanner, 'img-src') ?? '',
      /https:\/\/imgsct\.cookiebot\.com/
    );
    // The banner's scripts are trusted through the nonce, never by host.
    assert.equal(
      directive(withBanner, 'script-src'),
      "script-src 'self' 'nonce-n' 'strict-dynamic'"
    );
  });

  it('shows a banner from COOKIEBOT_ID, never on a public request form', () => {
    const id = 'FA73AFDF-3E2E-4EE6-9C8D-ACD111F6962E';
    assert.equal(cookiebotId({}), null);
    assert.equal(cookiebotId({ COOKIEBOT_ID: '' }), null);
    // It goes into a script address, so only a domain group ID is accepted.
    assert.equal(cookiebotId({ COOKIEBOT_ID: 'x"/><script>' }), null);
    assert.equal(cookiebotId({ COOKIEBOT_ID: ` ${id} ` }), id.toLowerCase());

    const env = { COOKIEBOT_ID: id };
    assert.equal(bannerFor('/sign-in', env), id.toLowerCase());
    assert.equal(bannerFor('/app/ropa', env), id.toLowerCase());
    assert.equal(bannerFor('/request/abcdefgh12', env), null);
  });
});

describe('response headers', () => {
  async function sent() {
    const rules = await nextConfig.headers!();
    return new Map(rules[0].headers.map((h) => [h.key, h.value]));
  }

  it('are sent on every path, and framing refused outside the forms', async () => {
    const rules = await nextConfig.headers!();
    assert.equal(rules[0].source, '/:path*');
    const headers = await sent();
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(
      headers.get('Referrer-Policy'),
      'strict-origin-when-cross-origin'
    );
    // X-Frame-Options has its own rule, everywhere but a public form's
    // address, where the proxy decides (tests/embedding.test.ts).
    const deny = rules.find((r) =>
      r.headers.some((h) => h.key === 'X-Frame-Options')
    );
    assert.equal(deny?.source, '/:path((?!request/).*)');
    assert.equal(
      deny?.headers.find((h) => h.key === 'X-Frame-Options')?.value,
      'DENY'
    );
    assert.equal(
      headers.get('Permissions-Policy'),
      'camera=(), microphone=(), geolocation=()'
    );
  });

  it('add HSTS in production only', async () => {
    env.NODE_ENV = 'development';
    assert.equal((await sent()).has('Strict-Transport-Security'), false);
    env.NODE_ENV = 'production';
    assert.equal(
      (await sent()).get('Strict-Transport-Security'),
      'max-age=63072000; includeSubDomains'
    );
  });
});
