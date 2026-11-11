import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { db, sql as pg } from '@/db/client';
import { entities, organisations } from '@/db/schema';
import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import { rightArticle } from '@/lib/dsr/statutory';
import {
  admGaps,
  admRestriction,
  AutomatedDecisionRefused,
  cleanAdm,
  type AdmRecord
} from '@/lib/gdpr/automated-decisions';
import { childrenConsentGaps } from '@/lib/gdpr/children';
import {
  cleanFurtherProcessing,
  furtherProcessingGaps
} from '@/lib/gdpr/further-processing';
import { createUseCase, listRegister } from '@/services/ai-register';
import {
  linkUseCaseToActivity,
  setAutomatedDecisions
} from '@/services/automated-decisions';
import {
  createActivity,
  gapWordsFor,
  loadActivity,
  setFurtherProcessing,
  updateActivity
} from '@/services/ropa';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'EU decisions and children test'
};

after(() => pg.end());

const allSafeguards = {
  information: { confirmed: true },
  representations: { confirmed: true },
  human_intervention: { confirmed: true },
  contest: { confirmed: true }
};

const solely = (over: Partial<AdmRecord> = {}): AdmRecord => ({
  automatedDecisions: true,
  admSpecialCategory: false,
  admSpecialCondition: null,
  admSafeguards: allSafeguards,
  admEuException: null,
  admEuLawNote: null,
  ...over
});

describe('solely automated decisions under each law', () => {
  it('are prohibited under EU law without an Article 22(2) exception, and allowed under UK law with the safeguards', () => {
    assert.deepEqual(admGaps(solely(), [], 'gdpr', 'uk'), []);
    assert.deepEqual(admGaps(solely(), [], 'gdpr', 'eu'), [
      'adm_eu_no_exception'
    ]);
    assert.equal(admRestriction(solely(), [], 'gdpr', 'uk').allowed, true);
    assert.equal(admRestriction(solely(), [], 'gdpr', 'eu').allowed, false);
    assert.equal(
      admRestriction(solely({ admEuException: 'contract' }), [], 'gdpr', 'eu')
        .allowed,
      true
    );
  });

  it('asks for the law, and for the Article 22(3) safeguards on contract or consent', () => {
    assert.deepEqual(
      admGaps(solely({ admEuException: 'law' }), [], 'gdpr', 'eu'),
      ['adm_eu_law_unnamed']
    );
    assert.deepEqual(
      admGaps(
        solely({ admEuException: 'contract', admSafeguards: {} }),
        [],
        'gdpr',
        'eu'
      ),
      ['adm_eu_safeguards']
    );
    // Under both, the UK gap covers the safeguards once.
    assert.deepEqual(
      admGaps(
        solely({ admEuException: 'contract', admSafeguards: {} }),
        [],
        'gdpr',
        'uk_eu'
      ),
      ['adm_safeguards']
    );
  });

  it('keeps special category data under 22(4) and recognised legitimate interests under UK law only', () => {
    const special = solely({
      admEuException: 'explicit_consent',
      admSpecialCategory: true
    });
    assert.ok(
      admGaps(special, [], 'gdpr', 'eu').includes('adm_special_no_condition')
    );
    const ea = ['recognised_legitimate_interests'] as const;
    assert.ok(
      admGaps(solely(), ea, 'gdpr', 'uk_eu').includes('adm_relies_on_ea')
    );
    assert.ok(
      !admGaps(
        solely({ admEuException: 'contract' }),
        ea,
        'gdpr',
        'eu'
      ).includes('adm_relies_on_ea')
    );
  });

  it('keeps the law note only for the law exception, and refuses EU exceptions under Part 3', () => {
    const r = cleanAdm({
      automatedDecisions: true,
      admEuException: 'contract',
      admEuLawNote: 'Some Act'
    });
    assert.equal(r.admEuLawNote, null);
    assert.equal(
      cleanAdm({
        automatedDecisions: true,
        admEuException: 'law',
        admEuLawNote: ' Loi 78-17 '
      }).admEuLawNote,
      'Loi 78-17'
    );
    assert.throws(
      () => cleanAdm({ automatedDecisions: true, admEuException: 'vibes' }),
      AutomatedDecisionRefused
    );
    assert.throws(
      () =>
        cleanAdm(
          { automatedDecisions: true, admEuException: 'contract' },
          'dpa_part3'
        ),
      AutomatedDecisionRefused
    );
  });

  it('cite Article 22(3) on an EU request', () => {
    assert.equal(rightArticle('automated_decision', 'uk'), 'Article 22C');
    assert.equal(
      rightArticle('automated_decision', 'eu'),
      'EU GDPR Article 22(3)'
    );
    assert.equal(rightArticle('access', 'eu'), 'Article 15');
  });
});

