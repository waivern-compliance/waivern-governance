import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { auditEvents, entities, organisations } from '@/db/schema';
import {
  embedSnippets,
  FORM_PATH,
  frameAncestors,
  MAX_FRAME_ORIGINS,
  normaliseOrigin,
  normaliseOrigins
} from '@/lib/embedding';
import { contentSecurityPolicy, proxy } from '@/proxy';
import { RequestRefused } from '@/services/data-subject-requests';
import {
  frameOriginsForSlug,
  issueIntakeLink,
  revokeIntakeLink,
  setIntakeLinkFrameOrigins
} from '@/services/dsr-intake';

import nextConfig from '../next.config';

const { pathToRegexp } = createRequire(import.meta.url)(
  'next/dist/compiled/path-to-regexp'
) as { pathToRegexp: (path: string) => RegExp };

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'embedding test'
};

after(() => pg.end());

describe('which websites may show a form', () => {
  it('takes https origins, and only the origin', () => {
    assert.equal(
      normaliseOrigin('https://www.council.gov.uk/foi/form?x=1'),
      'https://www.council.gov.uk'
    );
    assert.equal(
      normaliseOrigin('www.council.gov.uk'),
      'https://www.council.gov.uk'
    );
    assert.equal(
      normaliseOrigin('https://WWW.Council.gov.uk:8443'),
      'https://www.council.gov.uk:8443'
    );
    assert.equal(
      normaliseOrigin('http://localhost:4000'),
      'http://localhost:4000'
    );
  });

  it('refuses plain http, wildcards and things that are not websites', () => {
    for (const bad of [
      'http://www.council.gov.uk',
      'https://*.council.gov.uk',
      '*',
      'javascript:alert(1)',
      'https://user:pass@council.gov.uk',
      'intranet',
      ' '
    ])
      assert.throws(() => normaliseOrigin(bad), Error, bad);
  });

  it('de-duplicates a list, and stops at ten', () => {
    assert.deepEqual(
      normaliseOrigins(
        'https://a.example.org\nhttps://a.example.org/x, b.example.org'
      ),
      ['https://a.example.org', 'https://b.example.org']
    );
    const many = Array.from(
      { length: MAX_FRAME_ORIGINS + 1 },
      (_, i) => `https://site${i}.example.org`
    );
    assert.throws(() => normaliseOrigins(many), /at most 10/);
  });

  it('frames nowhere unless websites are listed', () => {
    assert.equal(frameAncestors([]), "'none'");
    assert.equal(
      frameAncestors(['https://a.example.org', 'https://b.example.org']),
      'https://a.example.org https://b.example.org'
    );
    assert.match(contentSecurityPolicy('n', false), /frame-ancestors 'none'/);
  });

  it('gives a titled frame and a script that listens only to this form', () => {
    const { link, iframe, script } = embedSnippets({
      appOrigin: 'https://govern.example',
      slug: 'abcdefghijklmnop',
      title: 'Make a "request"'
    });
    assert.equal(link, 'https://govern.example/request/abcdefghijklmnop');
    assert.match(iframe, /title="Make a &quot;request&quot;"/);
    assert.match(script, /event\.origin !== 'https:\/\/govern\.example'/);
    assert.match(script, /data\.form !== 'abcdefghijklmnop'/);
  });
});

