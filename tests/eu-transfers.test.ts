import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  assessments,
  countryRisk,
  entities,
  organisations,
  templates,
  templateVersions
} from '@/db/schema';
import {
  assessmentsRequired,
  cleanMechanisms,
  effectiveMechanisms,
  mechanismsFromText,
  TransferMechanismRefused
} from '@/lib/gdpr/transfers';
import { TIA_EU, TRA_UK } from '@/lib/templates/library/transfers';
import { TRA_PART3 } from '@/lib/templates/library/transfers-part3';
import {
  article30Gaps,
  createActivity,
  HARD_GAPS,
  loadActivity,
  type Activity
} from '@/services/ropa';
import { article28Gaps, type Dpa, type Supplier } from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'transfers test'
};

after(() => pg.end());

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
    assert.deepEqual(mechanismsFromText('DPF certification'), ['eu_adequacy']);
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

describe('assessments on file, in the database', () => {
  it('count only an approved TRA or TIA, and never the Part 3 transfer assessment', async () => {
    const [org] = await db
      .insert(organisations)
      .values({
        name: 'Transfers held',
        slug: `transfers-${crypto.randomUUID().slice(0, 8)}`
      })
      .returning();
    const [entity] = await db
      .insert(entities)
      .values({
        organisationId: org.id,
        name: 'Group',
        isDefault: true,
        dataProtectionLaw: 'uk_eu'
      })
      .returning();
    const made = await createActivity({
      organisationId: org.id,
      entityId: entity.id,
      name: 'Support desk',
      transfers: [{ country: 'IN', mechanism: 'SCCs with the UK Addendum' }],
      actor: SYSTEM
    });
    let n = 0;
    const attach = async (
      kind: 'tra' | 'tia',
      status: 'approved' | 'draft' | 'withdrawn',
      definition: object = TRA_UK
    ) => {
      const [t] = await db
        .insert(templates)
        .values({ organisationId: org.id, kind, name: `${kind} ${n}` })
        .returning();
      const [v] = await db
        .insert(templateVersions)
        .values({
          templateId: t.id,
          version: 1,
          definition: definition as typeof TRA_UK
        })
        .returning();
      n += 1;
      await db.insert(assessments).values({
        organisationId: org.id,
        entityId: entity.id,
        templateVersionId: v.id,
        reference: `TA-${n}`,
        title: `Assessment ${n}`,
        subjectType: 'processing_activity',
        subjectId: made.id,
        status
      });
    };
    const gaps = async () => (await loadActivity(made.id, org.id))!.gaps;

    await attach('tra', 'draft');
    await attach('tra', 'withdrawn');
    await attach('tra', 'approved', TRA_PART3);
    await attach('tia', 'approved', TIA_EU);
    let now = await gaps();
    assert.ok(now.includes('uk_transfer_no_tra'));
    assert.ok(!now.includes('eu_transfer_no_tia'));

    await attach('tra', 'approved');
    now = await gaps();
    assert.ok(!now.includes('uk_transfer_no_tra'));
  });
});

describe('the other review fixes', () => {
  it('counts a transfer on the other law’s tool as failing an inspection', () => {
    assert.ok(HARD_GAPS.includes('uk_transfer_mechanism_not_uk'));
    assert.ok(HARD_GAPS.includes('eu_transfer_mechanism_not_eu'));
  });

  it('checks the assessment for an agreement with another controller too', () => {
    const NOW = new Date('2026-11-12T00:00:00Z');
    const controller = { role: 'controller', ownerId: 'u' } as Supplier;
    const gaps = article28Gaps(
      controller,
      [
        {
          id: 'd',
          signedAt: NOW,
          expiresAt: null,
          archivedAt: null,
          subProcessors: [],
          transferMechanism: null,
          transferMechanisms: [{ mechanism: 'eu_scc', module: 1 }]
        } as unknown as Dpa
      ],
      NOW,
      { tra: false, tia: false }
    );
    assert.ok(gaps.includes('eu_transfer_no_tia'));
    assert.ok(!gaps.includes('no_transfer_mechanism'));
  });
});

describe('the library migration', () => {
  it("updates an organisation's own row only where nobody edited it", async () => {
    const make = async (note: string | null) => {
      const [org] = await db
        .insert(organisations)
        .values({
          name: 'Library copy',
          slug: `lib-${crypto.randomUUID().slice(0, 8)}`
        })
        .returning();
      const now = new Date();
      await db.insert(countryRisk).values({
        organisationId: org.id,
        code: 'BR',
        name: 'Brazil',
        ukAdequacy: 'not_adequate',
        euAdequacy: 'not_adequate',
        euAdequacyNote: note,
        reviewedAt: now,
        reviewedBy: 'test',
        nextReviewAt: now
      });
      return org.id;
    };
    const untouched = await make(null);
    const edited = await make('Our own reading of Brazilian law');
    const statements = readFileSync(
      join(process.cwd(), 'drizzle/0106_eu_transfers.sql'),
      'utf8'
    ).split('--> statement-breakpoint');
    for (const s of statements.slice(-3)) await db.execute(sql.raw(s));
    const statusOf = async (org: string) =>
      (
        await db
          .select({ eu: countryRisk.euAdequacy })
          .from(countryRisk)
          .where(eq(countryRisk.organisationId, org))
      )[0].eu;
    assert.equal(await statusOf(untouched), 'adequate');
    assert.equal(await statusOf(edited), 'not_adequate');
  });
});
