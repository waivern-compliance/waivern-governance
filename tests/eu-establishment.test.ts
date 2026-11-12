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
import { establishmentFromForm } from '@/lib/gdpr/establishment-form';
import {
  loadComplaint,
  recordComplaint,
  recordComplaintEvent,
  recordComplaintOutcome
} from '@/services/complaints';
import {
  loadRequest,
  recordRequest,
  respondToRequest
} from '@/services/data-subject-requests';
import { issueIntakeLink, openIntakeLink } from '@/services/dsr-intake';
import {
  dpoPosition,
  EntityRefused,
  establishmentOf,
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
      () => cleanEstablishment('eu', { ukEstablishment: true }),
      /Article 3\(1\)/
    );
    assert.throws(
      () =>
        cleanEstablishment('eu', {
          ukRepresentative: { name: 'Rep', contact: 'rep@example.uk' }
        }),
      EstablishmentRefused
    );
    // EU law only means not established in the UK.
    assert.equal(cleanEstablishment('eu', {}).ukEstablishment, false);
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
    // No one-stop shop without an EU establishment.
    assert.throws(
      () => cleanEstablishment('eu', { euLeadAuthority: 'fr-cnil' }),
      /established in the EU/
    );
    // Several establishments and no main one: the lead must still be one of them.
    assert.throws(
      () =>
        cleanEstablishment('eu', {
          euEstablishments: ['FR', 'IE'],
          euLeadAuthority: 'nl-ap'
        }),
      /not among the EU establishments/
    );
    assert.equal(
      cleanEstablishment('eu', {
        euEstablishments: ['FR', 'IE'],
        euLeadAuthority: 'ie-dpc'
      }).euLeadAuthority,
      'ie-dpc'
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
    const hamburg = regulatorFor('eu', {
      ...blank,
      euLeadAuthority: 'de-hh'
    });
    assert.match(hamburg.complainTo, /Hamburgische/);
    assert.match(hamburg.short, /Hamburgische/);
    // Article 77(1): the right is to any authority, not only the lead one.
    assert.match(hamburg.complainTo, /where they live or work/);
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
    const form = (await openIntakeLink(link.slug))!;
    // The complaint confirmation names the entity's regulator, not the UK's.
    assert.match(form.regulator, /CNIL/);
    assert.doesNotMatch(form.regulator, /Information Commission/);
    // Addressed to the person reading it.
    assert.match(form.regulator, /where you live/);
  });
});

describe('the establishment form', () => {
  it('reads every field, and leaves the UK answer out when it is not asked', () => {
    const f = new FormData();
    f.append('euEstablishments', 'FR');
    f.append('euEstablishments', 'IE');
    f.set('euMainEstablishment', 'IE');
    f.set('euLeadAuthority', 'ie-dpc');
    f.set('euRepName', ' ');
    f.set('euRepContact', '');
    f.set('euRepExemption', '');
    f.set('ukRepName', 'UK Rep Ltd');
    f.set('ukRepContact', 'rep@example.uk');
    f.set('ukRepExemption', '');
    f.set('euPublicBody', 'on');
    const read = establishmentFromForm(f);
    assert.equal('ukEstablishment' in read, false);
    assert.deepEqual(read.euEstablishments, ['FR', 'IE']);
    assert.equal(read.euMainEstablishment, 'IE');
    assert.equal(read.euLeadAuthority, 'ie-dpc');
    assert.equal(read.euRepresentativeExemption, null);
    assert.equal(read.euPublicBody, true);
    const cleaned = cleanEstablishment('uk_eu', read);
    assert.equal(cleaned.euRepresentative, null);
    assert.deepEqual(cleaned.ukRepresentative, {
      name: 'UK Rep Ltd',
      contact: 'rep@example.uk',
      country: null
    });

    f.set('ukEstablishment', 'no');
    assert.equal(establishmentFromForm(f).ukEstablishment, false);
    f.set('ukEstablishment', 'yes');
    assert.equal(establishmentFromForm(f).ukEstablishment, true);
  });
});

