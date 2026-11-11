import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { entities, organisations, processingActivities } from '@/db/schema';
import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import { lawfulBasisGaps } from '@/lib/gdpr/lawful-basis';
import {
  effectiveLaws,
  lawsLabel,
  lawsOf,
  narrowedTo,
  withinEntity
} from '@/lib/gdpr/regimes';
import { EntityRefused, setDataProtectionLaw } from '@/services/entities';
import {
  article30Gaps,
  createActivity,
  gapWordsFor,
  registerHealth,
  updateActivity,
  type Activity
} from '@/services/ropa';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'records under both laws test'
};

after(() => pg.end());

describe('the laws a record is under', () => {
  it('name, contain and narrow', () => {
    assert.deepEqual(lawsOf('uk_eu'), ['uk', 'eu']);
    assert.equal(lawsLabel('uk_eu'), 'UK GDPR and EU GDPR');
    assert.equal(withinEntity('uk_eu', 'eu'), true);
    assert.equal(withinEntity('uk', 'uk_eu'), false);
    assert.equal(withinEntity('eu', 'uk'), false);
    // A record is never judged under a law its entity is not subject to.
    assert.equal(effectiveLaws('eu', 'uk'), 'eu');
    assert.equal(effectiveLaws('uk_eu', 'eu'), 'eu');
    assert.equal(narrowedTo('uk_eu', 'uk'), 'uk');
    assert.equal(narrowedTo('uk', 'uk'), 'uk');
    assert.equal(narrowedTo('eu', 'uk'), null);
  });
});

describe('the lawful basis under each law', () => {
  const ea = ['recognised_legitimate_interests'] as const;
  it('asks for an EU basis beside recognised legitimate interests on a dual record', () => {
    assert.deepEqual(
      lawfulBasisGaps({
        bases: ea,
        recognisedCondition: 'crime',
        ukLaw: true,
        euLaw: true
      }),
      ['ea_without_eu_basis']
    );
    assert.deepEqual(
      lawfulBasisGaps({
        bases: [...ea, 'legitimate_interests'],
        recognisedCondition: 'crime',
        ukLaw: true,
        euLaw: true
      }),
      []
    );
    // UK only: (ea) is a basis of its own.
    assert.deepEqual(
      lawfulBasisGaps({ bases: ea, recognisedCondition: 'crime', ukLaw: true }),
      []
    );
    // EU only: no such basis.
    assert.deepEqual(
      lawfulBasisGaps({
        bases: ea,
        recognisedCondition: 'crime',
        ukLaw: false
      }),
      ['recognised_not_uk_law']
    );
  });
});

function record(over: Partial<Activity>): Activity {
  return {
    purposes: ['Service'],
    subjectCategories: ['Customers'],
    dataCategories: ['Contact details'],
    recipients: ['Mail provider'],
    transfers: [],
    retention: 'Six years',
    securityMeasures: 'Encrypted',
    controllerRole: 'controller',
    ownerId: '00000000-0000-0000-0000-000000000000',
    regime: 'gdpr',
    laws: 'uk_eu',
    lawfulBases: ['legitimate_interests'],
    recognisedCondition: null,
    outsidePublicTasks: false,
    ...over
  } as Activity;
}

describe('the register under each law', () => {
  it('bars legitimate interests for an EU public body only where EU law applies', () => {
    const gaps = (laws: DataProtectionLaw, ctx = {}) =>
      article30Gaps(record({ laws }), new Set(['US']), {
        entityLaw: 'uk_eu',
        euPublicBody: true,
        ...ctx
      });
    assert.ok(gaps('uk_eu').includes('f_by_eu_public_body'));
    assert.ok(gaps('eu').includes('f_by_eu_public_body'));
    assert.ok(!gaps('uk').includes('f_by_eu_public_body'));
    // A UK public authority's bar is UK law: not on an EU-only record.
    assert.ok(
      !gaps('eu', { publicAuthority: true, euPublicBody: false }).includes(
        'public_authority_legitimate_interests'
      )
    );
    assert.ok(
      gaps('uk', { publicAuthority: true, euPublicBody: false }).includes(
        'public_authority_legitimate_interests'
      )
    );
  });

  it('names the law on gaps only one law asks for, on a dual record', () => {
    assert.match(gapWordsFor('uk_eu').f_by_eu_public_body, /^EU GDPR: /);
    assert.match(gapWordsFor('uk_eu').recognised_condition, /^UK GDPR: /);
    assert.doesNotMatch(gapWordsFor('uk_eu').purposes, /GDPR: /);
    assert.doesNotMatch(gapWordsFor('uk').recognised_condition, /GDPR: /);
  });
});

