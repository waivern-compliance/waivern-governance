import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { auditEvents, entities, organisations } from '@/db/schema';
import {
  AppearanceRefused,
  checkAppearance,
  checkLogo,
  contrast,
  parseHex
} from '@/lib/form-appearance';
import { RequestRefused } from '@/services/data-subject-requests';
import {
  intakeFormLogo,
  issueIntakeLink,
  openIntakeLink,
  revokeIntakeLink,
  setIntakeLinkAppearance
} from '@/services/dsr-intake';

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

describe('setting how a form looks', () => {
  it('is saved, shown on the form, audited, and kept to its own kind', async () => {
    const [org] = await db
      .insert(organisations)
      .values({ name: 'Look', slug: `look-${crypto.randomUUID().slice(0, 8)}` })
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
    const standard = await openIntakeLink(link.slug);
    assert.deepEqual(standard?.appearance, {
      showPoweredBy: true,
      accentColour: null,
      background: null,
      logoSha256: null
    });

    const set = (
      over: Partial<Parameters<typeof setIntakeLinkAppearance>[0]>
    ) =>
      setIntakeLinkAppearance({
        linkId: link.id,
        organisationId: org.id,
        kind: 'data_protection',
        showPoweredBy: true,
        accent: '',
        background: '',
        actor: SYSTEM,
        ...over
      });

    await assert.rejects(set({ kind: 'foi' }), RequestRefused);
    await assert.rejects(set({ accent: '#ffff00' }), RequestRefused);

    await set({
      showPoweredBy: false,
      accent: '#0b6e4f',
      background: 'transparent',
      logo: PNG
    });
    const styled = await openIntakeLink(link.slug);
    assert.equal(styled?.appearance.showPoweredBy, false);
    assert.equal(styled?.appearance.accentColour, '#0b6e4f');
    assert.equal(styled?.appearance.background, 'transparent');
    assert.match(styled?.appearance.logoSha256 ?? '', /^[0-9a-f]{64}$/);
    const logo = await intakeFormLogo(link.slug);
    assert.equal(logo?.contentType, 'image/png');
    assert.deepEqual(new Uint8Array(logo!.content), PNG);

    // Keeping the logo when none is uploaded, and removing it when asked.
    await set({ accent: '#1c4371' });
    assert.ok(await intakeFormLogo(link.slug));
    await set({ logo: null });
    assert.equal(await intakeFormLogo(link.slug), null);
    assert.equal(
      (await openIntakeLink(link.slug))?.appearance.logoSha256,
      null
    );

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'intake.appearance_set')
        )
      );
    assert.equal(events.length, 3);

    // A withdrawn form shows no logo.
    await set({ logo: PNG });
    await revokeIntakeLink({
      linkId: link.id,
      organisationId: org.id,
      actor: SYSTEM
    });
    assert.equal(await intakeFormLogo(link.slug), null);
  });
});
