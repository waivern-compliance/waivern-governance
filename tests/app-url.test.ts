import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NextRequest } from 'next/server';

import {
  appUrl,
  atListedAddress,
  listsAddresses,
  pinForwardedAddress,
  servedOrigins,
  signInOrigin
} from '@/lib/app-url';

const MAIN = 'https://govern.waivern.com';
const ALIAS = 'https://govern-production.up.railway.app';
const listed = { APP_URL: `${MAIN}/`, APP_ALIAS_URLS: ` ${ALIAS} , ` };

const reached = (host: string, proto = 'https') =>
  new Headers({
    host: 'localhost:8080',
    'x-forwarded-host': host,
    'x-forwarded-proto': proto
  });

describe('appUrl', () => {
  it('prefers APP_URL for links in emails', () => {
    assert.equal(appUrl({ ...listed, AUTH_URL: ALIAS }), MAIN);
  });

  it('falls back to AUTH_URL for deployments that set only that', () => {
    assert.equal(
      appUrl({ AUTH_URL: ' https://govern.example.org// ' }),
      'https://govern.example.org'
    );
  });

  it('is empty when neither is set', () => {
    assert.equal(appUrl({ APP_URL: '  ' }), '');
  });
});

describe('servedOrigins', () => {
  it('lists APP_URL first, then each alias, once each', () => {
    assert.deepEqual(
      servedOrigins({ ...listed, APP_ALIAS_URLS: `${ALIAS},${MAIN}/app` }),
      [MAIN, ALIAS]
    );
  });

  it('skips anything that is not an address', () => {
    assert.deepEqual(servedOrigins({ APP_ALIAS_URLS: 'not a url' }), []);
  });
});

describe('signInOrigin', () => {
  it('signs in on whichever listed address the browser used', () => {
    assert.equal(signInOrigin(reached('govern.waivern.com'), listed), MAIN);
    assert.equal(
      signInOrigin(reached('GOVERN-production.up.railway.app'), listed),
      ALIAS
    );
  });

  it('treats any other host as the main address', () => {
    assert.equal(signInOrigin(reached('evil.example.com'), listed), MAIN);
    assert.equal(
      signInOrigin(reached('govern.waivern.com', 'http'), listed),
      MAIN
    );
  });

  it('leaves AUTH_URL deployments to Auth.js', () => {
    assert.equal(
      signInOrigin(reached('govern.waivern.com'), {
        ...listed,
        AUTH_URL: MAIN
      }),
      null
    );
  });

  it('does nothing when no addresses are listed', () => {
    assert.equal(signInOrigin(reached('govern.waivern.com'), {}), null);
  });
});

describe('matching the host a request claims', () => {
  it('ignores a default port, a trailing dot and letter case', () => {
    assert.equal(signInOrigin(reached(`${ALIAS.slice(8)}:443`), listed), ALIAS);
    assert.equal(signInOrigin(reached('GOVERN.waivern.com.'), listed), MAIN);
  });

  it('takes the scheme from the list when the proxy sends none', () => {
    const h = new Headers({ host: ALIAS.slice(8) });
    assert.equal(signInOrigin(h, listed), ALIAS);
  });

  it('keeps a listed non-default port distinct', () => {
    const env = { APP_URL: 'http://localhost:3001' };
    assert.equal(
      signInOrigin(new Headers({ host: 'localhost:3002' }), env),
      'http://localhost:3001'
    );
    assert.equal(
      signInOrigin(new Headers({ host: 'localhost:3001' }), env),
      'http://localhost:3001'
    );
  });
});

describe('listsAddresses', () => {
  it('is off whenever AUTH_URL or NEXTAUTH_URL names the address', () => {
    assert.equal(listsAddresses(listed), true);
    assert.equal(listsAddresses({ ...listed, AUTH_URL: MAIN }), false);
    assert.equal(listsAddresses({ ...listed, NEXTAUTH_URL: MAIN }), false);
    assert.equal(listsAddresses({}), false);
  });
});

describe('pinForwardedAddress', () => {
  it('replaces a forged host with the main address', () => {
    const h = reached('evil.example.com', 'http');
    pinForwardedAddress(h, listed);
    assert.equal(h.get('x-forwarded-host'), 'govern.waivern.com');
    assert.equal(h.get('x-forwarded-proto'), 'https');
  });

  it('keeps a listed address as the browser used it', () => {
    const h = reached('govern-production.up.railway.app');
    pinForwardedAddress(h, listed);
    assert.equal(h.get('x-forwarded-host'), 'govern-production.up.railway.app');
  });

  it('touches nothing when AUTH_URL is set', () => {
    const h = reached('evil.example.com');
    pinForwardedAddress(h, { ...listed, AUTH_URL: MAIN });
    assert.equal(h.get('x-forwarded-host'), 'evil.example.com');
  });
});

describe('atListedAddress', () => {
  const request = (host: string, init?: { method: string; body: string }) =>
    new NextRequest('http://localhost:8080/api/auth/callback/google?code=x', {
      ...init,
      headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' }
    });

  it('gives the auth route the listed address the browser used', () => {
    const req = atListedAddress(
      request('govern-production.up.railway.app'),
      listed
    );
    assert.equal(req.url, `${ALIAS}/api/auth/callback/google?code=x`);
  });

  it('keeps the body of a POST', async () => {
    const req = atListedAddress(
      request('govern.waivern.com', { method: 'POST', body: 'csrfToken=t' }),
      listed
    );
    assert.equal(req.url.startsWith(MAIN), true);
    assert.equal(await req.text(), 'csrfToken=t');
  });

  it('leaves the request alone when AUTH_URL is set', () => {
    const original = request('govern.waivern.com');
    assert.equal(
      atListedAddress(original, { ...listed, AUTH_URL: MAIN }),
      original
    );
  });
});
