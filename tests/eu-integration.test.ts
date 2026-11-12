import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  dpas,
  entities,
  organisations,
  processingActivities
} from '@/db/schema';
import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import type { AuthedConnection } from '@/lib/integration/auth';
import { dpaIn, processingActivityIn } from '@/lib/integration/contracts';
import { complaintsSummary, recordComplaint } from '@/services/complaints';
import { createConnection } from '@/services/connections';
import {
  recordRequest,
  requestsSummary
} from '@/services/data-subject-requests';
import { CONTEXT_VERSION, governanceContext } from '@/services/export';
import { ingestDpas, ingestProcessingActivities } from '@/services/ingest';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'EU integration test'
};
const HOUR = 3_600_000;

after(() => pg.end());

async function world(
  label: string,
  law: DataProtectionLaw,
  more: Partial<typeof entities.$inferInsert> = {}
) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `EU wire ${label}`,
      slug: `euw-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Europe SAS',
      isDefault: true,
      dataProtectionLaw: law,
      ...more
    })
    .returning();
  const conn = await createConnection({
    organisationId: org.id,
    kind: 'waivern_portal',
    name: 'Portal',
    defaultEntityId: entity.id,
    actor: SYSTEM
  });
  const portal: AuthedConnection = {
    id: conn.id,
    organisationId: org.id,
    kind: 'waivern_portal',
    name: 'Portal',
    defaultEntityId: entity.id
  };
  return { org, entity, portal };
}

const activity = (r: Record<string, unknown>) => processingActivityIn.parse(r);
const byRef = async (orgId: string, ref: string) =>
  (
    await db
      .select()
      .from(processingActivities)
      .where(eq(processingActivities.organisationId, orgId))
  ).find((r) => r.externalRef === ref);

describe('pushing records under EU law', () => {
  it('takes the laws sent, and skips laws outside the entity with the reason', async () => {
    const dual = await world('laws', 'uk_eu');
    const out = await ingestProcessingActivities(dual.portal, [
      activity({ externalRef: 'payroll', name: 'Payroll', laws: 'uk' }),
      activity({ externalRef: 'crm', name: 'Customers' })
    ]);
    assert.equal(out.created, 2);
    assert.equal((await byRef(dual.org.id, 'payroll'))!.laws, 'uk');
    assert.equal((await byRef(dual.org.id, 'crm'))!.laws, 'uk_eu');

    const uk = await world('laws-uk', 'uk');
    const refused = await ingestProcessingActivities(uk.portal, [
      activity({ externalRef: 'eu-leads', name: 'EU leads', laws: 'eu' })
    ]);
    assert.equal(refused.skipped.length, 1);
    assert.match(refused.skipped[0].reason, /subject to the .* only/);
  });

  it('skips recognised legitimate interests on an EU-only record and accepts it on a dual one', async () => {
    const w = await world('ea', 'uk_eu');
    const out = await ingestProcessingActivities(w.portal, [
      activity({
        externalRef: 'eu-only',
        name: 'EU only',
        laws: 'eu',
        lawfulBases: ['recognised_legitimate_interests'],
        recognisedCondition: 'crime'
      }),
      activity({
        externalRef: 'dual',
        name: 'Both',
        lawfulBases: ['recognised_legitimate_interests'],
        recognisedCondition: 'crime'
      })
    ]);
    assert.equal(out.created, 1);
    assert.deepEqual(
      out.skipped.map((s) => s.externalRef),
      ['eu-only']
    );
  });

  it('checks the recorded bases again when a push narrows the laws', async () => {
    const w = await world('narrow', 'uk_eu');
    await ingestProcessingActivities(w.portal, [
      activity({
        externalRef: 'fraud',
        name: 'Fraud',
        lawfulBases: ['recognised_legitimate_interests'],
        recognisedCondition: 'crime'
      })
    ]);
    const out = await ingestProcessingActivities(w.portal, [
      activity({ externalRef: 'fraud', name: 'Fraud', laws: 'eu' })
    ]);
    assert.equal(out.skipped.length, 1);
    const row = (await byRef(w.org.id, 'fraud'))!;
    assert.equal(row.laws, 'uk_eu');
    assert.deepEqual(row.lawfulBases, ['recognised_legitimate_interests']);
  });

  it("judges an existing record's laws against its own entity, not the push's default", async () => {
    const w = await world('owner', 'uk');
    const [eu] = await db
      .insert(entities)
      .values({
        organisationId: w.org.id,
        name: 'Europe BV',
        dataProtectionLaw: 'eu'
      })
      .returning();
    await ingestProcessingActivities(w.portal, [
      activity({ externalRef: 'leads', name: 'Leads', entity: 'Europe BV' })
    ]);
    // No entity named: the connection's default (UK) would refuse EU law.
    const out = await ingestProcessingActivities(w.portal, [
      activity({ externalRef: 'leads', name: 'Leads', laws: 'eu' })
    ]);
    assert.equal(out.skipped.length, 0);
    const row = (await byRef(w.org.id, 'leads'))!;
    assert.equal(row.entityId, eu.id);
    assert.equal(row.laws, 'eu');
  });

  it('keeps a Part 3 record under UK law', async () => {
    const w = await world('part3', 'uk_eu');
    await ingestProcessingActivities(w.portal, [
      activity({ externalRef: 'cases', name: 'Cases' })
    ]);
    await db
      .update(processingActivities)
      .set({ regime: 'dpa_part3' })
      .where(eq(processingActivities.id, (await byRef(w.org.id, 'cases'))!.id));
    const out = await ingestProcessingActivities(w.portal, [
      activity({ externalRef: 'cases', name: 'Cases', laws: 'eu' })
    ]);
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0].reason, /Part 3/);
  });

  it('records the EU answers, keeps them when a push leaves them out, and reads them back', async () => {
    const w = await world('eu-fields', 'eu', {
      euEstablishments: ['FR'],
      euLeadAuthority: 'fr-cnil'
    });
    const adm = {
      solelyAutomated: true,
      specialCategory: false,
      safeguards: {
        representations: { confirmed: true },
        humanIntervention: { confirmed: true },
        contest: { confirmed: true }
      }
    };
    await ingestProcessingActivities(w.portal, [
      activity({
        externalRef: 'scoring',
        name: 'Scoring',
        lawfulBases: ['contract'],
        automatedDecisions: { ...adm, euException: 'contract' },
        furtherProcessing: {
          isFurtherProcessing: true,
          euRoute: 'law',
          euNote: 'Code monétaire et financier'
        },
        childrenMemberStates: ['fr', 'IE']
      })
    ]);
    // A Portal that does not know the EU fields leaves them alone.
    await ingestProcessingActivities(w.portal, [
      activity({
        externalRef: 'scoring',
        name: 'Scoring',
        lawfulBases: ['contract'],
        automatedDecisions: adm,
        furtherProcessing: { isFurtherProcessing: true }
      })
    ]);
    const row = (await byRef(w.org.id, 'scoring'))!;
    assert.equal(row.admEuException, 'contract');
    assert.equal(row.euCompatibilityRoute, 'law');
    assert.deepEqual(row.childrenMemberStates, ['FR', 'IE']);

    const context = await governanceContext({ organisationId: w.org.id });
    assert.equal(context.contextVersion, CONTEXT_VERSION);
    assert.equal(CONTEXT_VERSION, '1.4');
    const [entity] = context.entities;
    assert.equal(entity.dataProtectionLaw, 'eu');
    assert.deepEqual(entity.euLeadAuthority?.code, 'fr-cnil');
    assert.deepEqual(entity.euEstablishments, ['FR']);
    const exported = context.processingActivities.find(
      (a) => a.name === 'Scoring'
    )!;
    assert.equal(exported.laws, 'eu');
    assert.equal(exported.automatedDecisions.euException, 'contract');
    assert.equal(exported.furtherProcessing.euRoute, 'law');
    assert.deepEqual(exported.childrenMemberStates, ['FR', 'IE']);
  });

  it('skips a record naming a State outside the EEA', async () => {
    const w = await world('children', 'eu');
    const out = await ingestProcessingActivities(w.portal, [
      activity({
        externalRef: 'app',
        name: 'App',
        childrenMemberStates: ['GB']
      })
    ]);
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0].reason, /Not an EEA member State/);
  });
});

describe('agreements and summaries', () => {
  it('stores chosen transfer mechanisms, exports them, and skips an unknown one', async () => {
    const w = await world('dpa', 'uk_eu');
    const out = await ingestDpas(w.portal, [
      dpaIn.parse({
        externalRef: 'dpa-1',
        vendorName: 'Hosting Ltd',
        title: 'Hosting DPA',
        transferMechanism: 'SCCs, module 2, with the UK Addendum',
        transferMechanisms: [
          { mechanism: 'eu_scc', module: 2 },
          { mechanism: 'uk_addendum' }
        ]
      }),
      dpaIn.parse({
        externalRef: 'dpa-2',
        vendorName: 'Other Ltd',
        title: 'Other DPA',
        transferMechanisms: [{ mechanism: 'vibes' }]
      })
    ]);
    assert.equal(out.created, 1);
    assert.equal(out.skipped[0].externalRef, 'dpa-2');
    const [row] = await db
      .select()
      .from(dpas)
      .where(eq(dpas.organisationId, w.org.id));
    assert.deepEqual(row.transferMechanisms, [
      { mechanism: 'eu_scc', module: 2 },
      { mechanism: 'uk_addendum' }
    ]);
    const context = await governanceContext({ organisationId: w.org.id });
    assert.deepEqual(
      context.suppliers[0].dpas[0].transferMechanisms,
      row.transferMechanisms
    );
  });

  it('break the request and complaint counts down by law', async () => {
    const w = await world('summaries', 'uk_eu');
    const received = new Date(Date.now() - HOUR);
    for (const jurisdiction of ['uk', 'uk_eu', 'uk_eu'] as const) {
      await recordRequest({
        organisationId: w.org.id,
        entityId: w.entity.id,
        rights: ['access'],
        channel: 'email',
        receivedAt: received,
        description: 'A copy',
        requesterName: 'A person',
        jurisdiction,
        actor: SYSTEM
      });
    }
    await recordComplaint({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: received,
      subject: 'marketing',
      description: 'Still emailing me.',
      complainantName: 'A person',
      jurisdiction: 'eu',
      actor: SYSTEM
    });
    const requests = await requestsSummary({ organisationId: w.org.id });
    assert.equal(requests.summaryVersion, '1.1');
    assert.equal(requests.byLaw.uk.received, 1);
    assert.equal(requests.byLaw.uk_eu.received, 2);
    assert.equal(requests.byLaw.eu.received, 0);
    const complaints = await complaintsSummary({ organisationId: w.org.id });
    assert.equal(complaints.byLaw.eu.received, 1);
    assert.equal(complaints.byLaw.uk.received, 0);
  });
});
