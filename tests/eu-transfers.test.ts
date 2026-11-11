import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessmentsRequired,
  cleanMechanisms,
  effectiveMechanisms,
  mechanismsFromText,
  TransferMechanismRefused
} from '@/lib/gdpr/transfers';
import { article30Gaps, type Activity } from '@/services/ropa';
import { article28Gaps, type Dpa, type Supplier } from '@/services/third-party';

describe('reading a transfer mechanism from text', () => {
  it('reads only what it names plainly', () => {
    assert.deepEqual(mechanismsFromText('SCCs with the UK Addendum'), [
      'eu_scc',
      'uk_addendum'
    ]);
    assert.deepEqual(mechanismsFromText('UK Addendum to SCCs'), [
      'uk_addendum'
    ]);
    assert.deepEqual(mechanismsFromText('IDTA'), ['idta']);
    assert.deepEqual(mechanismsFromText('EU-US DPF'), ['eu_adequacy']);
    assert.equal(mechanismsFromText('SCCs or something, TBC'), null);
    assert.equal(mechanismsFromText(''), null);
  });

  it('prefers what was chosen over the text', () => {
    assert.deepEqual(effectiveMechanisms([{ mechanism: 'idta' }], 'EU SCCs'), [
      'idta'
    ]);
    assert.deepEqual(effectiveMechanisms([], 'EU SCCs'), ['eu_scc']);
  });

  it('keeps known mechanisms once, with a module only on the EU clauses', () => {
    assert.deepEqual(
      cleanMechanisms([
        { mechanism: 'eu_scc', module: '2' },
        { mechanism: 'eu_scc' },
        { mechanism: 'idta', module: '3' }
      ]),
      [{ mechanism: 'eu_scc', module: 2 }, { mechanism: 'idta' }]
    );
    assert.throws(
      () => cleanMechanisms([{ mechanism: 'vibes' }]),
      TransferMechanismRefused
    );
    assert.throws(
      () => cleanMechanisms([{ mechanism: 'eu_scc', module: '7' }]),
      TransferMechanismRefused
    );
  });
});

describe('the assessment a transfer needs', () => {
  const none = { tra: false, tia: false };
  it('asks for each law its own assessment of an Article 46 safeguard', () => {
    assert.deepEqual(
      assessmentsRequired({
        laws: 'uk_eu',
        restricted: { uk: true, eu: true },
        mechanisms: ['eu_scc', 'uk_addendum'],
        onFile: none
      }),
      ['uk_transfer_no_tra', 'eu_transfer_no_tia']
    );
    assert.deepEqual(
      assessmentsRequired({
        laws: 'uk_eu',
        restricted: { uk: true, eu: true },
        mechanisms: ['eu_scc', 'uk_addendum'],
        onFile: { tra: true, tia: true }
      }),
      []
    );
  });

  it("flags a tool of the other law, and asks nothing of adequacy or what it can't read", () => {
    assert.deepEqual(
      assessmentsRequired({
        laws: 'uk',
        restricted: { uk: true, eu: true },
        mechanisms: ['eu_scc'],
        onFile: none
      }),
      ['uk_transfer_mechanism_not_uk']
    );
    assert.deepEqual(
      assessmentsRequired({
        laws: 'eu',
        restricted: { uk: true, eu: false },
        mechanisms: ['idta'],
        onFile: none
      }),
      []
    );
    assert.deepEqual(
      assessmentsRequired({
        laws: 'eu',
        restricted: { uk: false, eu: true },
        mechanisms: ['derogation'],
        onFile: none
      }),
      []
    );
    assert.deepEqual(
      assessmentsRequired({
        laws: 'eu',
        restricted: { uk: false, eu: true },
        mechanisms: null,
        onFile: none
      }),
      []
    );
  });
});

const activity = (over: Partial<Activity>): Activity =>
  ({
    purposes: ['Service'],
    subjectCategories: ['Customers'],
    dataCategories: ['Contact details'],
    recipients: ['Host'],
    transfers: [],
    retention: 'Six years',
    securityMeasures: 'Encrypted',
    controllerRole: 'controller',
    ownerId: 'u',
    regime: 'gdpr',
    laws: 'uk_eu',
    lawfulBases: ['contract'],
    recognisedCondition: null,
    outsidePublicTasks: false,
    ...over
  }) as Activity;

describe('the register', () => {
  // The UK approves the US only for certified recipients and has no decision
  // for Brazil; the EU has adequacy for Brazil and the UK.
  const UK_NEEDS = new Set(['US', 'IN', 'BR']);
  const EU_NEEDS = new Set(['US', 'IN']);

  it('judges each transfer against each law’s own list', () => {
    const toBrazil = activity({
      laws: 'eu',
      transfers: [{ country: 'BR' }]
    });
    assert.ok(
      !article30Gaps(toBrazil, UK_NEEDS, {
        euNeedsSafeguards: EU_NEEDS
      }).includes('transfer_safeguards')
    );
    assert.ok(
      article30Gaps({ ...toBrazil, laws: 'uk' }, UK_NEEDS, {
        euNeedsSafeguards: EU_NEEDS
      }).includes('transfer_safeguards')
    );
  });

  it('asks for the TRA and the TIA where the safeguard is an Article 46 tool', () => {
    const toIndia = activity({
      transfers: [{ country: 'IN', mechanism: 'SCCs with the UK Addendum' }]
    });
    const gaps = article30Gaps(toIndia, UK_NEEDS, {
      euNeedsSafeguards: EU_NEEDS,
      transferAssessments: { tra: true, tia: false }
    });
    assert.ok(gaps.includes('eu_transfer_no_tia'));
    assert.ok(!gaps.includes('uk_transfer_no_tra'));
  });
});

describe('an agreement', () => {
  const NOW = new Date('2026-11-12T00:00:00Z');
  const supplier = { role: 'processor', ownerId: 'u' } as Supplier;
  const dpa = (over: Partial<Dpa>): Dpa =>
    ({
      id: 'd',
      signedAt: NOW,
      expiresAt: null,
      archivedAt: null,
      subProcessors: ['Host'],
      transferMechanism: null,
      transferMechanisms: [],
      ...over
    }) as Dpa;

  it('asks for the assessment of the law of each Article 46 tool it relies on', () => {
    const gaps = article28Gaps(
      supplier,
      [dpa({ transferMechanisms: [{ mechanism: 'eu_scc', module: 2 }] })],
      NOW,
      { tra: false, tia: false }
    );
    assert.ok(gaps.includes('eu_transfer_no_tia'));
    assert.ok(!gaps.includes('uk_transfer_no_tra'));
    assert.ok(!gaps.includes('no_transfer_mechanism'));
    assert.ok(
      article28Gaps(supplier, [dpa({ transferMechanism: 'IDTA' })], NOW, {
        tra: false,
        tia: false
      }).includes('uk_transfer_no_tra')
    );
  });
});
