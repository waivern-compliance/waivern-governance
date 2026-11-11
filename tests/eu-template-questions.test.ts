import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LEGAL_REFERENCES } from '@/lib/templates/library';
import { AI_RISK } from '@/lib/templates/library/ai-risk';
import { DPIA } from '@/lib/templates/library/dpia';
import { evaluate, questionsOf, type Answers } from '@/lib/templates/logic';
import {
  templateDefinition,
  type TemplateDefinition
} from '@/lib/templates/schema';
import { validateTemplate } from '@/lib/templates/validate';

const KNOWN_REFS = new Set<string>(LEGAL_REFERENCES.map((r) => r.code));

function citedRefs(def: TemplateDefinition, keys: string[]): string[] {
  return questionsOf(def.schema)
    .filter(({ question }) => keys.includes(question.key))
    .flatMap(({ question }) => question.legalRefs);
}

function visible(def: TemplateDefinition, answers: Answers, key: string) {
  return evaluate(def.schema, answers).questions[key];
}

describe('DPIA: EU GDPR automated decisions', () => {
  const dpia = templateDefinition.parse(DPIA);
  const keys = [
    'adm_eu_law',
    'adm_eu_exception',
    'adm_eu_law_basis',
    'adm_eu_special_condition'
  ];
  const solely: Answers = { uses_ai: true, solely_automated: true };
  const eu: Answers = { ...solely, adm_eu_law: true };

  it('has the EU questions and still passes publish-time validation', () => {
    const present = new Set(
      questionsOf(dpia.schema).map(({ question }) => question.key)
    );
    for (const k of keys) assert.ok(present.has(k), k);
    assert.deepEqual(validateTemplate(dpia), []);
  });

  it('cites only references that exist', () => {
    const refs = citedRefs(dpia, keys);
    assert.ok(refs.includes('eugdpr.art22.2'));
    for (const r of refs) assert.ok(KNOWN_REFS.has(r), r);
  });

  it('asks whether EU law applies only for solely automated decisions', () => {
    assert.equal(
      visible(dpia, { uses_ai: true, solely_automated: false }, 'adm_eu_law')
        .visible,
      false
    );
    const q = visible(dpia, solely, 'adm_eu_law');
    assert.equal(q.visible, true);
    assert.equal(q.required, true);
  });

  it('asks for the Article 22(2) exception only under EU law', () => {
    assert.equal(
      visible(dpia, { ...solely, adm_eu_law: false }, 'adm_eu_exception')
        .visible,
      false
    );
    assert.equal(
      visible(
        dpia,
        { uses_ai: true, solely_automated: false, adm_eu_law: true },
        'adm_eu_exception'
      ).visible,
      false
    );
    const q = visible(dpia, eu, 'adm_eu_exception');
    assert.equal(q.visible, true);
    assert.equal(q.required, true);
  });

  it('asks for the authorising law only for the law exception', () => {
    for (const exception of ['contract', 'explicit_consent', 'none']) {
      assert.equal(
        visible(
          dpia,
          { ...eu, adm_eu_exception: exception },
          'adm_eu_law_basis'
        ).visible,
        false,
        exception
      );
    }
    const q = visible(
      dpia,
      { ...eu, adm_eu_exception: 'law' },
      'adm_eu_law_basis'
    );
    assert.equal(q.visible, true);
    assert.equal(q.required, true);
    assert.equal(
      visible(
        dpia,
        { ...solely, adm_eu_law: false, adm_eu_exception: 'law' },
        'adm_eu_law_basis'
      ).visible,
      false
    );
  });

  it('asks the Article 22(4) question only for special category data under EU law', () => {
    assert.equal(visible(dpia, eu, 'adm_eu_special_condition').visible, false);
    assert.equal(
      visible(
        dpia,
        { ...solely, adm_eu_law: false, adm_special_category: true },
        'adm_eu_special_condition'
      ).visible,
      false
    );
    const q = visible(
      dpia,
      { ...eu, adm_special_category: true },
      'adm_eu_special_condition'
    );
    assert.equal(q.visible, true);
    assert.equal(q.required, true);
  });

  it('keeps the UK questions for solely automated decisions', () => {
    for (const k of ['adm_special_category', 'adm_safeguards']) {
      assert.equal(visible(dpia, solely, k).visible, true, k);
    }
  });
});

describe('AI risk: EU GDPR automated decisions', () => {
  const ai = templateDefinition.parse(AI_RISK);
  const keys = ['adm_eu_law', 'adm_eu_exception', 'adm_eu_law_basis'];
  const deciding: Answers = { affects_people: true, consequence: 'decides' };
  const eu: Answers = { ...deciding, adm_eu_law: true };

  it('has the EU questions and still passes publish-time validation', () => {
    const present = new Set(
      questionsOf(ai.schema).map(({ question }) => question.key)
    );
    for (const k of keys) assert.ok(present.has(k), k);
    assert.deepEqual(validateTemplate(ai), []);
  });

  it('cites only references that exist', () => {
    for (const r of citedRefs(ai, keys)) assert.ok(KNOWN_REFS.has(r), r);
  });

  it('asks only where the system decides with no meaningful human review', () => {
    assert.equal(
      visible(
        ai,
        { affects_people: true, consequence: 'recommends' },
        'adm_eu_law'
      ).visible,
      false
    );
    assert.equal(visible(ai, deciding, 'adm_eu_law').required, true);
    assert.equal(
      visible(ai, { ...deciding, adm_eu_law: false }, 'adm_eu_exception')
        .visible,
      false
    );
    assert.equal(visible(ai, eu, 'adm_eu_exception').required, true);
  });

  it('asks for the authorising law only for the law exception', () => {
    assert.equal(
      visible(ai, { ...eu, adm_eu_exception: 'contract' }, 'adm_eu_law_basis')
        .visible,
      false
    );
    assert.equal(
      visible(ai, { ...eu, adm_eu_exception: 'law' }, 'adm_eu_law_basis')
        .visible,
      true
    );
  });
});
