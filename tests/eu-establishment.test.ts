import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { auditEvents, entities, organisations } from '@/db/schema';
import { EEA } from '@/lib/countries/library';
import { authoritiesIn, SUPERVISORY_AUTHORITIES } from '@/lib/gdpr/authorities';
import {
  cleanEstablishment,
  establishmentGaps,
  EstablishmentRefused,
  regulatorFor,
  suggestedLeadAuthority
} from '@/lib/gdpr/establishment';
import { loadComplaint, recordComplaint } from '@/services/complaints';
import { loadRequest, recordRequest } from '@/services/data-subject-requests';
import { issueIntakeLink, openIntakeLink } from '@/services/dsr-intake';
import {
  EntityRefused,
  setDataProtectionLaw,
  setEstablishment
} from '@/services/entities';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'establishment test'
};
const DAY = 86_400_000;

after(() => pg.end());

const blank = cleanEstablishment('uk_eu', {});

describe('the authorities', () => {
  it('give every EEA State at least one, with unique codes and secure addresses', () => {
    for (const [code] of EEA)
      assert.ok(authoritiesIn(code).length > 0, `none for ${code}`);
    const codes = SUPERVISORY_AUTHORITIES.map((a) => a.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const a of SUPERVISORY_AUTHORITIES)
      assert.match(a.website, /^https:\/\//, a.code);
  });
});

describe('the establishment rules', () => {
  it('refuse answers about a law the entity is not subject to', () => {
    assert.throws(
      () => cleanEstablishment('uk', { euEstablishments: ['FR'] }),
      EstablishmentRefused
    );
    assert.throws(
      () => cleanEstablishment('eu', { ukEstablishment: false }),
      EstablishmentRefused
    );
    assert.equal(cleanEstablishment('eu', {}).ukEstablishment, true);
  });

  it('keep the main establishment and the lead authority consistent', () => {
    assert.throws(
      () => cleanEstablishment('eu', { euEstablishments: ['XX'] }),
      /Not an EEA member State/
    );
    assert.throws(
      () =>
        cleanEstablishment('eu', {
          euEstablishments: ['FR'],
          euMainEstablishment: 'IE'
        }),
      /one of the EU establishments/
    );
    assert.throws(
      () =>
        cleanEstablishment('eu', {
          euEstablishments: ['FR', 'IE'],
          euMainEstablishment: 'IE',
          euLeadAuthority: 'fr-cnil'
        }),
      /Ireland/
    );
    assert.throws(
      () => cleanEstablishment('eu', { euLeadAuthority: 'gb-ico' }),
      /EU supervisory authority/
    );
    assert.throws(
      () =>
        cleanEstablishment('eu', {
          euRepresentative: { name: 'Rep Ltd', contact: 'rep@example.eu' }
        }),
      /Article 27\(3\)/
    );
  });

  it('report what is missing, for each law', () => {
    assert.deepEqual(establishmentGaps('eu', cleanEstablishment('eu', {})), [
      'eu_representative'
    ]);
    assert.deepEqual(
      establishmentGaps(
        'eu',
        cleanEstablishment('eu', { euRepresentativeExemption: 'occasional' })
      ),
      []
    );
    assert.deepEqual(
      establishmentGaps(
        'uk_eu',
        cleanEstablishment('uk_eu', {
          euEstablishments: ['FR', 'IE'],
          ukEstablishment: false
        })
      ),
      ['eu_main_establishment', 'uk_representative']
    );
    assert.deepEqual(
      establishmentGaps(
        'eu',
        cleanEstablishment('eu', { euEstablishments: ['FR'] })
      ),
      ['eu_lead_authority']
    );
    assert.deepEqual(establishmentGaps('uk', blank), []);
  });

  it('suggest the lead authority only where the home State has one', () => {
    assert.equal(
      suggestedLeadAuthority(
        cleanEstablishment('eu', { euEstablishments: ['IE'] })
      )?.code,
      'ie-dpc'
    );
    assert.equal(
      suggestedLeadAuthority(
        cleanEstablishment('eu', { euEstablishments: ['DE'] })
      ),
      null
    );
  });

  it('name the regulator under each law', () => {
    assert.equal(
      regulatorFor('uk', blank).complainTo,
      'the Information Commission'
    );
    assert.match(
      regulatorFor('eu', { ...blank, euLeadAuthority: 'de-hh' }).complainTo,
      /Hamburgische/
    );
    assert.match(
      regulatorFor('eu', { ...blank, euEstablishments: ['FR'] }).complainTo,
      /CNIL/
    );
    const unknown = regulatorFor('eu', { ...blank, euEstablishments: ['DE'] });
    assert.equal(unknown.authority, null);
    assert.match(unknown.complainTo, /where they live or work/);
  });
});

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Establishment ${label}`,
      slug: `est-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Europe SAS',
      isDefault: true,
      dataProtectionLaw: 'uk_eu'
    })
    .returning();
  return { org, entity };
}

describe('recording an establishment', () => {
  it('saves and audits it, and refuses narrowing while the other law is recorded', async () => {
    const w = await world('save');
    await setEstablishment({
      organisationId: w.org.id,
      entityId: w.entity.id,
      establishment: {
        euEstablishments: ['FR', 'DE'],
        euMainEstablishment: 'FR',
        euLeadAuthority: 'fr-cnil'
      },
      actor: SYSTEM
    });
    const [row] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, w.entity.id));
    assert.deepEqual(row.euEstablishments, ['FR', 'DE']);
    assert.equal(row.euLeadAuthority, 'fr-cnil');
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'entity.establishment_changed')
        )
      );
    assert.ok(event);

    await assert.rejects(
      setDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        law: 'uk',
        actor: SYSTEM
      }),
      (e: Error) =>
        e instanceof EntityRefused && /Clear them first/.test(e.message)
    );
  });

  it('names the lead authority on complaints, requests and the public form', async () => {
    const w = await world('names');
    await setEstablishment({
      organisationId: w.org.id,
      entityId: w.entity.id,
      establishment: { euEstablishments: ['FR'], euLeadAuthority: 'fr-cnil' },
      actor: SYSTEM
    });
    const complaint = await recordComplaint({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: new Date(Date.now() - DAY),
      subject: 'marketing',
      description: 'Still emailing me.',
      complainantName: 'A person',
      jurisdiction: 'eu',
      actor: SYSTEM
    });
    assert.match(
      (await loadComplaint(complaint.id, w.org.id))!.regulator.complainTo,
      /CNIL/
    );
    const ukRequest = await recordRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      rights: ['access'],
      channel: 'email',
      receivedAt: new Date(Date.now() - DAY),
      description: 'A copy',
      requesterName: 'A person',
      jurisdiction: 'uk',
      actor: SYSTEM
    });
    assert.equal(
      (await loadRequest(ukRequest.id, w.org.id))!.regulator.complainTo,
      'the Information Commission'
    );

    await db
      .update(entities)
      .set({ dataProtectionLaw: 'eu' })
      .where(eq(entities.id, w.entity.id));
    const link = await issueIntakeLink({
      organisationId: w.org.id,
      entityId: w.entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    assert.match((await openIntakeLink(link.slug))!.euRegulator, /CNIL/);
  });
});
