import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { entities, organisations, processingActivities } from '@/db/schema';
import {
  defaultRequestJurisdiction,
  jurisdictionAllowed,
  ukLawApplies
} from '@/lib/dpa2018/applies';
import {
  ART10_MEMBER_STATE_LAW,
  conditionGaps,
  type SpecialCategoryRecord
} from '@/lib/dpa2018/schedule-1';
import { basesFor, lawfulBasisGaps } from '@/lib/gdpr/lawful-basis';
import type { AuthedConnection } from '@/lib/integration/auth';
import { navFor } from '@/lib/nav';
import type { Grant } from '@/lib/rbac';
import { recordComplaint } from '@/services/complaints';
import { createConnection } from '@/services/connections';
import {
  recordRequest,
  recordRequestDecision,
  RequestRefused
} from '@/services/data-subject-requests';
import {
  anyEntityUnderUkLaw,
  setDataProtectionLaw,
  setPublicAuthority
} from '@/services/entities';
import { guidanceFor } from '@/services/guidance';
import { ingestProcessingActivities } from '@/services/ingest';
import {
  createActivity,
  HARD_GAPS,
  loadActivity,
  updateActivity
} from '@/services/ropa';
import { shippedTemplatesMissing } from '@/services/templates';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'data protection law test'
};
const DAY = 86_400_000;

