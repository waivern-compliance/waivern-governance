import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { breachDecisions, entities, organisations } from '@/db/schema';
import { obligationsFor } from '@/lib/breach/statutory';
import { s164aApplies } from '@/lib/complaints/statutory';
import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import { requestClock } from '@/lib/dsr/statutory';
import { authoritiesToNotify, regulatorFor } from '@/lib/gdpr/establishment';
import {
  loadBreach,
  recordBreach,
  recordDecision,
  updateBreach
} from '@/services/breaches';
import { loadComplaint, recordComplaint } from '@/services/complaints';
import {
  recordRequest,
  RequestRefused
} from '@/services/data-subject-requests';
import { EntityRefused, setDataProtectionLaw } from '@/services/entities';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'requests and breaches under both laws test'
};
const HOUR = 3_600_000;

after(() => pg.end());

describe('the request clock under both laws', () => {
  // Due on 25 December 2026, a bank holiday in England and Wales, with a
  // clarification pause: both reliefs are UK only.
  const base = {
    receivedAt: new Date('2026-11-25T10:00:00Z'),
    pauses: [
      {
        from: new Date('2026-11-27T10:00:00Z'),
        to: new Date('2026-11-30T10:00:00Z')
      }
    ],
    now: new Date('2026-12-01T10:00:00Z')
  };
  const due = (jurisdiction: DataProtectionLaw) => {
    const clock = requestClock({ ...base, jurisdiction });
    assert.ok('dueAt' in clock);
    return clock.dueAt.toISOString().slice(0, 10);
  };

  it('runs the EU deadline, which is never later than the UK one', () => {
    assert.equal(due('eu'), '2026-12-25');
    assert.equal(due('uk_eu'), due('eu'));
    assert.ok(due('uk') > due('uk_eu'));
  });

  it('gives a complaint under both laws the s.164A thirty days', () => {
    const at = {
      receivedAt: new Date('2026-11-01T00:00:00Z'),
      controllerRole: 'controller'
    };
    assert.equal(s164aApplies({ ...at, jurisdiction: 'uk_eu' }), true);
    assert.equal(s164aApplies({ ...at, jurisdiction: 'uk' }), true);
    assert.equal(s164aApplies({ ...at, jurisdiction: 'eu' }), false);
  });

  it('names both regulators', () => {
    const both = regulatorFor('uk_eu', {
      euLeadAuthority: 'fr-cnil',
      euEstablishments: ['FR'],
      euMainEstablishment: null
    });
    assert.match(both.complainTo, /^the Information Commission, or /);
    assert.match(both.complainTo, /CNIL/);
  });
});

describe('the authorities a breach is owed to', () => {
  type Facts = {
    euEstablishments: string[];
    euMainEstablishment: string | null;
    euLeadAuthority: string | null;
  };
  const established: Facts = {
    euEstablishments: ['FR'],
    euMainEstablishment: null,
    euLeadAuthority: 'fr-cnil'
  };
  const none: Facts = {
    euEstablishments: [],
    euMainEstablishment: null,
    euLeadAuthority: null
  };
  const codes = (
    laws: DataProtectionLaw,
    establishment = established,
    affectedStates: string[] = [],
    part3 = false
  ) =>
    authoritiesToNotify({ laws, establishment, affectedStates, part3 }).map(
      (t) => t.code ?? `?${t.country ?? ''}`
    );

  it('are the Information Commission and the lead authority, per law', () => {
    assert.deepEqual(codes('uk'), ['gb-ico']);
    assert.deepEqual(codes('eu'), ['fr-cnil']);
    assert.deepEqual(codes('uk_eu'), ['gb-ico', 'fr-cnil']);
    assert.deepEqual(codes('uk_eu', established, [], true), ['gb-ico']);
  });

  it('are each affected State authority where there is no EU establishment', () => {
    assert.deepEqual(codes('eu', none, ['IE', 'DE']), ['?DE', 'ie-dpc']);
    assert.deepEqual(codes('eu', none), ['?']);
  });

  it('each bring their own obligation', () => {
    const obligations = obligationsFor({
      role: 'controller',
      risk: 'risk',
      discoveredAt: new Date(),
      authorities: authoritiesToNotify({
        laws: 'uk_eu',
        establishment: established,
        affectedStates: []
      })
    }).filter((o) => o.kind === 'supervisory_authority');
    assert.deepEqual(
      obligations.map((o) => o.authorityCode),
      ['gb-ico', 'fr-cnil']
    );
  });
});

