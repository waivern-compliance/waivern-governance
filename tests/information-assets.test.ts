import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';

import { db, sql as pg, withOrganisation } from '@/db/client';
import {
  auditEvents,
  entities,
  informationAssets,
  memberships,
  organisations,
  tasks,
  users
} from '@/db/schema';
import {
  assetGaps,
  classificationLabel,
  matchesFilter,
  type AssetFacts
} from '@/lib/assets/register';
import {
  assetRegister,
  assetsFor,
  classificationSchemeOf,
  createAsset,
  linkAsset,
  loadAsset,
  recordAssetReview,
  retireAsset,
  setClassificationScheme,
  unlinkAsset,
  updateAsset,
  type AssetDetails
} from '@/services/information-assets';
import { createRisk } from '@/services/risks';
import { createActivity } from '@/services/ropa';
import { sweepOrganisation } from '@/services/sweep';
import { createSupplier } from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'asset test'
};
const DAY = 86_400_000;

after(() => pg.end());

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Assets ${label}`,
      slug: `assets-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [main] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main Ltd', isDefault: true })
    .returning();
  const [other] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Other Ltd' })
    .returning();
  const [person] = await db
    .insert(users)
    .values({ email: `iao-${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: person.id });
  const activity = await createActivity({
    organisationId: org.id,
    entityId: main.id,
    name: 'Payroll',
    actor: SYSTEM
  });
  const otherActivity = await createActivity({
    organisationId: org.id,
    entityId: other.id,
    name: 'Other payroll',
    actor: SYSTEM
  });
  const risk = await createRisk({
    organisationId: org.id,
    entityId: main.id,
    title: 'HR system unpatched',
    description: 'x',
    likelihood: 2,
    impact: 2,
    actor: SYSTEM
  });
  const supplier = await createSupplier({
    organisationId: org.id,
    name: `Hosting ${label}`,
    actor: SYSTEM
  });
  return { org, main, other, person, activity, otherActivity, risk, supplier };
}

const details = (overrides: Partial<AssetDetails> = {}): AssetDetails => ({
  name: 'HR system',
  description: 'Employee records and payroll',
  assetType: 'saas_application',
  ownerId: null,
  hosting: 'saas',
  hostedBy: 'A provider',
  region: 'UK South',
  countries: ['United Kingdom', ' United Kingdom ', ''],
  classification: 'confidential',
  retention: 'Six years after employment ends',
  nextReviewAt: new Date(Date.now() + 300 * DAY),
  ...overrides
});

/** The database's own refusal, which arrives as the cause of a failed query. */
const refusedBy = (pattern: RegExp) => (error: Error) =>
  pattern.test(
    `${error.message} ${(error.cause as Error | undefined)?.message ?? ''}`
  );

async function eventsFor(organisationId: string, subjectId: string) {
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.subjectId, subjectId)
      )
    );
}

describe('the rules', () => {
  const complete: AssetFacts = {
    ownerId: 'u',
    hosting: 'cloud',
    classification: 'internal',
    retention: 'Seven years',
    nextReviewAt: new Date(Date.now() + DAY),
    retiredAt: null
  };

  it('names what an asset does not yet say, with an overdue review first', () => {
    assert.deepEqual(assetGaps(complete), []);
    assert.deepEqual(
      assetGaps({
        ...complete,
        ownerId: null,
        nextReviewAt: new Date(Date.now() - DAY)
      }),
      ['review_overdue', 'no_owner']
    );
    assert.deepEqual(
      assetGaps({
        ownerId: null,
        hosting: null,
        classification: null,
        retention: ' ',
        nextReviewAt: null,
        retiredAt: null
      }),
      [
        'no_owner',
        'unclassified',
        'no_location',
        'no_retention',
        'no_review_date'
      ]
    );
  });

  it('asks nothing of a retired asset', () => {
    assert.deepEqual(
      assetGaps({
        ...complete,
        ownerId: null,
        nextReviewAt: new Date(Date.now() - DAY),
        retiredAt: new Date()
      }),
      []
    );
  });

  it('filters by owner, classification, type, overdue review and retirement', () => {
    const asset = { ...complete, assetType: 'database' };
    assert.ok(matchesFilter(asset, {}));
    assert.ok(matchesFilter(asset, { ownerId: 'u' }));
    assert.ok(!matchesFilter(asset, { ownerId: 'none' }));
    assert.ok(matchesFilter({ ...asset, ownerId: null }, { ownerId: 'none' }));
    assert.ok(matchesFilter(asset, { classification: 'internal' }));
    assert.ok(!matchesFilter(asset, { classification: 'none' }));
    assert.ok(!matchesFilter(asset, { assetType: 'device' }));
    assert.ok(!matchesFilter(asset, { overdue: true }));
    assert.ok(
      matchesFilter(
        { ...asset, nextReviewAt: new Date(Date.now() - DAY) },
        { overdue: true }
      )
    );
    const retired = { ...asset, retiredAt: new Date() };
    assert.ok(!matchesFilter(retired, {}));
    assert.ok(matchesFilter(retired, { retired: true }));
  });

  it('labels a classification from whichever scheme it belongs to', () => {
    assert.equal(
      classificationLabel('official_sensitive'),
      'Official-Sensitive'
    );
    assert.equal(classificationLabel('restricted'), 'Restricted');
    assert.equal(classificationLabel(null), null);
  });
});

describe('the register', () => {
  it('numbers assets from its own counter and records who added each', async () => {
    const w = await world('create');
    const year = new Date().getUTCFullYear();
    const first = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details({ ownerId: w.person.id }),
      actor: SYSTEM
    });
    const second = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details({ name: 'File share', assetType: 'file_share' }),
      actor: SYSTEM
    });
    assert.equal(first.reference, `IA-${year}-0001`);
    assert.equal(second.reference, `IA-${year}-0002`);
    assert.deepEqual(first.countries, ['United Kingdom']);

    const events = await eventsFor(w.org.id, first.id);
    assert.deepEqual(
      events.map((e) => e.action),
      ['information_asset.created']
    );
    assert.equal(events[0].entityId, w.main.id);
    assert.equal(
      (events[0].after as Record<string, unknown>).reference,
      first.reference
    );

    // Another organisation's counter starts again.
    const v = await world('create-other');
    const theirs = await createAsset({
      organisationId: v.org.id,
      entityId: v.main.id,
      details: details(),
      actor: SYSTEM
    });
    assert.equal(theirs.reference, `IA-${year}-0001`);
  });

  it('refuses what is not an asset type, a hosting model or a level of the scheme', async () => {
    const w = await world('refuse');
    const make = (d: Partial<AssetDetails>) =>
      createAsset({
        organisationId: w.org.id,
        entityId: w.main.id,
        details: details(d),
        actor: SYSTEM
      });
    await assert.rejects(make({ name: '  ' }), /name/);
    await assert.rejects(make({ assetType: 'spreadsheet' }), /kind of asset/);
    await assert.rejects(make({ hosting: 'moon' }), /hosted/);
    await assert.rejects(
      make({ classification: 'official_sensitive' }),
      /not a level of the neutral scheme/
    );
  });

  it('refuses an owner or a legal entity from another organisation', async () => {
    const w = await world('tenancy');
    const v = await world('tenancy-other');
    await assert.rejects(
      createAsset({
        organisationId: w.org.id,
        entityId: v.main.id,
        details: details(),
        actor: SYSTEM
      }),
      /No such legal entity/
    );
    await assert.rejects(
      createAsset({
        organisationId: w.org.id,
        entityId: w.main.id,
        details: details({ ownerId: v.person.id }),
        actor: SYSTEM
      }),
      /not a member/
    );
  });

  it('records an edit with what it was and what it became', async () => {
    const w = await world('edit');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details(),
      actor: SYSTEM
    });
    await updateAsset({
      id: asset.id,
      organisationId: w.org.id,
      details: details({ ownerId: w.person.id, classification: 'restricted' }),
      actor: SYSTEM
    });
    const [event] = (await eventsFor(w.org.id, asset.id)).filter(
      (e) => e.action === 'information_asset.updated'
    );
    assert.equal(
      (event.before as Record<string, unknown>).classification,
      'confidential'
    );
    assert.equal(
      (event.after as Record<string, unknown>).classification,
      'restricted'
    );
    assert.equal((event.after as Record<string, unknown>).ownerId, w.person.id);
  });
});

describe('links', () => {
  it("links its own entity's activities and risks, and any supplier, both ways", async () => {
    const w = await world('links');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details(),
      actor: SYSTEM
    });
    const link = (kind: 'activity' | 'supplier' | 'risk', targetId: string) =>
      linkAsset({
        assetId: asset.id,
        organisationId: w.org.id,
        kind,
        targetId,
        actor: SYSTEM
      });
    await link('activity', w.activity.id);
    await link('supplier', w.supplier.id);
    await link('risk', w.risk.id);
    await assert.rejects(link('risk', w.risk.id), /already linked/);

    const loaded = await loadAsset(asset.id, w.org.id);
    assert.deepEqual(
      loaded?.activities.map((a) => a.id),
      [w.activity.id]
    );
    assert.deepEqual(
      loaded?.suppliers.map((s) => s.id),
      [w.supplier.id]
    );
    assert.deepEqual(
      loaded?.risks.map((r) => r.id),
      [w.risk.id]
    );

    for (const about of [
      { activityId: w.activity.id },
      { supplierId: w.supplier.id },
      { riskId: w.risk.id }
    ]) {
      const found = await assetsFor(w.org.id, about, null);
      assert.deepEqual(
        found.map((a) => a.id),
        [asset.id]
      );
      // Not shown to somebody who may see only another entity.
      assert.deepEqual(await assetsFor(w.org.id, about, [w.other.id]), []);
    }

    await unlinkAsset({
      assetId: asset.id,
      organisationId: w.org.id,
      kind: 'risk',
      targetId: w.risk.id,
      actor: SYSTEM
    });
    assert.deepEqual(
      await assetsFor(w.org.id, { riskId: w.risk.id }, null),
      []
    );
    const actions = (await eventsFor(w.org.id, asset.id)).map((e) => e.action);
    assert.equal(
      actions.filter((a) => a === 'information_asset.linked').length,
      3
    );
    assert.ok(actions.includes('information_asset.unlinked'));
  });

  it("refuses another legal entity's activity", async () => {
    const w = await world('cross-entity');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details(),
      actor: SYSTEM
    });
    await assert.rejects(
      linkAsset({
        assetId: asset.id,
        organisationId: w.org.id,
        kind: 'activity',
        targetId: w.otherActivity.id,
        actor: SYSTEM
      }),
      /another legal entity/
    );
  });

  it("refuses another organisation's activity, supplier and risk", async () => {
    const w = await world('cross-tenant');
    const v = await world('cross-tenant-other');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details(),
      actor: SYSTEM
    });
    for (const [kind, targetId] of [
      ['activity', v.activity.id],
      ['supplier', v.supplier.id],
      ['risk', v.risk.id]
    ] as const) {
      await assert.rejects(
        linkAsset({
          assetId: asset.id,
          organisationId: w.org.id,
          kind,
          targetId,
          actor: SYSTEM
        }),
        /in this organisation/
      );
    }
    // Nor can another organisation act on this asset at all.
    await assert.rejects(
      linkAsset({
        assetId: asset.id,
        organisationId: v.org.id,
        kind: 'supplier',
        targetId: v.supplier.id,
        actor: SYSTEM
      }),
      /No such information asset/
    );
  });

  it('refuses a cross-entity or cross-tenant link written straight to the table', async () => {
    const w = await world('trigger');
    const v = await world('trigger-other');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details(),
      actor: SYSTEM
    });
    await assert.rejects(
      db.execute(sql`
        insert into information_asset_activity (organisation_id, asset_id, activity_id)
        values (${w.org.id}, ${asset.id}, ${w.otherActivity.id})`),
      refusedBy(/own legal entity/)
    );
    await assert.rejects(
      db.execute(sql`
        insert into information_asset_supplier (organisation_id, asset_id, supplier_id)
        values (${w.org.id}, ${asset.id}, ${v.supplier.id})`),
      refusedBy(/own organisation/)
    );
  });
});

describe('row-level security', () => {
  it('shows an organisation only its own assets and links, whatever the query forgets', async () => {
    const w = await world('rls');
    const v = await world('rls-other');
    for (const x of [w, v]) {
      const asset = await createAsset({
        organisationId: x.org.id,
        entityId: x.main.id,
        details: details(),
        actor: SYSTEM
      });
      await linkAsset({
        assetId: asset.id,
        organisationId: x.org.id,
        kind: 'supplier',
        targetId: x.supplier.id,
        actor: SYSTEM
      });
    }
    await withOrganisation(w.org.id, async () => {
      for (const table of ['information_asset', 'information_asset_supplier']) {
        const rows = (await db.execute(
          sql`select organisation_id from ${sql.identifier(table)}`
        )) as unknown as Array<{ organisation_id: string }>;
        assert.ok(rows.length > 0);
        assert.ok(
          rows.every((r) => r.organisation_id === w.org.id),
          `${table} showed another organisation's row`
        );
      }
    });
    await assert.rejects(
      withOrganisation(w.org.id, () =>
        db.execute(sql`
          insert into information_asset (organisation_id, entity_id, reference, name, asset_type)
          values (${v.org.id}, ${v.main.id}, 'IA-X', 'Planted', 'system')`)
      ),
      refusedBy(/row-level security/)
    );
  });
});