after(() => pg.end());

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `DP law ${label}`,
      slug: `dpl-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [uk] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Holdings Ltd', isDefault: true })
    .returning();
  const [eu] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Europe GmbH' })
    .returning();
  await setDataProtectionLaw({
    organisationId: org.id,
    entityId: eu.id,
    law: 'eu',
    actor: SYSTEM
  });
  return { org, uk, eu };
}

const BLANK: SpecialCategoryRecord & { entityId: string } = {
  entityId: 'e',
  specialCategory: null,
  art9Condition: null,
  schedule1Condition: null,
  criminalOffence: null,
  art10Condition: null,
  retentionFollowsPolicy: null,
  retentionPolicyNote: null
};

describe('the rules', () => {
  it("read UK law as applying unless the entity is EU only, and default a request's jurisdiction from it", () => {
    assert.equal(ukLawApplies('uk'), true);
    assert.equal(ukLawApplies('uk_eu'), true);
    assert.equal(ukLawApplies('eu'), false);
    assert.equal(defaultRequestJurisdiction('eu', 'uk'), 'eu');
    assert.equal(defaultRequestJurisdiction('uk', 'eu'), 'uk');
    assert.equal(defaultRequestJurisdiction('uk_eu', 'eu'), 'eu');
    assert.equal(jurisdictionAllowed('eu', 'uk'), false);
    assert.equal(jurisdictionAllowed('uk_eu', 'uk'), true);
  });

  it('ask Schedule 1 and the policy document only under UK law, and take Member State law for Article 10 only under EU law', () => {
    const spi = {
      ...BLANK,
      specialCategory: true,
      art9Condition: 'g' as const
    };
    assert.deepEqual(conditionGaps(spi, []), ['special_no_schedule1']);
    assert.deepEqual(conditionGaps(spi, [], false), []);
    const needing = {
      ...BLANK,
      specialCategory: true,
      art9Condition: 'g' as const,
      schedule1Condition: 'para6' as const
    };
    assert.ok(conditionGaps(needing, []).includes('no_policy_document'));
    assert.deepEqual(conditionGaps(needing, [], false), []);
    const criminal = {
      ...BLANK,
      criminalOffence: true,
      art10Condition: ART10_MEMBER_STATE_LAW
    };
    assert.deepEqual(conditionGaps(criminal, [], false), []);
    assert.deepEqual(conditionGaps(criminal, []), ['criminal_no_condition']);
  });

  it('leave the UK-only registers out of the navigation where no entity is under UK law', () => {
    const grants = [{ role: 'owner', entityId: null }] as unknown as Grant[];
    const hrefs = (ukLaw: boolean) =>
      navFor(grants, { ukLaw }).map((i) => i.href);
    assert.ok(hrefs(true).includes('/app/policy-documents'));
    assert.ok(!hrefs(false).includes('/app/policy-documents'));
    assert.ok(!hrefs(false).includes('/app/sharing-agreements'));
    assert.ok(hrefs(false).includes('/app/ropa'));
  });
});

describe('the entity setting', () => {
  it('refuses EU only while a UK law setting is on, and UK law settings on an EU-only entity', async () => {
    const w = await world('flags');
    await setPublicAuthority({
      organisationId: w.org.id,
      entityId: w.uk.id,
      publicAuthority: true,
      actor: SYSTEM
    });
    await assert.rejects(
      setDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.uk.id,
        law: 'eu',
        actor: SYSTEM
      }),
      /public authority/
    );
    await assert.rejects(
      setPublicAuthority({
        organisationId: w.org.id,
        entityId: w.eu.id,
        publicAuthority: true,
        actor: SYSTEM
      }),
      /EU law only/
    );
    assert.equal(await anyEntityUnderUkLaw(w.org.id), true);
  });

  it("drops the Act's gaps from an EU-only entity's processing records, keeping them on a UK one", async () => {
    const w = await world('ropa');
    const changes = { specialCategory: true, art9Condition: 'g' };
    const euActivity = await createActivity({
      organisationId: w.org.id,
      entityId: w.eu.id,
      name: 'Diversity monitoring',
      actor: SYSTEM
    });
    const ukActivity = await createActivity({
      organisationId: w.org.id,
      entityId: w.uk.id,
      name: 'Diversity monitoring',
      actor: SYSTEM
    });
    await updateActivity({
      activityId: euActivity.id,
      organisationId: w.org.id,
      changes,
      actor: SYSTEM
    });
    await updateActivity({
      activityId: ukActivity.id,
      organisationId: w.org.id,
      changes,
      actor: SYSTEM
    });
    assert.ok(
      !(await loadActivity(euActivity.id, w.org.id))!.gaps.includes(
        'special_no_schedule1'
      )
    );
    assert.ok(
      (await loadActivity(ukActivity.id, w.org.id))!.gaps.includes(
        'special_no_schedule1'
      )
    );
  });

  it("handles requests to an EU-only entity under EU law, without the Act's exemptions", async () => {
    const w = await world('requests');
    const base = {
      organisationId: w.org.id,
      entityId: w.eu.id,
      rights: ['access'],
      channel: 'email' as const,
      receivedAt: new Date(Date.now() - DAY),
      description: 'A copy',
      requesterName: 'A person',
      actor: SYSTEM
    };
    const request = await recordRequest(base);
    assert.equal(request.jurisdiction, 'eu');
    await assert.rejects(
      recordRequest({ ...base, jurisdiction: 'uk' }),
      /EU law only/
    );
    await assert.rejects(
      recordRequestDecision({
        organisationId: w.org.id,
        requestId: request.id,
        kind: 'exemption',
        exemption: 'sch2_p2',
        rationale: 'x',
        actor: SYSTEM
      }),
      (e: Error) =>
        e instanceof RequestRefused && /Member State law/.test(e.message)
    );
    assert.equal(
      (await recordRequest({ ...base, entityId: w.uk.id })).jurisdiction,
      'uk'
    );
  });

  it('offers the UK templates and the s.164A step only where some entity is under UK law', async () => {
    const [org] = await db
      .insert(organisations)
      .values({
        name: 'EU only',
        slug: `dpl-eu-${crypto.randomUUID().slice(0, 8)}`
      })
      .returning();
    const [only] = await db
      .insert(entities)
      .values({ organisationId: org.id, name: 'Only GmbH', isDefault: true })
      .returning();
    const names = async () =>
      (await shippedTemplatesMissing(org.id)).map((t) => t.name);
    assert.ok((await names()).includes('Data protection impact assessment'));
    assert.ok(
      (
        await guidanceFor({ organisationId: org.id, chosen: 'setup' })
      ).steps.some((s) => s.id === 'entities')
    );

    await setDataProtectionLaw({
      organisationId: org.id,
      entityId: only.id,
      law: 'eu',
      actor: SYSTEM
    });
    assert.equal(await anyEntityUnderUkLaw(org.id), false);
    const after = await names();
    assert.ok(!after.includes('Data protection impact assessment'));
    assert.ok(!after.includes('Legitimate interests assessment'));
    assert.ok(
      after.includes('Data protection impact assessment (CNIL method)')
    );
    assert.ok(
      !(
        await guidanceFor({ organisationId: org.id, chosen: 'maintain' })
      ).steps.some((s) => s.id === 'complaints')
    );
  });
});

describe('recognised legitimate interests', () => {
  it('is offered only where UK law applies, and reported on an EU-only record that relies on it', () => {
    assert.ok(basesFor(true).includes('recognised_legitimate_interests'));
    assert.ok(!basesFor(false).includes('recognised_legitimate_interests'));
    assert.ok(basesFor(false).includes('legitimate_interests'));
    const bases = ['recognised_legitimate_interests'] as const;
    assert.deepEqual(
      lawfulBasisGaps({ bases, recognisedCondition: 'crime', ukLaw: false }),
      ['recognised_not_uk_law']
    );
    assert.deepEqual(
      lawfulBasisGaps({ bases, recognisedCondition: null, ukLaw: true }),
      ['no_recognised_condition']
    );
    assert.deepEqual(
      lawfulBasisGaps({ bases, recognisedCondition: 'crime' }),
      []
    );
  });

  it('is refused on an EU-only entity, and an existing reliance shows as a serious gap', async () => {
    const w = await world('ea');
    await assert.rejects(
      createActivity({
        organisationId: w.org.id,
        entityId: w.eu.id,
        name: 'Fraud screening',
        lawfulBases: ['recognised_legitimate_interests'],
        recognisedCondition: 'crime',
        actor: SYSTEM
      }),
      /UK law only/
    );
    const uk = await createActivity({
      organisationId: w.org.id,
      entityId: w.uk.id,
      name: 'Fraud screening',
      lawfulBases: ['recognised_legitimate_interests'],
      recognisedCondition: 'crime',
      actor: SYSTEM
    });
    assert.ok(
      !(await loadActivity(uk.id, w.org.id))!.gaps.includes(
        'recognised_not_uk_law'
      )
    );

    // A record made before the entity was narrowed to EU law only.
    const eu = await createActivity({
      organisationId: w.org.id,
      entityId: w.eu.id,
      name: 'Fraud screening',
      actor: SYSTEM
    });
    await db
      .update(processingActivities)
      .set({
        lawfulBases: ['recognised_legitimate_interests'],
        recognisedCondition: 'crime'
      })
      .where(eq(processingActivities.id, eu.id));
    const loaded = (await loadActivity(eu.id, w.org.id))!;
    assert.ok(loaded.gaps.includes('recognised_not_uk_law'));
    assert.ok(!loaded.gaps.includes('recognised_condition'));
    assert.ok(HARD_GAPS.includes('recognised_not_uk_law'));
    await assert.rejects(
      updateActivity({
        activityId: eu.id,
        organisationId: w.org.id,
        changes: {
          lawfulBases: ['recognised_legitimate_interests', 'contract']
        },
        actor: SYSTEM
      }),
      /UK law only/
    );
    await updateActivity({
      activityId: eu.id,
      organisationId: w.org.id,
      changes: { lawfulBases: ['legitimate_interests'] },
      actor: SYSTEM
    });
    assert.ok(
      !(await loadActivity(eu.id, w.org.id))!.gaps.includes(
        'recognised_not_uk_law'
      )
    );
  });

  it('is skipped with the reason when the Portal sends it for an EU-only entity', async () => {
    const w = await world('ea-ingest');
    const created = await createConnection({
      organisationId: w.org.id,
      kind: 'waivern_portal',
      name: 'Portal',
      defaultEntityId: w.uk.id,
      actor: SYSTEM
    });
    const portal: AuthedConnection = {
      id: created.id,
      organisationId: w.org.id,
      kind: 'waivern_portal',
      name: 'Portal',
      defaultEntityId: w.uk.id
    };
    const record = {
      name: 'Fraud screening',
      purposes: ['Detect fraud'],
      dataCategories: [],
      subjectCategories: [],
      recipients: [],
      systems: [],
      transfers: [],
      lawfulBases: ['recognised_legitimate_interests' as const],
      recognisedCondition: 'crime' as const
    };
    const out = await ingestProcessingActivities(portal, [
      { ...record, externalRef: 'eu-1', entity: 'Europe GmbH' },
      { ...record, externalRef: 'uk-1' }
    ]);
    assert.equal(out.created, 1);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].externalRef, 'eu-1');
    assert.match(out.skipped[0].reason, /UK law only/);
  });
});

describe('complaints', () => {
  it('take their law from the entity, and are refused under a law it is not subject to', async () => {
    const w = await world('complaints');
    const base = {
      organisationId: w.org.id,
      entityId: w.eu.id,
      channel: 'email',
      receivedAt: new Date(Date.now() - DAY),
      subject: 'request_handling',
      description: 'My access request was answered late.',
      complainantName: 'A person',
      actor: SYSTEM
    };
    assert.equal((await recordComplaint(base)).jurisdiction, 'eu');
    await assert.rejects(
      recordComplaint({ ...base, jurisdiction: 'uk' }),
      /EU law only/
    );
    assert.equal(
      (await recordComplaint({ ...base, entityId: w.uk.id })).jurisdiction,
      'uk'
    );
  });
});
