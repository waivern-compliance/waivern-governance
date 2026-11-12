import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appUrl, servedOrigins, signInOrigin } from '@/lib/app-url';

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