describe('classification scheme', () => {
  it('can be changed until an asset is classified, and not after', async () => {
    const w = await world('scheme');
    assert.equal(await classificationSchemeOf(w.org.id), 'neutral');
    await setClassificationScheme({
      organisationId: w.org.id,
      scheme: 'uk_government',
      actor: SYSTEM
    });
    assert.equal(await classificationSchemeOf(w.org.id), 'uk_government');
    await assert.rejects(
      createAsset({
        organisationId: w.org.id,
        entityId: w.main.id,
        details: details({ classification: 'confidential' }),
        actor: SYSTEM
      }),
      /Government Security Classifications/
    );
    await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details({ classification: 'official_sensitive' }),
      actor: SYSTEM
    });
    await assert.rejects(
      setClassificationScheme({
        organisationId: w.org.id,
        scheme: 'neutral',
        actor: SYSTEM
      }),
      /already classified/
    );
    await assert.rejects(
      db
        .update(organisations)
        .set({ assetClassificationScheme: 'neutral' })
        .where(eq(organisations.id, w.org.id)),
      refusedBy(/already classified/)
    );
    const events = await eventsFor(w.org.id, w.org.id);
    assert.ok(
      events.some(
        (e) => e.action === 'organisation.asset_classification_scheme_set'
      )
    );
  });
});

