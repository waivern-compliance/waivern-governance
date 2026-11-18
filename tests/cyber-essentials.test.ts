import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeControlRef,
  formatControlRef,
  parseControlRef
} from '@/lib/cyber-essentials/control-ref';
import { carryForward, changedBetween } from '@/lib/cyber-essentials/crosswalk';
import {
  CE_EDITIONS,
  editionInForce,
  isAutoFail,
  requirementsOf,
  scopeRulesOf
} from '@/lib/cyber-essentials/editions';
import { ceReferenceCode } from '@/lib/cyber-essentials/references';
import {
  CE_REQUIREMENTS,
  CE_THEMES,
  ceRequirement
} from '@/lib/cyber-essentials/requirements';
import {
  CE_SCOPE_RULES,
  OUT_OF_SCOPE_REASONS
} from '@/lib/cyber-essentials/scope';
import { LEGAL_REFERENCES } from '@/lib/templates/library';

// Printed page counts of the two NCSC documents, cover excluded.
const LAST_PAGE = { 'v3.2': 26, 'v3.3': 25 } as const;

describe('the Cyber Essentials requirements', () => {
  it('sets out the five controls in the order NCSC does', () => {
    assert.deepEqual(
      CE_THEMES.map((t) => t.id),
      [
        'firewalls',
        'secure_configuration',
        'update_management',
        'user_access_control',
        'malware_protection'
      ]
    );
  });

  it('files every requirement under a control, once, with a code that names it', () => {
    const codes = CE_REQUIREMENTS.map((r) => r.code);
    assert.equal(new Set(codes).size, codes.length);
    const prefix = {
      firewalls: 'FW',
      secure_configuration: 'SC',
      update_management: 'SUM',
      user_access_control: 'UAC',
      malware_protection: 'MP'
    };
    for (const r of CE_REQUIREMENTS) {
      assert.match(r.code, /^[A-Z]+\.[A-Z0-9_]+$/, r.code);
      assert.ok(r.code.startsWith(`${prefix[r.theme]}.`), r.code);
      assert.ok(
        CE_THEMES.some((t) => t.id === r.theme),
        r.code
      );
    }
    for (const t of CE_THEMES)
      assert.ok(
        CE_REQUIREMENTS.some((r) => r.theme === t.id),
        `${t.id} has no requirements`
      );
  });

  it('cites a page inside the document for every edition that holds a requirement or rule', () => {
    for (const r of [...CE_REQUIREMENTS, ...CE_SCOPE_RULES]) {
      for (const [edition, page] of Object.entries(r.pages)) {
        assert.ok(
          page! >= 3 && page! <= LAST_PAGE[edition as keyof typeof LAST_PAGE],
          `${r.code} cites page ${page} of ${edition}`
        );
      }
    }
  });

  it('names alternatives only among its own requirements', () => {
    for (const r of CE_REQUIREMENTS)
      for (const alt of r.alternatives ?? []) {
        assert.equal(ceRequirement(alt)?.theme, r.theme, `${r.code} → ${alt}`);
      }
  });

  it('keeps the scope rules NCSC refuses a scope over', () => {
    const v33 = scopeRulesOf('v3.3').map((r) => r.code);
    assert.ok(v33.includes('SCOPE.END_USER_DEVICES'));
    assert.ok(v33.includes('SCOPE.CLOUD_INCLUDED'));
    for (const reason of OUT_OF_SCOPE_REASONS)
      if (reason.rule)
        assert.ok(
          CE_SCOPE_RULES.some((r) => r.code === reason.rule),
          reason.value
        );
  });

  it('is written in Govern words, without dashes copy may not use', () => {
    for (const r of [...CE_REQUIREMENTS, ...CE_SCOPE_RULES, ...CE_THEMES]) {
      const text = 'summary' in r ? r.summary : r.aim;
      assert.doesNotMatch(text, /—/, `${'code' in r ? r.code : r.id}`);
      assert.match(text, /\.$/, `${'code' in r ? r.code : r.id} is cut short`);
    }
  });
});