describe('further processing and research under each law', () => {
  const record = (over = {}) =>
    cleanFurtherProcessing({
      furtherProcessing: true,
      compatibilityRoute: 'compliance',
      research: true,
      researchSafeguards: {},
      ...over
    });

  it('asks the EU route under EU law, and the UK route only under UK law', () => {
    const gaps = (laws: DataProtectionLaw) =>
      furtherProcessingGaps(record(), false, laws);
    assert.ok(gaps('eu').includes('eu_further_no_route'));
    assert.ok(!gaps('eu').includes('research_safeguards'));
    assert.ok(gaps('uk').includes('research_safeguards'));
    assert.ok(!gaps('uk').includes('eu_further_no_route'));
    assert.ok(gaps('uk_eu').includes('eu_further_no_route'));
    assert.ok(gaps('uk_eu').includes('research_safeguards'));
  });

  it('needs the law named for the law route, and data minimisation under Article 89(1)', () => {
    assert.ok(
      furtherProcessingGaps(
        record({ euCompatibilityRoute: 'law' }),
        false,
        'eu'
      ).includes('eu_further_route_incomplete')
    );
    const done = record({
      euCompatibilityRoute: 'research',
      researchSafeguards: { data_minimisation: { confirmed: true } }
    });
    assert.deepEqual(furtherProcessingGaps(done, false, 'eu'), []);
  });

  it('clears the EU route when it is not further processing', () => {
    const r = cleanFurtherProcessing({
      furtherProcessing: false,
      euCompatibilityRoute: 'consent'
    });
    assert.equal(r.euCompatibilityRoute, null);
  });
});

describe('services offered to children on consent', () => {
  it('report a State whose age is not established, only under EU law and on consent', () => {
    const base = {
      lawfulBases: ['consent'] as const,
      childrenMemberStates: ['MT']
    };
    // Malta's 13 asks nothing more; Ireland's 16 needs a parent below it;
    // Austria's age is not established, so it is reported, never assumed.
    assert.deepEqual(childrenConsentGaps({ ...base, laws: 'eu' }), []);
    assert.deepEqual(
      childrenConsentGaps({
        ...base,
        laws: 'eu',
        childrenMemberStates: ['IE', 'AT']
      }),
      ['children_age_unknown', 'children_parental_consent']
    );
    assert.deepEqual(childrenConsentGaps({ ...base, laws: 'uk' }), []);
    assert.deepEqual(
      childrenConsentGaps({
        ...base,
        laws: 'eu',
        lawfulBases: ['contract']
      }),
      []
    );
  });

  it('labels the EU gaps on a record under both laws', () => {
    assert.match(gapWordsFor('uk_eu').adm_eu_no_exception, /^EU GDPR: /);
    assert.match(gapWordsFor('uk_eu').children_age_unknown, /^EU GDPR: /);
  });
});