describe('the headers', () => {
  async function aForm(origins: string[] = []) {
    const [org] = await db
      .insert(organisations)
      .values({
        name: 'Embedding',
        slug: `embedding-${crypto.randomUUID().slice(0, 8)}`
      })
      .returning();
    const [entity] = await db
      .insert(entities)
      .values({ organisationId: org.id, name: 'Council', isDefault: true })
      .returning();
    const link = await issueIntakeLink({
      organisationId: org.id,
      entityId: entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    if (origins.length)
      await setIntakeLinkFrameOrigins({
        linkId: link.id,
        organisationId: org.id,
        kind: 'data_protection',
        origins,
        actor: SYSTEM
      });
    return { org, link };
  }

  const at = (path: string) =>
    proxy(new NextRequest(new URL(path, 'http://govern.test')));

  it('lets only the listed websites frame a form, and drops X-Frame-Options there', async () => {
    const { link } = await aForm(['https://www.council.gov.uk']);
    const response = await at(`/request/${link.slug}`);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    assert.match(csp, /frame-ancestors https:\/\/www\.council\.gov\.uk;/);
    assert.doesNotMatch(csp, /evil\.example/);
    assert.equal(response.headers.get('X-Frame-Options'), null);
  });

  it('frames a form with no websites, an unknown or withdrawn form, and every other page nowhere', async () => {
    const plain = await aForm();
    const listed = await aForm(['https://www.council.gov.uk']);
    await revokeIntakeLink({
      linkId: listed.link.id,
      organisationId: listed.org.id,
      actor: SYSTEM
    });
    for (const path of [
      `/request/${plain.link.slug}`,
      `/request/${listed.link.slug}`,
      '/request/not-a-real-form-slug'
    ]) {
      const response = await at(path);
      assert.match(
        response.headers.get('Content-Security-Policy') ?? '',
        /frame-ancestors 'none'/,
        path
      );
      assert.equal(response.headers.get('X-Frame-Options'), 'DENY', path);
    }
    for (const path of ['/', '/app', '/sign-in', '/legal/terms', '/request']) {
      const response = await at(path);
      assert.match(
        response.headers.get('Content-Security-Policy') ?? '',
        /frame-ancestors 'none'/,
        path
      );
    }
  });

  it('sends X-Frame-Options: DENY from the config everywhere but the form addresses', async () => {
    const rules = (await nextConfig.headers!()) as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const denies = (path: string) =>
      rules.some(
        (r) =>
          pathToRegexp(r.source).test(path) &&
          r.headers.some(
            (h) => h.key === 'X-Frame-Options' && h.value === 'DENY'
          )
      );
    for (const path of ['/', '/app', '/api/v1/export', '/sign-in', '/requests'])
      assert.equal(denies(path), true, path);
    assert.equal(denies('/request/abcdefghijklmnop'), false);
    assert.ok(FORM_PATH.test('/request/abcdefghijklmnop'));
  });
});

describe('setting the websites', () => {
  it('is audited with what it was and what it became, and kept to its own kind', async () => {
    const [org] = await db
      .insert(organisations)
      .values({ name: 'Set', slug: `set-${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    const [entity] = await db
      .insert(entities)
      .values({ organisationId: org.id, name: 'Council', isDefault: true })
      .returning();
    const link = await issueIntakeLink({
      organisationId: org.id,
      entityId: entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    await setIntakeLinkFrameOrigins({
      linkId: link.id,
      organisationId: org.id,
      kind: 'data_protection',
      origins: 'www.council.gov.uk',
      actor: SYSTEM
    });
    assert.deepEqual(await frameOriginsForSlug(link.slug), [
      'https://www.council.gov.uk'
    ]);
    await assert.rejects(
      setIntakeLinkFrameOrigins({
        linkId: link.id,
        organisationId: org.id,
        kind: 'foi',
        origins: [],
        actor: SYSTEM
      }),
      RequestRefused
    );
    await assert.rejects(
      setIntakeLinkFrameOrigins({
        linkId: link.id,
        organisationId: org.id,
        kind: 'data_protection',
        origins: 'http://www.council.gov.uk',
        actor: SYSTEM
      }),
      RequestRefused
    );
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'intake.frame_origins_set')
        )
      );
    assert.deepEqual(event.before, { link: link.id, frameOrigins: [] });
    assert.deepEqual((event.after as { frameOrigins: string[] }).frameOrigins, [
      'https://www.council.gov.uk'
    ]);
  });
});
