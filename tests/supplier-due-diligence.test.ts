import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ResolvedRef } from '@/lib/legal-refs';
import { citedFor } from '@/lib/templates/cited';
import { offeredTo, SYSTEM_TEMPLATES } from '@/lib/templates/library';
import {
  DUE_DILIGENCE_NAMES,
  dueDiligenceDepth,
  SUPPLIER_DUE_DILIGENCE_FULL as FULL,
  SUPPLIER_DUE_DILIGENCE_LIGHT as LIGHT
} from '@/lib/templates/library/supplier-due-diligence';
import { evaluate, questionsOf, type Answers } from '@/lib/templates/logic';
import type { TemplateDefinition } from '@/lib/templates/schema';
import { score } from '@/lib/templates/scoring';
import { isAiSupplierDefinition } from '@/lib/thirdparty/ai-procurement';

const scored = (d: TemplateDefinition, answers: Answers) =>
  score(d.scoring, d.schema, answers, evaluate(d.schema, answers));

const visible = (d: TemplateDefinition, answers: Answers, key: string) =>
  evaluate(d.schema, answers).questions[key];

/** A supplier with nothing to worry about, answering the light questions. */
const SOUND: Answers = {
  supplier_name: 'Northwind Hosting',
  service: 'Hosting for the case management system',
  security_contact: 'Security team, security@northwind.example',
  ai_involvement: 'none',
  personal_data: true,
  data_categories: ['contact_details'],
  processing_locations: 'uk',
  sub_processors: 'none',
  certifications: ['iso27001'],
  evidence_iso27001: 'BSI, IS 123456, valid to 2027-05-01, covers hosting',
  certification_scope: 'all',
  breach_notification: 'within_24h',
  recent_breaches: 'no'
};

/** The full depth's further answers, all sound. */
const SOUND_FULL: Answers = {
  ...SOUND,
  access_control: 'yes',
  encryption_in_transit: 'yes',
  encryption_at_rest: 'yes',
  patching: 'yes',
  penetration_testing: 'annual',
  evidence_penetration_test: 'Pen Testers Ltd, March, whole service, fixed',
  business_continuity: 'yes',
  staff_vetting: 'yes',
  logging: 'yes',
  international_transfers: 'none',
  end_of_contract: 'deleted_certified'
};