describe('editions', () => {
  it('runs in date order, each with the question set that goes with it', () => {
    assert.deepEqual(
      CE_EDITIONS.map((e) => [e.id, e.questionSet]),
      [
        ['v3.2', 'Willow'],
        ['v3.3', 'Danzell']
      ]
    );
    const dates = CE_EDITIONS.map((e) => e.effectiveFrom);
    assert.deepEqual(dates, [...dates].sort());
  });

  it('starts new assessments on Danzell from 27 April 2026', () => {
    assert.equal(editionInForce(new Date('2026-04-26T12:00:00Z')).id, 'v3.2');
    assert.equal(editionInForce(new Date('2026-04-27T00:00:00Z')).id, 'v3.3');
    assert.equal(editionInForce(new Date('2026-11-18T00:00:00Z')).id, 'v3.3');
  });

  it('holds the same technical requirements in v3.2 and v3.3', () => {
    assert.deepEqual(
      requirementsOf('v3.2').map((r) => r.code),
      requirementsOf('v3.3').map((r) => r.code)
    );
  });

  it("fails a Danzell assessment outright on 14-day patching and cloud MFA, and nothing in Willow's", () => {
    assert.ok(isAutoFail('v3.3', 'SUM.CRITICAL_14_DAYS'));
    assert.ok(isAutoFail('v3.3', 'UAC.MFA_CLOUD'));
    assert.ok(!isAutoFail('v3.3', 'UAC.MFA'));
    assert.ok(!isAutoFail('v3.2', 'SUM.CRITICAL_14_DAYS'));
    for (const e of CE_EDITIONS)
      for (const a of e.autoFail)
        assert.ok(ceRequirement(a.code)?.pages[e.id], `${e.id} ${a.code}`);
  });
});

describe('the crosswalk', () => {
  it('carries every v3.2 requirement into v3.3 under the same code', () => {
    for (const r of requirementsOf('v3.2'))
      assert.equal(carryForward(r.code, 'v3.2', 'v3.3'), r.code);
  });

  it('flags the scope rules whose wording moved, and only those carry earlier wording', () => {
    for (const r of CE_SCOPE_RULES)
      assert.equal(
        changedBetween(r.code, 'v3.2', 'v3.3'),
        r.earlier?.['v3.2'] !== undefined,
        r.code
      );
  });

  it('drops a code the later edition does not hold', () => {
    assert.equal(carryForward('FW.NOT_A_THING', 'v3.2', 'v3.3'), null);
  });
});

describe('control references', () => {
  it('round-trips a requirement through a mitigation control reference', () => {
    const ref = formatControlRef('v3.3', 'UAC.MFA_CLOUD');
    assert.equal(ref, 'ce:v3.3:UAC.MFA_CLOUD');
    assert.equal(parseControlRef(ref)?.requirement.code, 'UAC.MFA_CLOUD');
    assert.equal(parseControlRef(` ${ref} `)?.edition, 'v3.3');
  });

  it("leaves an organisation's own control references alone", () => {
    for (const ref of [
      'A.8.3',
      'ISO 27001 A.5.15',
      'ce:v9.9:UAC.MFA',
      'ce:v3.3:UAC.NOT_A_THING',
      'ce:v3.3:uac.mfa',
      '',
      null,
      undefined
    ])
      assert.equal(parseControlRef(ref), null, String(ref));
  });

  it('describes a recognised reference and links to it', () => {
    const shown = describeControlRef('ce:v3.3:SUM.CRITICAL_14_DAYS');
    assert.match(shown!.text, /^Cyber Essentials v3\.3: .*14 days/);
    assert.equal(
      shown!.href,
      '/app/cyber-essentials/requirements?edition=v3.3#SUM.CRITICAL_14_DAYS'
    );
    assert.equal(describeControlRef('A.8.3'), null);
  });
});

describe('the reference library', () => {
  it('holds every current requirement and scope rule under a unique code', () => {
    const codes = LEGAL_REFERENCES.map((r) => r.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const r of [...requirementsOf('v3.3'), ...scopeRulesOf('v3.3')])
      assert.ok(codes.includes(ceReferenceCode('v3.3', r.code)), r.code);
    assert.ok(codes.includes('ncsc.ce.requirements'));
    assert.ok(codes.includes('ncsc.ce.plus'));
    assert.ok(codes.includes('ppn.014'));
    assert.equal(
      ceReferenceCode('v3.3', 'UAC.MFA_CLOUD'),
      'ncsc.ce.v3_3.uac.mfa_cloud'
    );
  });
});