async function world(
  label: string,
  law: DataProtectionLaw,
  more: Partial<typeof entities.$inferInsert> = {}
) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Both laws ${label}`,
      slug: `both-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Group SA',
      isDefault: true,
      dataProtectionLaw: law,
      ...more
    })
    .returning();
  return { org, entity };
}

describe('requests and complaints to an entity under both laws', () => {
  it('are handled under both by default, and only where the entity is', async () => {
    const dual = await world('dual-request', 'uk_eu');
    const request = await recordRequest({
      organisationId: dual.org.id,
      entityId: dual.entity.id,
      rights: ['access'],
      channel: 'email',
      receivedAt: new Date(Date.now() - HOUR),
      description: 'A copy',
      requesterName: 'A person',
      actor: SYSTEM
    });
    assert.equal(request.jurisdiction, 'uk_eu');

    const complaint = await recordComplaint({
      organisationId: dual.org.id,
      entityId: dual.entity.id,
      channel: 'email',
      receivedAt: new Date(Date.now() - HOUR),
      subject: 'marketing',
      description: 'Still emailing me.',
      complainantName: 'A person',
      actor: SYSTEM
    });
    assert.equal(complaint.jurisdiction, 'uk_eu');
    assert.notEqual(
      (await loadComplaint(complaint.id, dual.org.id))!.clock.acknowledgement
        .state,
      'off'
    );

    const uk = await world('uk-request', 'uk');
    await assert.rejects(
      recordRequest({
        organisationId: uk.org.id,
        entityId: uk.entity.id,
        rights: ['access'],
        channel: 'email',
        receivedAt: new Date(Date.now() - HOUR),
        description: 'A copy',
        requesterName: 'A person',
        jurisdiction: 'uk_eu',
        actor: SYSTEM
      }),
      RequestRefused
    );
  });
});

describe('a breach under both laws', () => {
  it('is notified to each authority on its own clock', async () => {
    const w = await world('dual-breach', 'uk_eu', {
      euEstablishments: ['FR'],
      euLeadAuthority: 'fr-cnil'
    });
    const breach = await recordBreach({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Lost laptop',
      description: 'Unencrypted, with customer records.',
      discoveredAt: new Date(Date.now() - 10 * HOUR),
      actor: SYSTEM
    });
    assert.equal(breach.laws, 'uk_eu');
    let loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.deepEqual(
      loaded.authorityClocks.map((c) => c.target.code),
      ['gb-ico', 'fr-cnil']
    );

    const notify = (authorityCode?: string) =>
      recordDecision({
        organisationId: w.org.id,
        breachId: breach.id,
        kind: 'supervisory_authority',
        outcome: 'done',
        statutoryBasis: 'Article 33(1)',
        rationale: 'Risk to customers.',
        authorityCode,
        completedAt: new Date(),
        actor: SYSTEM
      });
    await assert.rejects(notify(), /more than one authority/);
    await notify('gb-ico');
    loaded = (await loadBreach(breach.id, w.org.id))!;
    const [ico, cnil] = loaded.authorityClocks;
    assert.equal(ico.clock.state, 'met');
    assert.equal(cnil.clock.state, 'running');
    // The breach as a whole is not done until every authority is told.
    assert.equal(loaded.clock.state, 'running');
  });

  it('takes a chosen Land authority for a German placeholder', async () => {
    const w = await world('eu-breach', 'eu');
    const breach = await recordBreach({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Misdirected email',
      description: 'Sent to the wrong customer.',
      discoveredAt: new Date(Date.now() - HOUR),
      actor: SYSTEM
    });
    await updateBreach({
      breachId: breach.id,
      organisationId: w.org.id,
      changes: { affectedStates: ['de'] },
      actor: SYSTEM
    });
    let loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.equal(loaded.authorityClocks.length, 1);
    assert.equal(loaded.authorityClocks[0].target.code, null);
    await recordDecision({
      organisationId: w.org.id,
      breachId: breach.id,
      kind: 'supervisory_authority',
      outcome: 'done',
      statutoryBasis: 'Article 33(1)',
      rationale: 'Customer in Hamburg.',
      authorityCode: 'de-hh',
      completedAt: new Date(),
      actor: SYSTEM
    });
    loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.equal(loaded.authorityClocks[0].clock.state, 'met');
  });

  it('stops the entity being narrowed while it is under the dropped law alone', async () => {
    const w = await world('narrow-breach', 'uk_eu');
    const breach = await recordBreach({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'EU leak',
      description: 'EU customers only.',
      discoveredAt: new Date(Date.now() - HOUR),
      laws: 'eu',
      actor: SYSTEM
    });
    await assert.rejects(
      setDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        law: 'uk',
        actor: SYSTEM
      }),
      (e: Error) =>
        e instanceof EntityRefused && e.message.includes(breach.reference)
    );
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, w.entity.id));
    assert.equal(entity.dataProtectionLaw, 'uk_eu');
  });
});

