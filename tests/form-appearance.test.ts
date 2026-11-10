import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { GET as logoRoute } from '@/app/request/[slug]/logo/route';
import { db, sql as pg } from '@/db/client';
import { auditEvents, entities, organisations } from '@/db/schema';
import {
  AppearanceRefused,
  backgroundStyle,
  checkAppearance,
  checkLogo,
  contrast,
  pageTitle,
  parseHex
} from '@/lib/form-appearance';
import { RequestRefused } from '@/services/data-subject-requests';
import {
  issueIntakeLink,
  openIntakeLink,
  revokeIntakeLink
} from '@/services/dsr-intake';
import {
  clearFormAppearance,
  formAppearancesFor,
  formLogo,
  setFormAppearance,
  STANDARD_APPEARANCE
} from '@/services/form-appearance';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'appearance test'
};

after(() => pg.end());

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0
]);
const refusedWith = (pattern: RegExp) => (error: unknown) =>
  error instanceof AppearanceRefused && pattern.test(error.message);

describe('colours', () => {
  it('reads hex codes, and measures contrast as WCAG does', () => {
    assert.equal(parseHex('#ABC'), '#aabbcc');
    assert.equal(parseHex('0b6e4f'), '#0b6e4f');
    assert.equal(parseHex('green'), null);
    assert.equal(parseHex('#12345'), null);
    assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
    assert.equal(contrast('#777777', '#777777'), 1);
  });

  it('takes the standard look, a readable accent, and a light or transparent background', () => {
    assert.deepEqual(checkAppearance({ accent: '', background: '' }), {
      accentColour: null,
      background: null
    });
    assert.deepEqual(
      checkAppearance({ accent: '0B6E4F', background: 'Transparent' }),
      { accentColour: '#0b6e4f', background: 'transparent' }
    );
    assert.deepEqual(
      checkAppearance({ accent: '#1c4371', background: '#fff' }),
      { accentColour: '#1c4371', background: '#ffffff' }
    );
  });

  it('refuses what people could not read', () => {
    assert.throws(
      () => checkAppearance({ accent: '#ffcc00', background: '' }),
      refusedWith(/White text on the button/)
    );
    assert.throws(
      () => checkAppearance({ accent: '', background: '#333333' }),
      refusedWith(/text would be hard to read/)
    );
    // Dark enough for white text, too dark against a dark page for links.
    assert.throws(
      () => checkAppearance({ accent: '#1c4371', background: '#9aa6b2' }),
      refusedWith(/hard to read/)
    );
    assert.throws(
      () => checkAppearance({ accent: 'navy', background: '' }),
      refusedWith(/not a colour/)
    );
  });
});

describe('logos', () => {
  it('takes PNG, JPEG and WebP by their bytes, and nothing large or scriptable', () => {
    assert.equal(checkLogo(PNG), 'image/png');
    assert.equal(
      checkLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
      'image/jpeg'
    );
    assert.equal(
      checkLogo(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
        ])
      ),
      'image/webp'
    );
    assert.throws(
      () => checkLogo(new TextEncoder().encode('<svg onload="x()"></svg>')),
      refusedWith(/SVG is not accepted/)
    );
    assert.throws(
      () => checkLogo(new Uint8Array(300 * 1024).fill(0x89)),
      refusedWith(/Keep it to 256 KB/)
    );
    assert.throws(() => checkLogo(new Uint8Array()), refusedWith(/empty/));
  });
});

describe('the page', () => {
  it('is transparent from its first paint in a frame, and only there', () => {
    assert.equal(
      backgroundStyle('transparent', true),
      'body{background:transparent}'
    );
    assert.equal(
      backgroundStyle('transparent', false),
      'html[data-framed] body{background:transparent}'
    );
    assert.equal(backgroundStyle('#ffffff', false), 'body{background:#ffffff}');
    assert.equal(backgroundStyle(null, true), null);
    // Nothing unchecked reaches the CSS.
    assert.equal(backgroundStyle('#fff}body{x' as `#${string}`, false), null);
  });

  it('leaves the product out of the tab title with the line switched off', () => {
    assert.equal(pageTitle('Make a request', true), 'Make a request');
    assert.deepEqual(pageTitle('Make a request', false), {
      absolute: 'Make a request'
    });
  });
});