describe('supplier due diligence', () => {
  it('ships both depths as supplier assessments offered to every organisation', () => {
    for (const name of Object.values(DUE_DILIGENCE_NAMES)) {
      const t = SYSTEM_TEMPLATES.find((s) => s.name === name);
      assert.ok(t, name);
      assert.equal(t.kind, 'supplier_record');
      for (const ukLaw of [true, false])
        assert.ok(
          offeredTo(t, {
            aiFramework: 'uk_dsit',
            competentAuthority: false,
            ukLaw,
            irishProvider: false
          })
        );
    }
  });

  it('asks every light question at full depth, in the same words', () => {
    const full = new Map(
      questionsOf(FULL.schema).map(({ question }) => [question.key, question])
    );
    for (const { question } of questionsOf(LIGHT.schema))
      assert.deepEqual(full.get(question.key), question, question.key);
    assert.ok(full.has('access_control'));
    assert.ok(full.has('article_28_terms'));
  });

  it("is never mistaken for an assessment of a supplier's AI", () => {
    assert.equal(isAiSupplierDefinition(LIGHT), false);
    assert.equal(isAiSupplierDefinition(FULL), false);
  });

  it('chooses full for critical and high tiers, light below', () => {
    assert.equal(dueDiligenceDepth('critical'), 'full');
    assert.equal(dueDiligenceDepth('high'), 'full');
    assert.equal(dueDiligenceDepth('medium'), 'light');
    assert.equal(dueDiligenceDepth('low'), 'light');
  });

  it('asks for the evidence of each certification held, and only those', () => {
    const iso = visible(LIGHT, SOUND, 'evidence_iso27001');
    assert.equal(iso.visible && iso.required, true);
    assert.equal(visible(LIGHT, SOUND, 'evidence_soc2').visible, false);
    const plus = {
      ...SOUND,
      certifications: ['cyber_essentials_plus']
    };
    assert.equal(
      visible(LIGHT, plus, 'evidence_cyber_essentials').required,
      true
    );
    assert.equal(visible(LIGHT, plus, 'evidence_iso27001').visible, false);
    const none = { ...SOUND, certifications: ['none'] };
    assert.equal(visible(LIGHT, none, 'certification_scope').visible, false);
  });

  it('asks for the penetration test summary only where there was a test', () => {
    assert.equal(
      visible(FULL, SOUND_FULL, 'evidence_penetration_test').required,
      true
    );
    assert.equal(
      visible(
        FULL,
        { ...SOUND_FULL, penetration_testing: 'never' },
        'evidence_penetration_test'
      ).visible,
      false
    );
  });

  it('asks about processor terms and transfers only where personal data is processed', () => {
    const noPersonal = { ...SOUND_FULL, personal_data: false };
    for (const key of [
      'data_categories',
      'international_transfers',
      'article_28_terms'
    ])
      assert.equal(visible(FULL, noPersonal, key).visible, false, key);
  });

  it('rates a sound supplier low at either depth', () => {
    for (const [d, answers] of [
      [LIGHT, SOUND],
      [FULL, SOUND_FULL]
    ] as const) {
      const r = scored(d, answers);
      assert.equal(r.scored && r.score, 0);
      assert.equal(r.scored && r.band.tier, 'low');
    }
  });

  it('rates a supplier that will not say where data goes or who has it, and holds nothing, high', () => {
    const r = scored(LIGHT, {
      ...SOUND,
      processing_locations: 'unknown',
      sub_processors: 'not_disclosed',
      certifications: ['none']
    });
    // unknown 4 + not disclosed 4 + none 3
    assert.equal(r.scored && r.score, 11);
    assert.equal(r.scored && r.band.tier, 'high');
  });

  it('puts an unprotected transfer with weak controls beyond acceptable', () => {
    const r = scored(FULL, {
      ...SOUND_FULL,
      international_transfers: 'unprotected',
      access_control: 'no',
      encryption_at_rest: 'no',
      logging: 'no',
      penetration_testing: 'never',
      business_continuity: 'no',
      end_of_contract: 'deleted'
    });
    // 5 + 4 + 4 + 4 + 4 + 4 + 1
    assert.equal(r.scored && r.score, 26);
    assert.equal(r.scored && r.band.tier, 'high');
    const worse = scored(FULL, {
      ...SOUND_FULL,
      international_transfers: 'unprotected',
      access_control: 'no',
      encryption_at_rest: 'no',
      logging: 'no',
      penetration_testing: 'never',
      business_continuity: 'no',
      end_of_contract: 'kept'
    });
    assert.equal(worse.scored && worse.band.tier, 'critical');
  });

  it('sends a supplier using AI to Responsible AI review, without becoming an AI supplier assessment', () => {
    for (const d of [LIGHT, FULL])
      assert.ok(
        questionsOf(d.schema).some(
          ({ question }) => question.key === 'ai_involvement'
        )
      );
    assert.equal(isAiSupplierDefinition(FULL), false);
  });

  it('keeps the conclusion to the organisation', () => {
    for (const d of [LIGHT, FULL]) {
      const conclusion = d.schema.sections.find((s) => s.key === 'conclusion');
      assert.equal(conclusion?.organisationOnly, true);
      assert.equal(
        d.schema.sections.filter((s) => s.organisationOnly).length,
        1
      );
    }
  });
});

describe("articles shown for the entity's law", () => {
  const ref = (regime: string, citation: string): ResolvedRef => ({
    regime,
    citation,
    title: citation,
    url: null,
    jurisdiction: null
  });
  const refs = {
    'ukgdpr.art28': ref('UK GDPR', 'Article 28'),
    'eugdpr.art28': ref('EU GDPR', 'Article 28'),
    'eugdpr.art35': ref('EU GDPR', 'Article 35'),
    iso27001: ref('ISO/IEC 27001', 'ISO/IEC 27001:2022')
  };
  const regimes = (codes: string[], law?: 'uk' | 'eu' | 'uk_eu') =>
    citedFor(codes, refs, law).map((r) => r.regime);

  it('shows the EU GDPR only where the entity is subject to it', () => {
    const both = ['ukgdpr.art28', 'eugdpr.art28', 'iso27001'];
    assert.deepEqual(regimes(both, 'uk'), ['UK GDPR', 'ISO/IEC 27001']);
    assert.deepEqual(regimes(both, 'eu'), ['EU GDPR', 'ISO/IEC 27001']);
    assert.deepEqual(regimes(both, 'uk_eu'), [
      'UK GDPR',
      'EU GDPR',
      'ISO/IEC 27001'
    ]);
    assert.deepEqual(regimes(both), ['UK GDPR', 'EU GDPR', 'ISO/IEC 27001']);
  });

  it('keeps the only article a question cites, rather than leaving it with none', () => {
    assert.deepEqual(regimes(['eugdpr.art35'], 'uk'), ['EU GDPR']);
  });
});