async function world(label: string, law: DataProtectionLaw = 'uk_eu') {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Records ${label}`,
      slug: `rec-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Group Ltd',
      isDefault: true,
      dataProtectionLaw: law
    })
    .returning();
  return { org, entity };
}

describe('recording under a law', () => {
  it("takes the entity's law, and refuses one outside it", async () => {
    const dual = await world('default');
    const made = await createActivity({
      organisationId: dual.org.id,
      entityId: dual.entity.id,
      name: 'Customers',
      actor: SYSTEM
    });
    assert.equal(made.laws, 'uk_eu');
    assert.equal(made.regime, 'gdpr');

    const uk = await world('uk-only', 'uk');
    await assert.rejects(
      createActivity({
        organisationId: uk.org.id,
        entityId: uk.entity.id,
        name: 'EU customers',
        laws: 'eu',
        actor: SYSTEM
      }),
      /subject to the UK GDPR only/
    );
  });

  it('refuses narrowing a record to EU law while it relies on recognised legitimate interests', async () => {
    const w = await world('narrow-record');
    const made = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Safeguarding',
      lawfulBases: ['recognised_legitimate_interests'],
      recognisedCondition: 'safeguarding',
      actor: SYSTEM
    });
    await assert.rejects(
      updateActivity({
        activityId: made.id,
        organisationId: w.org.id,
        changes: { laws: 'eu' },
        actor: SYSTEM
      }),
      /UK law only/
    );
    const narrowed = await updateActivity({
      activityId: made.id,
      organisationId: w.org.id,
      changes: { laws: 'uk' },
      actor: SYSTEM
    });
    assert.equal(narrowed.laws, 'uk');
  });

  it('refuses Part 3 outside UK law', async () => {
    const w = await world('part3');
    await db
      .update(entities)
      .set({ competentAuthority: true })
      .where(eq(entities.id, w.entity.id));
    await assert.rejects(
      createActivity({
        organisationId: w.org.id,
        entityId: w.entity.id,
        name: 'Investigations',
        regime: 'dpa_part3',
        laws: 'eu',
        actor: SYSTEM
      }),
      /Part 3 .* UK law/
    );
  });

  it('filters the register by law', async () => {
    const w = await world('filter');
    for (const [name, laws] of [
      ['Payroll', 'uk'],
      ['EU customers', 'uk_eu'],
      ['EU leads', 'eu']
    ] as const) {
      await createActivity({
        organisationId: w.org.id,
        entityId: w.entity.id,
        name,
        laws,
        actor: SYSTEM
      });
    }
    const names = async (law?: 'uk' | 'eu') =>
      (await registerHealth(w.org.id, null, law)).rows
        .map((r) => r.activity.name)
        .sort();
    assert.deepEqual(await names('uk'), ['EU customers', 'Payroll']);
    assert.deepEqual(await names('eu'), ['EU customers', 'EU leads']);
    assert.equal((await names()).length, 3);
  });
});

describe("narrowing the entity's law", () => {
  it('narrows dual records with it, and refuses while a record is under the dropped law alone', async () => {
    const w = await world('narrow-entity');
    const both = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Customers',
      actor: SYSTEM
    });
    const euOnly = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'EU leads',
      laws: 'eu',
      actor: SYSTEM
    });
    await assert.rejects(
      setDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        law: 'uk',
        actor: SYSTEM
      }),
      (e: Error) =>
        e instanceof EntityRefused && e.message.includes(euOnly.reference)
    );
    await updateActivity({
      activityId: euOnly.id,
      organisationId: w.org.id,
      changes: { laws: 'uk_eu' },
      actor: SYSTEM
    });
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'uk',
      actor: SYSTEM
    });
    const rows = await db
      .select({ id: processingActivities.id, laws: processingActivities.laws })
      .from(processingActivities)
      .where(eq(processingActivities.entityId, w.entity.id));
    assert.deepEqual(
      rows.map((r) => r.laws),
      ['uk', 'uk']
    );
    assert.ok(rows.some((r) => r.id === both.id));
  });
});
