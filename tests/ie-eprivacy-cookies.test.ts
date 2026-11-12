import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  organisations,
  processingActivities,
  storageItems
} from '@/db/schema';
import {
  irishGapsOf,
  irishPropertyGaps,
  lifespanMonths,
  suggestedIrishBasis
} from '@/lib/ie-eprivacy/storage';
import { startScan } from '@/lib/pecr/analyser-client';
import { setDataProtectionLaw, setIeEprivacy } from '@/services/entities';
import {
  addItem,
  createProperty,
  InventoryRefused,
  loadProperty,
  propertyRegister,
  recordStorageDecision,
  setCookieLifespanThreshold,
  updateProperty
} from '@/services/storage-inventory';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Irish cookies test'
};

after(() => pg.end());

async function world(label: string, scope: 'uk' | 'ie' | 'uk_ie') {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `IE cookies ${label}`,
      slug: `iec-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Shop Ltd', isDefault: true })
    .returning();
  await setDataProtectionLaw({
    organisationId: org.id,
    entityId: entity.id,
    law: 'uk_eu',
    actor: SYSTEM
  });
  await setIeEprivacy({
    organisationId: org.id,
    entityId: entity.id,
    applies: true,
    actor: SYSTEM
  });
  const property = await createProperty({
    organisationId: org.id,
    entityId: entity.id,
    name: 'Shop',
    url: 'https://shop.example.ie',
    eprivacyScope: scope,
    actor: SYSTEM
  });
  return { org, entity, property };
}

const item = async (
  w: Awaited<ReturnType<typeof world>>,
  name: string,
  more: { expiry?: string; category?: string } = {}
) => {
  const added = await addItem({
    propertyId: w.property.id,
    organisationId: w.org.id,
    name,
    expiry: more.expiry ?? null,
    actor: SYSTEM
  });
  if (more.category)
    await db
      .update(storageItems)
      .set({ suggestedCategory: more.category })
      .where(eq(storageItems.id, added.id));
  return added;
};

const decide = (
  w: Awaited<ReturnType<typeof world>>,
  itemId: string,
  basis: 'consent' | 'strictly_necessary' | 'statistics' | 'transmission',
  law: 'uk' | 'ie',
  conditions: Record<string, boolean> = {}
) =>
  recordStorageDecision({
    itemId,
    organisationId: w.org.id,
    basis,
    conditions,
    rationale: 'Because.',
    law,
    actor: SYSTEM
  });

describe('the Irish rules, on their own', () => {
  it('reads how long an item lasts, and gives up rather than guess', () => {
    assert.equal(lifespanMonths('Session'), 0);
    assert.equal(lifespanMonths('13 months'), 13);
    assert.equal(lifespanMonths('2 years'), 24);
    assert.ok(Math.abs(lifespanMonths('400 days')! - 13.15) < 0.01);
    assert.equal(lifespanMonths('until you log out'), null);
    // Every part counts, and the usual abbreviations are read.
    assert.equal(lifespanMonths('1 year 6 months'), 18);
    assert.equal(lifespanMonths('18mo'), 18);
    assert.equal(lifespanMonths('1 yr'), 12);
    assert.equal(lifespanMonths(null), null);
  });

  it('suggests consent for everything but strictly necessary', () => {
    assert.equal(
      suggestedIrishBasis('strictly_necessary'),
      'strictly_necessary'
    );
    assert.equal(suggestedIrishBasis('analytics'), 'consent');
    assert.equal(suggestedIrishBasis('functional'), 'consent');
    assert.equal(suggestedIrishBasis('unknown'), null);
  });

  const base = {
    item: {
      status: 'active',
      suggestedCategory: null as string | null,
      expiry: null as string | null,
      seenBeforeConsent: false,
      seenAfterReject: false
    },
    property: { informationUrl: 'https://shop.example.ie/cookies' },
    lifespanThresholdMonths: 12
  };
  const kinds = (input: Parameters<typeof irishGapsOf>[0]) =>
    irishGapsOf(input).map((g) => g.kind);

  it('flags analytics and advertising without consent, quoting the Commission', () => {
    const analytics = { ...base.item, suggestedCategory: 'analytics' };
    const gaps = irishGapsOf({
      ...base,
      item: analytics,
      decision: {
        basis: 'strictly_necessary',
        conditions: { requested_service: true }
      }
    });
    assert.deepEqual(
      gaps.map((g) => g.kind),
      ['analytics_needs_consent']
    );
    assert.match(gaps[0].text, /'unlikely' to be an enforcement priority/);
    assert.deepEqual(kinds({ ...base, item: analytics, decision: null }), [
      'no_basis',
      'analytics_needs_consent'
    ]);
    assert.deepEqual(
      kinds({
        ...base,
        item: { ...base.item, suggestedCategory: 'advertising' },
        decision: {
          basis: 'strictly_necessary',
          conditions: { requested_service: true }
        }
      }),
      ['advertising_not_necessary']
    );
    assert.deepEqual(
      kinds({
        ...base,
        item: analytics,
        decision: { basis: 'consent', conditions: {} }
      }),
      []
    );
  });

  it('flags a strictly necessary item outliving the threshold', () => {
    const decision = {
      basis: 'strictly_necessary' as const,
      conditions: { requested_service: true }
    };
    assert.deepEqual(
      kinds({ ...base, item: { ...base.item, expiry: '2 years' }, decision }),
      ['lifespan_long']
    );
    assert.deepEqual(
      kinds({ ...base, item: { ...base.item, expiry: '6 months' }, decision }),
      []
    );
    assert.deepEqual(
      kinds({
        ...base,
        item: { ...base.item, expiry: '2 years' },
        decision,
        lifespanThresholdMonths: 36
      }),
      []
    );
  });

  it('asks how long consent lasts, and about the banner, only where consent is used', () => {
    const none = {
      consentRenewalMonths: null,
      consentRenewalJustification: null,
      bannerChecks: {},
      linkedToRopa: true
    };
    assert.deepEqual(irishPropertyGaps({ ...none, usesConsent: false }), []);
    const all = {
      reject_as_prominent: true,
      per_purpose: true,
      no_preticked: true,
      no_implied: true,
      withdraw_easily: true,
      policies_readable: true
    };
    assert.equal(irishPropertyGaps({ ...none, usesConsent: true }).length, 7);
    assert.match(
      irishPropertyGaps({
        consentRenewalMonths: 12,
        consentRenewalJustification: null,
        bannerChecks: all,
        linkedToRopa: true,
        usesConsent: true
      })[0],
      /lasts 12 months, longer than the Commission's 6/
    );
    assert.deepEqual(
      irishPropertyGaps({
        consentRenewalMonths: 12,
        consentRenewalJustification: 'A members-only site visited yearly.',
        bannerChecks: all,
        linkedToRopa: true,
        usesConsent: true
      }),
      []
    );
  });
});

describe('the Irish rules on the register', () => {
  it('records a basis per law, and refuses an exception Irish law does not have', async () => {
    const w = await world('both', 'uk_ie');
    const it1 = await item(w, '_ga', { category: 'analytics' });
    await assert.rejects(
      decide(w, it1.id, 'statistics', 'ie'),
      /no statistics exception/
    );
    await decide(w, it1.id, 'statistics', 'uk', {
      provider_collects: true,
      sole_purpose: true,
      shared_only_to_improve: true
    });
    await decide(w, it1.id, 'consent', 'ie');
    const loaded = (await loadProperty(w.property.id, w.org.id))!;
    const [got] = loaded.items;
    assert.equal(got.decision?.basis, 'statistics');
    assert.equal(got.irishDecision?.basis, 'consent');
    assert.ok(got.gaps.every((g) => /^(PECR|Irish Regulations): /.test(g)));
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.subjectId, it1.id),
          eq(auditEvents.action, 'pecr.basis_decided')
        )
      );
    assert.deepEqual(
      events.map((e) => (e.after as { law: string }).law).sort(),
      ['ie', 'uk']
    );
  });

  it('refuses a law the website does not answer to', async () => {
    const w = await world('uk-only', 'uk');
    const it1 = await item(w, 'session');
    await assert.rejects(decide(w, it1.id, 'consent', 'ie'), InventoryRefused);
    const ie = await world('ie-only', 'ie');
    const it2 = await item(ie, 'session');
    await assert.rejects(
      decide(ie, it2.id, 'consent', 'uk'),
      /not recorded as under UK PECR/
    );
  });

  it('flags long-lived strictly necessary items against a threshold changed only with a reason', async () => {
    const w = await world('lifespan', 'ie');
    const it1 = await item(w, 'prefs', { expiry: '18 months' });
    await decide(w, it1.id, 'strictly_necessary', 'ie', {
      requested_service: true
    });
    const kindsNow = async () =>
      (await loadProperty(w.property.id, w.org.id))!.items[0].gapList.map(
        (g) => g.kind
      );
    assert.deepEqual(await kindsNow(), ['lifespan_long']);

    await assert.rejects(
      setCookieLifespanThreshold({
        organisationId: w.org.id,
        months: 24,
        justification: null,
        actor: SYSTEM
      }),
      /Say specifically why 24 months/
    );
    await setCookieLifespanThreshold({
      organisationId: w.org.id,
      months: 24,
      justification: 'Our login cookies are renewed every two years by design.',
      actor: SYSTEM
    });
    assert.deepEqual(await kindsNow(), []);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'pecr.lifespan_threshold_changed')
        )
      );
    assert.equal((event.after as { months: number }).months, 24);
  });

  it('asks the site-wide questions once something relies on consent', async () => {
    const w = await world('banner', 'ie');
    const it1 = await item(w, '_fbp', { category: 'advertising' });
    assert.deepEqual(
      (await loadProperty(w.property.id, w.org.id))!.irishPropertyGaps,
      []
    );
    await decide(w, it1.id, 'consent', 'ie');
    assert.equal(
      (await loadProperty(w.property.id, w.org.id))!.irishPropertyGaps.length,
      8
    );
    // The register counts them too, not only the website's own page.
    assert.equal(
      (await propertyRegister(w.org.id, null))[0].siteGaps.length,
      8
    );
    const [ropa] = await db
      .insert(processingActivities)
      .values({
        organisationId: w.org.id,
        entityId: w.entity.id,
        reference: 'ROPA-2026-7001',
        name: 'Website analytics and advertising'
      })
      .returning();
    // Another entity's record is another controller's.
    const [other] = await db
      .insert(entities)
      .values({ organisationId: w.org.id, name: 'Other Ltd' })
      .returning();
    const [theirs] = await db
      .insert(processingActivities)
      .values({
        organisationId: w.org.id,
        entityId: other.id,
        reference: 'ROPA-2026-7002',
        name: 'Their website'
      })
      .returning();
    await assert.rejects(
      updateProperty({
        propertyId: w.property.id,
        organisationId: w.org.id,
        changes: { processingActivityId: theirs.id },
        actor: SYSTEM
      }),
      /own entity's processing activities/
    );
    await updateProperty({
      propertyId: w.property.id,
      organisationId: w.org.id,
      changes: {
        consentRenewalMonths: 6,
        processingActivityId: ropa.id,
        bannerChecks: [
          'reject_as_prominent',
          'per_purpose',
          'no_preticked',
          'no_implied',
          'withdraw_easily',
          'policies_readable',
          'not_a_check'
        ]
      },
      actor: SYSTEM
    });
    const [row] = await propertyRegister(w.org.id, null);
    assert.equal(row.siteGaps.length, 0);
    const loaded = (await loadProperty(w.property.id, w.org.id))!;
    assert.deepEqual(loaded.irishPropertyGaps, []);
    assert.equal('not_a_check' in loaded.property.bannerChecks, false);
  });
});

describe('scanning an Irish website', () => {
  it('asks the analyser for an EU scan from the start', async () => {
    const regions: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      regions.push(new URLSearchParams(String(init?.body)).get('region')!);
      return new Response(null, {
        status: 303,
        headers: { location: '/runs/run-1/progress' }
      });
    }) as typeof fetch;
    const started = await startScan(
      'https://analyser.example',
      'wvn_x',
      'https://shop.example.ie',
      { fetchImpl },
      'eu'
    );
    assert.equal(started.region, 'eu');
    assert.deepEqual(regions, ['eu']);
  });
});