describe('classification scheme, under change', () => {
  it('waits for a scheme change in flight, then classifies on the new scheme', async () => {
    const w = await world('scheme-race');
    let changed!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((r) => (changed = r));
    const gate = new Promise<void>((r) => (release = r));
    const changing = pg.begin(async (t) => {
      await t`update organisation set asset_classification_scheme = 'uk_government' where id = ${w.org.id}`;
      changed();
      await gate;
    });
    await locked;
    const creating = createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details({ classification: 'confidential' }),
      actor: SYSTEM
    });
    setTimeout(release, 200);
    await changing;
    await assert.rejects(creating, /Government Security Classifications/);
  });

  it('is not fixed by a classified asset that has been retired', async () => {
    const w = await world('scheme-retired');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details({ classification: 'restricted' }),
      actor: SYSTEM
    });
    await retireAsset({
      id: asset.id,
      organisationId: w.org.id,
      reason: 'Decommissioned',
      actor: SYSTEM
    });
    await setClassificationScheme({
      organisationId: w.org.id,
      scheme: 'uk_government',
      actor: SYSTEM
    });
    assert.equal(await classificationSchemeOf(w.org.id), 'uk_government');
    const loaded = await loadAsset(asset.id, w.org.id);
    assert.equal(
      classificationLabel(loaded!.asset.classification),
      'Restricted'
    );
  });
});

