import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  dataSubjectRequests,
  entities,
  memberships,
  organisations,
  users
} from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import { can } from '@/lib/rbac';
import { loadRequest } from '@/services/data-subject-requests';
import {
  anyEntityUnderFoi,
  EntityRefused,
  setDataProtectionLaw,
  setFreedomOfInformation,
  setPublicAuthority
} from '@/services/entities';
import {
  closeInformationRequest,
  convertedFrom,
  convertToSubjectAccessRequest,
  InformationRequestRefused,
  informationRequestRegister,
  loadInformationRequest,
  recordClarification,
  recordInformationRequest,
  respondToInformationRequest,
  updateInformationRequest
} from '@/services/information-requests';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'foi test'
};
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

after(() => pg.end());

async function world(label: string, act: 'foia' | 'foisa' | null = 'foia') {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `FOI ${label}`,
      slug: `foi-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Council', isDefault: true })
    .returning();
  const [handler] = await db
    .insert(users)
    .values({ email: `handler-${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: handler.id });
  if (act)
    await setFreedomOfInformation({
      organisationId: org.id,
      entityId: entity.id,
      act,
      timeProfile: 'standard',
      actor: SYSTEM
    });
  return { org, entity, handler };
}

async function aRequest(
  w: Awaited<ReturnType<typeof world>>,
  over: Partial<Parameters<typeof recordInformationRequest>[0]> = {}
) {
  return recordInformationRequest({
    organisationId: w.org.id,
    entityId: w.entity.id,
    channel: 'email',
    receivedAt: daysAgo(2),
    description: 'Spending on agency staff in 2025.',
    requesterName: 'Alex Applicant',
    correspondenceAddress: 'alex@example.com',
    actor: SYSTEM,
    ...over
  });
}

const refusedWith = (pattern: RegExp) => (error: unknown) =>
  error instanceof InformationRequestRefused && pattern.test(error.message);

describe('which Act an entity answers under', () => {
  it('makes the entity a public authority, and is audited', async () => {
    const w = await world('entity');
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, w.entity.id));
    assert.equal(entity.foiAct, 'foia');
    assert.equal(entity.publicAuthority, true);
    assert.equal(await anyEntityUnderFoi(w.org.id), true);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'entity.foi_changed')
        )
      );
    assert.equal((event.after as { foiAct: string }).foiAct, 'foia');
  });

  it('will not stop being a public authority while an Act applies', async () => {
    const w = await world('authority');
    await assert.rejects(
      setPublicAuthority({
        organisationId: w.org.id,
        entityId: w.entity.id,
        publicAuthority: false,
        actor: SYSTEM
      }),
      EntityRefused
    );
  });

  it('is refused for an entity under EU law only', async () => {
    const w = await world('eu', null);
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'eu',
      actor: SYSTEM
    });
    await assert.rejects(
      setFreedomOfInformation({
        organisationId: w.org.id,
        entityId: w.entity.id,
        act: 'foia',
        timeProfile: 'standard',
        actor: SYSTEM
      }),
      EntityRefused
    );
  });
});