describe('the review fixes', () => {
  const decide = (
    w: { org: { id: string } },
    breachId: string,
    outcome: 'done' | 'pending',
    authorityCode?: string
  ) =>
    recordDecision({
      organisationId: w.org.id,
      breachId,
      kind: 'supervisory_authority',
      outcome,
      statutoryBasis: 'Article 33(1)',
      rationale: 'Risk to customers.',
      authorityCode,
      completedAt: outcome === 'done' ? new Date() : null,
      actor: SYSTEM
    });

  it('meets a placeholder with no State by the authority chosen, and refuses one the laws do not owe', async () => {
    const w = await world('placeholder', 'eu');
    const breach = await recordBreach({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Exposed bucket',
      description: 'Customer files public for a day.',
      discoveredAt: new Date(Date.now() - HOUR),
      actor: SYSTEM
    });
    await assert.rejects(
      decide(w, breach.id, 'done', 'gb-ico'),
      /not one this breach is owed/
    );
    await decide(w, breach.id, 'done', 'ie-dpc');
    const loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.equal(loaded.authorityClocks[0].clock.state, 'met');
    assert.equal(loaded.breach.status, 'notified');
  });

  it('takes a judgement without an authority, and is notified only once every authority is told', async () => {
    const w = await world('status', 'uk_eu', {
      euEstablishments: ['FR'],
      euLeadAuthority: 'fr-cnil'
    });
    const breach = await recordBreach({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Lost phone',
      description: 'Work phone with email.',
      discoveredAt: new Date(Date.now() - HOUR),
      actor: SYSTEM
    });
    await decide(w, breach.id, 'pending');
    await decide(w, breach.id, 'done', 'gb-ico');
    let loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.notEqual(loaded.breach.status, 'notified');
    await decide(w, breach.id, 'done', 'fr-cnil');
    loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.equal(loaded.breach.status, 'notified');
  });

  it('counts a notification made before this release on a breach now under both laws', async () => {
    const w = await world('legacy', 'uk_eu', {
      euEstablishments: ['FR'],
      euLeadAuthority: 'fr-cnil'
    });
    const breach = await recordBreach({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Old breach',
      description: 'Reported last month.',
      discoveredAt: new Date(Date.now() - 2 * HOUR),
      actor: SYSTEM
    });
    await db.insert(breachDecisions).values({
      organisationId: w.org.id,
      breachId: breach.id,
      kind: 'supervisory_authority',
      outcome: 'done',
      rationale: 'Told the regulator.',
      completedAt: new Date(Date.now() - HOUR),
      decidedByLabel: 'before'
    });
    // The migration's last statement, run as written.
    const migration = readFileSync(
      join(process.cwd(), 'drizzle/0104_eu_requests_complaints_breaches.sql'),
      'utf8'
    ).split('--> statement-breakpoint');
    await db.execute(sql.raw(migration[migration.length - 1]));
    const loaded = (await loadBreach(breach.id, w.org.id))!;
    const [ico, cnil] = loaded.authorityClocks;
    assert.equal(ico.clock.state, 'met');
    assert.equal(cnil.clock.state, 'running');
  });

  it('starts a law enforcement request to a competent authority under both laws under Part 3, as a UK request', async () => {
    const w = await world('part3', 'uk_eu', {
      competentAuthority: true,
      defaultRegime: 'dpa_part3'
    });
    const request = await recordRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      rights: ['access'],
      channel: 'email',
      receivedAt: new Date(Date.now() - HOUR),
      description: 'What is held about me',
      requesterName: 'A person',
      actor: SYSTEM
    });
    assert.equal(request.regime, 'dpa_part3');
    assert.equal(request.jurisdiction, 'uk');
  });
});