describe('narrowing and widening the law', () => {
  it('marks an EU-only entity as not established in the UK, so widening asks for a UK representative', async () => {
    const w = await world('narrow');
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'eu',
      actor: SYSTEM
    });
    const read = async () =>
      (await db.select().from(entities).where(eq(entities.id, w.entity.id)))[0];
    assert.equal((await read()).ukEstablishment, false);
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'uk_eu',
      actor: SYSTEM
    });
    const widened = await read();
    assert.ok(
      establishmentGaps('uk_eu', establishmentOf(widened)).includes(
        'uk_representative'
      )
    );
  });

  it('refuses narrowing to EU only while a UK representative is recorded', async () => {
    const w = await world('narrow-rep');
    await setEstablishment({
      organisationId: w.org.id,
      entityId: w.entity.id,
      establishment: {
        euEstablishments: ['FR'],
        ukEstablishment: false,
        ukRepresentative: { name: 'UK Rep', contact: 'rep@example.uk' }
      },
      actor: SYSTEM
    });
    await assert.rejects(
      setDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        law: 'eu',
        actor: SYSTEM
      }),
      (e: Error) =>
        e instanceof EntityRefused && /UK representative/.test(e.message)
    );
  });
});

describe('saving the establishment', () => {
  it('does not audit a save that changes nothing', async () => {
    const w = await world('noop');
    const save = () =>
      setEstablishment({
        organisationId: w.org.id,
        entityId: w.entity.id,
        establishment: {
          euEstablishments: ['FR'],
          euLeadAuthority: 'fr-cnil',
          ukRepresentative: { name: 'UK Rep', contact: 'rep@example.uk' }
        },
        actor: SYSTEM
      });
    await save();
    await save();
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'entity.establishment_changed')
        )
      );
    assert.equal(events.length, 1);
  });

  it('treats an EU public body as needing a DPO', async () => {
    const w = await world('public');
    await setEstablishment({
      organisationId: w.org.id,
      entityId: w.entity.id,
      establishment: { euEstablishments: ['FR'], euPublicBody: true },
      actor: SYSTEM
    });
    const position = await dpoPosition(w.org.id);
    assert.equal(
      position.entities.find((e) => e.id === w.entity.id)?.missing,
      true
    );
  });
});

describe('what was said to people', () => {
  it('keeps the regulator named at the time, after the lead authority changes', async () => {
    const w = await world('history');
    const establish = (lead: string, state: string) =>
      setEstablishment({
        organisationId: w.org.id,
        entityId: w.entity.id,
        establishment: { euEstablishments: [state], euLeadAuthority: lead },
        actor: SYSTEM
      });
    await establish('fr-cnil', 'FR');
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
    await recordComplaintOutcome({
      complaintId: complaint.id,
      organisationId: w.org.id,
      outcome: 'upheld',
      channel: 'email',
      summary: 'Stopped the emails.',
      toldOfRegulatorRight: true,
      actor: SYSTEM
    });
    await recordComplaintEvent({
      complaintId: complaint.id,
      organisationId: w.org.id,
      kind: 'regulator_contact',
      note: 'The CNIL asked for our account.',
      actor: SYSTEM
    });
    const request = await recordRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      rights: ['erasure'],
      channel: 'email',
      receivedAt: new Date(Date.now() - DAY),
      description: 'Delete me',
      requesterName: 'A person',
      jurisdiction: 'eu',
      actor: SYSTEM
    });
    await respondToRequest({
      requestId: request.id,
      organisationId: w.org.id,
      outcome: 'refused',
      channel: 'email',
      summary: 'Kept for a legal claim.',
      toldOfComplaintRight: true,
      actor: SYSTEM
    });

    await establish('ie-dpc', 'IE');

    const loaded = (await loadComplaint(complaint.id, w.org.id))!;
    assert.match(loaded.complaint.toldRegulator ?? '', /CNIL/);
    assert.match(
      loaded.events.find((e) => e.kind === 'regulator_contact')?.authority ??
        '',
      /CNIL/
    );
    assert.match(loaded.regulator.short, /Data Protection Commission/);
    const answered = (await loadRequest(request.id, w.org.id))!;
    assert.match(answered.request.toldComplaintTo ?? '', /CNIL/);
  });
});