describe('recording a request', () => {
  it('takes a reference and the Act, and keeps the requester out of the audit chain', async () => {
    const w = await world('record');
    const request = await aRequest(w);
    assert.match(request.reference, /^FOI-\d{4}-0001$/);
    assert.equal(request.act, 'foia');
    assert.deepEqual(request.regimes, ['foia']);
    assert.equal(request.status, 'open');

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, w.org.id));
    const recorded = events.find((e) => e.action === 'foi.recorded');
    assert.ok(recorded);
    const chain = JSON.stringify(events);
    assert.ok(!chain.includes('Alex Applicant'));
    assert.ok(!chain.includes('alex@example.com'));
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
  });

  it('is refused for an entity no Act applies to', async () => {
    const w = await world('none', null);
    await assert.rejects(aRequest(w), refusedWith(/Organisation page/));
  });

  it('files environmental information under the regulations of the Act', async () => {
    const england = await world('kind-e');
    const scotland = await world('kind-s', 'foisa');
    assert.deepEqual(
      (await aRequest(england, { kind: 'environmental' })).regimes,
      ['eir']
    );
    assert.deepEqual((await aRequest(scotland, { kind: 'both' })).regimes, [
      'foisa',
      'eisr'
    ]);
    await assert.rejects(
      aRequest(england, { regimes: ['foisa'] }),
      refusedWith(/handled under/)
    );
  });

  it('takes a spoken request only for environmental information', async () => {
    const w = await world('spoken');
    await assert.rejects(
      aRequest(w, { channel: 'phone' }),
      refusedWith(/must be in writing/)
    );
    const spoken = await aRequest(w, {
      channel: 'phone',
      kind: 'environmental'
    });
    assert.equal(spoken.channel, 'phone');
  });

  it('needs a name and a description, and cannot arrive in the future', async () => {
    const w = await world('valid');
    await assert.rejects(
      aRequest(w, { requesterName: ' ' }),
      InformationRequestRefused
    );
    await assert.rejects(
      aRequest(w, { description: '' }),
      InformationRequestRefused
    );
    await assert.rejects(
      aRequest(w, { receivedAt: new Date(Date.now() + DAY) }),
      InformationRequestRefused
    );
  });
});

describe('the clock', () => {
  it('runs twenty working days from receipt and shows on the register', async () => {
    const w = await world('clock');
    await aRequest(w, { receivedAt: daysAgo(1) });
    await aRequest(w, { receivedAt: daysAgo(60) });
    const register = await informationRequestRegister(w.org.id, null);
    assert.equal(register.total, 2);
    assert.equal(register.open, 2);
    assert.equal(register.overdue, 1);
    assert.equal(register.rows[0].clock.state, 'running');
  });

  it('waits while clarification is sought and starts again from the answer', async () => {
    const w = await world('clarify');
    const request = await aRequest(w, { receivedAt: daysAgo(40) });
    await recordClarification({
      organisationId: w.org.id,
      requestId: request.id,
      step: 'sought',
      at: daysAgo(39),
      actor: SYSTEM
    });
    let loaded = await loadInformationRequest(request.id, w.org.id);
    assert.equal(loaded?.clock.state, 'waiting');
    await recordClarification({
      organisationId: w.org.id,
      requestId: request.id,
      step: 'received',
      at: daysAgo(1),
      actor: SYSTEM
    });
    loaded = await loadInformationRequest(request.id, w.org.id);
    assert.equal(loaded?.clock.state, 'running');
  });

  it('refuses an answer before a question', async () => {
    const w = await world('clarify-order');
    const request = await aRequest(w);
    await assert.rejects(
      recordClarification({
        organisationId: w.org.id,
        requestId: request.id,
        step: 'received',
        at: daysAgo(1),
        actor: SYSTEM
      }),
      refusedWith(/before recording the answer/)
    );
  });

  it('extends only environmental requests, and only FOIA for a Commission date', async () => {
    const w = await world('extend');
    const request = await aRequest(w);
    await assert.rejects(
      updateInformationRequest({
        organisationId: w.org.id,
        requestId: request.id,
        extendedForComplexity: true,
        actor: SYSTEM
      }),
      refusedWith(/Only environmental information/)
    );
    const updated = await updateInformationRequest({
      organisationId: w.org.id,
      requestId: request.id,
      regimes: ['foia', 'eir'],
      extendedForComplexity: true,
      actor: SYSTEM
    });
    assert.equal(updated.extendedForComplexity, true);

    const scotland = await world('extend-s', 'foisa');
    const scottish = await aRequest(scotland);
    await assert.rejects(
      updateInformationRequest({
        organisationId: scotland.org.id,
        requestId: scottish.id,
        commissionSetDeadline: daysAgo(-30),
        actor: SYSTEM
      }),
      refusedWith(/only under FOIA/)
    );
  });
});