async function world(label: string, law: DataProtectionLaw) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `EU decisions ${label}`,
      slug: `eud-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Europe SAS',
      isDefault: true,
      dataProtectionLaw: law
    })
    .returning();
  return { org, entity };
}

describe('on a processing record', () => {
  it('reports a missing Article 22(2) exception until one is recorded', async () => {
    const w = await world('adm', 'eu');
    const activity = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Credit scoring',
      lawfulBases: ['contract'],
      actor: SYSTEM
    });
    await setAutomatedDecisions({
      organisationId: w.org.id,
      side: 'processing_activity',
      id: activity.id,
      record: {
        automatedDecisions: true,
        admSpecialCategory: false,
        admSafeguards: allSafeguards
      },
      actor: SYSTEM
    });
    let loaded = (await loadActivity(activity.id, w.org.id))!;
    assert.ok(loaded.gaps.includes('adm_eu_no_exception'));
    assert.ok(loaded.hardGaps.includes('adm_eu_no_exception'));
    await setAutomatedDecisions({
      organisationId: w.org.id,
      side: 'processing_activity',
      id: activity.id,
      record: {
        automatedDecisions: true,
        admSpecialCategory: false,
        admSafeguards: allSafeguards,
        admEuException: 'contract'
      },
      actor: SYSTEM
    });
    loaded = (await loadActivity(activity.id, w.org.id))!;
    assert.ok(!loaded.gaps.some((g) => g.startsWith('adm_')));
  });

  it('keeps the member States children are offered the service in, and refuses others', async () => {
    const w = await world('children', 'eu');
    const activity = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Learning app',
      lawfulBases: ['consent'],
      actor: SYSTEM
    });
    const saved = await updateActivity({
      activityId: activity.id,
      organisationId: w.org.id,
      changes: { childrenMemberStates: ['fr', 'IE', 'FR'] },
      actor: SYSTEM
    });
    assert.deepEqual(saved.childrenMemberStates, ['FR', 'IE']);
    await assert.rejects(
      updateActivity({
        activityId: activity.id,
        organisationId: w.org.id,
        changes: { childrenMemberStates: ['GB'] },
        actor: SYSTEM
      }),
      /Not an EEA member State/
    );
  });
});

describe('the review fixes', () => {
  it('leaves the EU exception alone where the caller did not ask it', () => {
    const r = cleanAdm({ automatedDecisions: true, admSpecialCategory: false });
    assert.equal('admEuException' in r, false);
    assert.equal('admEuLawNote' in r, false);
    assert.equal(
      cleanAdm({ automatedDecisions: true, admEuException: null })
        .admEuException,
      null
    );
  });

  it('keeps a recorded EU exception through a save that does not ask it', async () => {
    const w = await world('keep-adm', 'uk_eu');
    const activity = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Pricing',
      lawfulBases: ['contract'],
      actor: SYSTEM
    });
    const save = (eu: Partial<AdmRecord>) =>
      setAutomatedDecisions({
        organisationId: w.org.id,
        side: 'processing_activity',
        id: activity.id,
        record: {
          automatedDecisions: true,
          admSpecialCategory: false,
          admSafeguards: allSafeguards,
          ...eu
        },
        actor: SYSTEM
      });
    await save({ admEuException: 'contract' });
    await save({});
    const loaded = (await loadActivity(activity.id, w.org.id))!;
    assert.equal(loaded.activity.admEuException, 'contract');
  });

  it("keeps the other law's further-processing route through a save that does not ask it", async () => {
    const w = await world('keep-route', 'uk_eu');
    const activity = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Analytics',
      actor: SYSTEM
    });
    await setFurtherProcessing({
      activityId: activity.id,
      organisationId: w.org.id,
      record: {
        furtherProcessing: true,
        compatibilityRoute: 'compliance',
        euCompatibilityRoute: 'consent'
      },
      actor: SYSTEM
    });
    await setFurtherProcessing({
      activityId: activity.id,
      organisationId: w.org.id,
      record: { furtherProcessing: true, compatibilityRoute: 'consent' },
      actor: SYSTEM
    });
    const loaded = (await loadActivity(activity.id, w.org.id))!;
    assert.equal(loaded.activity.compatibilityRoute, 'consent');
    assert.equal(loaded.activity.euCompatibilityRoute, 'consent');
  });
});

describe('an AI use case', () => {
  it('is judged in the register under the laws of the processing it is used in', async () => {
    const w = await world('ai-laws', 'uk_eu');
    const activity = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'UK payroll',
      lawfulBases: ['contract'],
      laws: 'uk',
      actor: SYSTEM
    });
    const useCase = await createUseCase({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Payroll checks',
      purpose: 'Flag anomalies.',
      systemType: 'predictive',
      provenance: 'built_in_house',
      actor: SYSTEM
    });
    await setAutomatedDecisions({
      organisationId: w.org.id,
      side: 'ai_use_case',
      id: useCase.id,
      record: {
        automatedDecisions: true,
        admSpecialCategory: false,
        admSafeguards: allSafeguards
      },
      actor: SYSTEM
    });
    const gapsOf = async () =>
      (await listRegister(w.org.id, null)).find(
        (r) => r.useCase.id === useCase.id
      )!.gaps;
    // Not linked: its entity's laws, both, so the EU question is owed.
    assert.ok((await gapsOf()).includes('adm_eu_no_exception'));
    await linkUseCaseToActivity({
      organisationId: w.org.id,
      useCaseId: useCase.id,
      activityId: activity.id,
      actor: SYSTEM
    });
    // Used only in UK processing: UK law alone, as the page shows it.
    assert.ok(!(await gapsOf()).includes('adm_eu_no_exception'));
  });
});