async function anOrg(label: string, foiAct: 'foia' | null = null) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: label,
      slug: `${label.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Council',
      isDefault: true,
      foiAct
    })
    .returning();
  const form = (kind: 'data_protection' | 'foi' = 'data_protection') =>
    issueIntakeLink({
      organisationId: org.id,
      entityId: entity.id,
      kind,
      label: kind === 'foi' ? 'FOI page' : 'Privacy notice',
      actor: SYSTEM
    });
  return { org, entity, form };
}

describe('how forms look', () => {
  it('follows the organisation, so a logo is set once and new forms start in it', async () => {
    const { org, form } = await anOrg('Look', 'foia');
    const privacy = await form();
    assert.deepEqual(
      (await openIntakeLink(privacy.slug))?.appearance,
      STANDARD_APPEARANCE
    );
    await assert.rejects(
      setFormAppearance({
        organisationId: org.id,
        linkId: null,
        showPoweredBy: true,
        accent: '#ffff00',
        background: '',
        actor: SYSTEM
      }),
      RequestRefused
    );
    await setFormAppearance({
      organisationId: org.id,
      linkId: null,
      showPoweredBy: false,
      accent: '#0b6e4f',
      background: 'transparent',
      logo: PNG,
      actor: SYSTEM
    });
    const foi = await form('foi');
    for (const slug of [privacy.slug, foi.slug]) {
      const look = (await openIntakeLink(slug))?.appearance;
      assert.equal(look?.accentColour, '#0b6e4f', slug);
      assert.equal(look?.showPoweredBy, false, slug);
      const logo = await formLogo(slug);
      assert.deepEqual(new Uint8Array(logo!.content), PNG, slug);
    }
    const listed = await formAppearancesFor(org.id);
    assert.equal(listed.forLink(foi.id).source, 'organisation');
  });

  it('lets one form have its own, keeping the logo it showed, and go back', async () => {
    const { org, form } = await anOrg('Own');
    const main = await form();
    await setFormAppearance({
      organisationId: org.id,
      linkId: null,
      showPoweredBy: true,
      accent: '#0b6e4f',
      background: '',
      logo: PNG,
      actor: SYSTEM
    });
    const own = { ...main };
    await assert.rejects(
      setFormAppearance({
        organisationId: org.id,
        linkId: own.id,
        kind: 'foi',
        showPoweredBy: true,
        accent: '',
        background: '',
        actor: SYSTEM
      }),
      RequestRefused
    );
    await setFormAppearance({
      organisationId: org.id,
      linkId: own.id,
      kind: 'data_protection',
      showPoweredBy: true,
      accent: '#1c4371',
      background: '#ffffff',
      actor: SYSTEM
    });
    const look = (await openIntakeLink(own.slug))?.appearance;
    assert.equal(look?.accentColour, '#1c4371');
    assert.equal(look?.background, '#ffffff');
    // It kept the organisation's logo, as its own copy.
    assert.ok(look?.logoSha256);
    assert.ok(await formLogo(own.slug));
    assert.equal(
      (await formAppearancesFor(org.id)).forLink(own.id).source,
      'form'
    );

    await clearFormAppearance({
      organisationId: org.id,
      linkId: own.id,
      kind: 'data_protection',
      actor: SYSTEM
    });
    assert.equal(
      (await openIntakeLink(own.slug))?.appearance.accentColour,
      '#0b6e4f'
    );
    const actions = (
      await db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, org.id))
    ).map((e) => e.action);
    assert.equal(
      actions.filter((a) => a === 'intake.appearance_set').length,
      2
    );
    assert.ok(actions.includes('intake.appearance_cleared'));
  });

  it('shows no logo for a withdrawn form, or an FOI form whose entity has no Act', async () => {
    const { org, entity, form } = await anOrg('Closed', 'foia');
    await setFormAppearance({
      organisationId: org.id,
      linkId: null,
      showPoweredBy: true,
      accent: '',
      background: '',
      logo: PNG,
      actor: SYSTEM
    });
    const foi = await form('foi');
    const privacy = await form();
    assert.ok(await formLogo(foi.slug));
    await db
      .update(entities)
      .set({ foiAct: null })
      .where(eq(entities.id, entity.id));
    assert.equal(await formLogo(foi.slug), null);
    await revokeIntakeLink({
      linkId: privacy.id,
      organisationId: org.id,
      actor: SYSTEM
    });
    assert.equal(await formLogo(privacy.slug), null);
  });

  it('is served from the form address with its type, cached by its hash', async () => {
    const { org, form } = await anOrg('Route');
    const privacy = await form();
    const get = (slug: string) =>
      logoRoute(new Request(`http://govern.test/request/${slug}/logo`), {
        params: Promise.resolve({ slug })
      });
    assert.equal((await get(privacy.slug)).status, 404);
    await setFormAppearance({
      organisationId: org.id,
      linkId: null,
      showPoweredBy: true,
      accent: '',
      background: '',
      logo: PNG,
      actor: SYSTEM
    });
    const response = await get(privacy.slug);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.match(response.headers.get('cache-control') ?? '', /immutable/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
  });
});