describe('ending a request', () => {
  it('needs a reason when the response was late', async () => {
    const w = await world('late');
    const request = await aRequest(w, { receivedAt: daysAgo(60) });
    await assert.rejects(
      respondToInformationRequest({
        organisationId: w.org.id,
        requestId: request.id,
        respondedAt: daysAgo(0),
        summary: 'Released in part; s.43 applied to rates.',
        actor: SYSTEM
      }),
      refusedWith(/after the deadline/)
    );
    const responded = await respondToInformationRequest({
      organisationId: w.org.id,
      requestId: request.id,
      respondedAt: daysAgo(0),
      summary: 'Released in part; s.43 applied to rates.',
      lateReason: 'Records held off-site.',
      published: true,
      actor: SYSTEM
    });
    assert.equal(responded.status, 'responded');
    const loaded = await loadInformationRequest(request.id, w.org.id);
    assert.equal(loaded?.clock.state, 'late');
    await assert.rejects(
      closeInformationRequest({
        organisationId: w.org.id,
        requestId: request.id,
        rationale: 'Withdrawn',
        actor: SYSTEM
      }),
      refusedWith(/answered or closed/)
    );
  });

  it('closes a request owed no response, with the reason', async () => {
    const w = await world('close');
    const request = await aRequest(w);
    await assert.rejects(
      closeInformationRequest({
        organisationId: w.org.id,
        requestId: request.id,
        rationale: ' ',
        actor: SYSTEM
      }),
      InformationRequestRefused
    );
    const closed = await closeInformationRequest({
      organisationId: w.org.id,
      requestId: request.id,
      rationale: 'Withdrawn by the requester.',
      actor: SYSTEM
    });
    assert.equal(closed.status, 'closed');
  });
});

describe('a request for their own personal data', () => {
  it('becomes a subject access request from the same day, linked both ways', async () => {
    const w = await world('convert');
    const request = await aRequest(w, {
      receivedAt: daysAgo(3),
      description: 'Everything you hold about me.'
    });
    const { request: after, dataSubjectRequest } =
      await convertToSubjectAccessRequest({
        organisationId: w.org.id,
        requestId: request.id,
        actor: SYSTEM
      });
    assert.equal(after.status, 'converted');
    assert.equal(after.convertedToRequestId, dataSubjectRequest.id);
    assert.equal(
      dataSubjectRequest.receivedAt.getTime(),
      request.receivedAt.getTime()
    );
    assert.deepEqual(dataSubjectRequest.rights, ['access']);
    assert.equal(dataSubjectRequest.requesterContact, 'alex@example.com');

    const dsr = await loadRequest(dataSubjectRequest.id, w.org.id);
    assert.ok(dsr);
    assert.deepEqual(await convertedFrom(dataSubjectRequest.id, w.org.id), {
      id: request.id,
      reference: request.reference
    });
    const loaded = await loadInformationRequest(request.id, w.org.id);
    assert.equal(loaded?.convertedToReference, dataSubjectRequest.reference);
    assert.equal(loaded?.clock.state, 'closed');

    await assert.rejects(
      convertToSubjectAccessRequest({
        organisationId: w.org.id,
        requestId: request.id,
        actor: SYSTEM
      }),
      refusedWith(/subject access request/)
    );
    const [count] = await db
      .select({ id: dataSubjectRequests.id })
      .from(dataSubjectRequests)
      .where(eq(dataSubjectRequests.organisationId, w.org.id));
    assert.ok(count);
  });
});

describe('who may handle requests', () => {
  it('is owners, privacy administrators and analysts, not auditors or approvers', () => {
    const org = (
      role:
        'privacy_admin' | 'privacy_analyst' | 'auditor' | 'approver' | 'owner'
    ) => can([{ role, scope: 'organisation' }], 'foi.handle');
    assert.deepEqual(
      [
        org('owner'),
        org('privacy_admin'),
        org('privacy_analyst'),
        org('auditor'),
        org('approver')
      ],
      [true, true, true, false, false]
    );
  });
});