describe('reviews and retiring', () => {
  it('records a review only with a future date', async () => {
    const w = await world('review');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details({ nextReviewAt: new Date(Date.now() - DAY) }),
      actor: SYSTEM
    });
    await assert.rejects(
      recordAssetReview({
        id: asset.id,
        organisationId: w.org.id,
        nextReviewAt: new Date(Date.now() - DAY),
        actor: SYSTEM
      }),
      /future/
    );
    const reviewed = await recordAssetReview({
      id: asset.id,
      organisationId: w.org.id,
      nextReviewAt: new Date(Date.now() + 365 * DAY),
      actor: SYSTEM
    });
    assert.ok(reviewed.lastReviewedAt);
    assert.ok(
      (await eventsFor(w.org.id, asset.id)).some(
        (e) => e.action === 'information_asset.reviewed'
      )
    );
  });

  it('raises one task a month for assets past review, and none for retired ones', async () => {
    const w = await world('sweep');
    const make = (name: string) =>
      createAsset({
        organisationId: w.org.id,
        entityId: w.main.id,
        details: details({ name, nextReviewAt: new Date(Date.now() - DAY) }),
        actor: SYSTEM
      });
    await make('Old CRM');
    const retired = await make('Old fax server');
    await retireAsset({
      id: retired.id,
      organisationId: w.org.id,
      reason: 'Decommissioned',
      actor: SYSTEM
    });

    const result = await sweepOrganisation(w.org.id);
    assert.equal(result.assetReviewsRaised, 1);
    const raised = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, w.org.id),
          eq(tasks.subjectType, 'information_asset')
        )
      );
    assert.equal(raised.length, 1);
    assert.match(raised[0].title, /Old CRM is due for review/);
    assert.equal(
      (await sweepOrganisation(w.org.id)).assetReviewsRaised,
      0,
      'a second sweep in the month raised another task'
    );
  });

  it('keeps a retired asset as it was, and hides it unless asked', async () => {
    const w = await world('retire');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: details(),
      actor: SYSTEM
    });
    await assert.rejects(
      retireAsset({
        id: asset.id,
        organisationId: w.org.id,
        reason: ' ',
        actor: SYSTEM
      }),
      /why/
    );
    await retireAsset({
      id: asset.id,
      organisationId: w.org.id,
      reason: 'Replaced',
      actor: SYSTEM
    });
    await assert.rejects(
      updateAsset({
        id: asset.id,
        organisationId: w.org.id,
        details: details({ name: 'Renamed' }),
        actor: SYSTEM
      }),
      /retired/
    );
    await assert.rejects(
      linkAsset({
        assetId: asset.id,
        organisationId: w.org.id,
        kind: 'supplier',
        targetId: w.supplier.id,
        actor: SYSTEM
      }),
      /retired/
    );
    const rows = await assetRegister(w.org.id, null);
    const [row] = rows.filter((r) => r.asset.id === asset.id);
    assert.equal(row.asset.retiredReason, 'Replaced');
    assert.ok(!matchesFilter(row.asset, {}));
    assert.ok(matchesFilter(row.asset, { retired: true }));
    const [stored] = await db
      .select()
      .from(informationAssets)
      .where(eq(informationAssets.id, asset.id));
    assert.equal(stored.name, 'HR system');
  });
});
