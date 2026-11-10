import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  informationRequests,
  organisations,
  tasks
} from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import { mayConfigureInformationRequests } from '@/lib/rbac';
import { RequestRefused } from '@/services/data-subject-requests';
import {
  intakeLinksFor,
  issueIntakeLink,
  openIntakeLink,
  PER_ADDRESS_PER_HOUR,
  revokeIntakeLink,
  setIntakeLinkComplaints,
  startedToken,
  submitIntake
} from '@/services/dsr-intake';
import { setFreedomOfInformation } from '@/services/entities';
import { submitInformationRequestIntake } from '@/services/foi-intake';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'foi intake test'
};

after(() => pg.end());

async function world(label: string, act: 'foia' | 'foisa' | null = 'foia') {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `FOI intake ${label}`,
      slug: `foi-intake-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Council', isDefault: true })
    .returning();
  if (act)
    await setFreedomOfInformation({
      organisationId: org.id,
      entityId: entity.id,
      act,
      timeProfile: 'standard',
      actor: SYSTEM
    });
  return { org, entity };
}

type World = Awaited<ReturnType<typeof world>>;

function foiForm(w: World) {
  return issueIntakeLink({
    organisationId: w.org.id,
    entityId: w.entity.id,
    label: 'FOI page',
    kind: 'foi',
    actor: SYSTEM
  });
}

const tenSecondsAgo = (slug: string) =>
  startedToken(slug, new Date(Date.now() - 10_000));

function send(
  slug: string,
  over: Partial<Parameters<typeof submitInformationRequestIntake>[0]> = {}
) {
  return submitInformationRequestIntake({
    slug,
    started: tenSecondsAgo(slug),
    address: '203.0.113.9',
    requesterName: 'Sam Citizen',
    correspondenceAddress: 'sam@example.org',
    description: 'The council’s spending on consultants in 2025.',
    environmental: 'no',
    ...over
  });
}

describe('publishing a freedom of information form', () => {
  it('is only for an entity an FOI Act applies to, and never takes complaints', async () => {
    const none = await world('none', null);
    await assert.rejects(foiForm(none), RequestRefused);

    const w = await world('publish');
    const link = await foiForm(w);
    assert.equal(link.kind, 'foi');
    assert.equal(link.takesComplaints, false);
    const opened = await openIntakeLink(link.slug);
    assert.equal(opened?.kind, 'foi');
    assert.equal(opened?.foiAct, 'foia');
    await assert.rejects(
      setIntakeLinkComplaints({
        linkId: link.id,
        organisationId: w.org.id,
        takesComplaints: true,
        actor: SYSTEM
      }),
      RequestRefused
    );
  });

  it('keeps each register to its own forms, and signposts between them', async () => {
    const w = await world('both');
    const foi = await foiForm(w);
    const dp = await issueIntakeLink({
      organisationId: w.org.id,
      entityId: w.entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    assert.deepEqual(
      (await intakeLinksFor(w.org.id, null, 'foi')).map((r) => r.link.id),
      [foi.id]
    );
    assert.deepEqual(
      (await intakeLinksFor(w.org.id, null)).map((r) => r.link.id),
      [dp.id]
    );
    assert.equal((await openIntakeLink(foi.slug))?.otherFormSlug, dp.slug);
    assert.equal((await openIntakeLink(dp.slug))?.otherFormSlug, foi.slug);

    // The data protection register cannot withdraw an FOI form, nor the other way.
    await assert.rejects(
      revokeIntakeLink({
        linkId: foi.id,
        organisationId: w.org.id,
        actor: SYSTEM
      }),
      RequestRefused
    );
    await revokeIntakeLink({
      linkId: foi.id,
      organisationId: w.org.id,
      kind: 'foi',
      actor: SYSTEM
    });
    assert.equal(await openIntakeLink(foi.slug), null);
    assert.equal((await openIntakeLink(dp.slug))?.otherFormSlug, null);
  });

  it('is for somebody who handles FOI and configures the whole organisation', () => {
    assert.equal(
      mayConfigureInformationRequests([
        { role: 'owner', scope: 'organisation' }
      ]),
      true
    );
    assert.equal(
      mayConfigureInformationRequests([
        { role: 'privacy_analyst', scope: 'organisation' }
      ]),
      false
    );
  });
});

describe('a request through the form', () => {
  it('records it with the twenty working days, raises a task, and keeps the requester out of the audit chain', async () => {
    const w = await world('submit');
    const link = await foiForm(w);
    const result = await send(link.slug);
    assert.ok(result.ok, JSON.stringify(result));
    assert.match(result.reference, /^FOI-\d{4}-0001$/);
    assert.match(result.dueWords, /by \d{1,2} \w+ \d{4} at the latest/);

    const [row] = await db
      .select()
      .from(informationRequests)
      .where(eq(informationRequests.organisationId, w.org.id));
    assert.equal(row.channel, 'web_form');
    assert.equal(row.intakeLinkId, link.id);
    assert.deepEqual(row.regimes, ['foia']);
    assert.equal(row.correspondenceAddress, 'sam@example.org');

    const [task] = await db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.organisationId, w.org.id), eq(tasks.type, 'foi_intake'))
      );
    assert.equal(task.subjectId, row.id);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, w.org.id));
    assert.doesNotMatch(JSON.stringify(events), /Sam Citizen|sam@example/);
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
    assert.equal((await openIntakeLink(link.slug)) !== null, true);
  });

  it('files environmental information under the environmental regulations', async () => {
    const w = await world('env', 'foisa');
    const link = await foiForm(w);
    await send(link.slug, { environmental: 'yes' });
    await send(link.slug, { environmental: 'some', address: '203.0.113.10' });
    const rows = await db
      .select({ regimes: informationRequests.regimes })
      .from(informationRequests)
      .where(eq(informationRequests.organisationId, w.org.id));
    assert.deepEqual(rows.map((r) => r.regimes).sort(), [
      ['eisr'],
      ['foisa', 'eisr']
    ]);
  });

  it('turns back a request for their own data, pointing to the data protection form', async () => {
    const w = await world('own');
    const link = await foiForm(w);
    const without = await send(link.slug, { aboutThemselves: true });
    assert.equal(without.ok, false);
    assert.match((without as { message: string }).message, /by email or post/);
    await issueIntakeLink({
      organisationId: w.org.id,
      entityId: w.entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    const withForm = await send(link.slug, { aboutThemselves: true });
    assert.match(
      (withForm as { message: string }).message,
      /data protection request form/
    );
    const rows = await db
      .select()
      .from(informationRequests)
      .where(eq(informationRequests.organisationId, w.org.id));
    assert.equal(rows.length, 0);
  });

  it('asks for what is missing, and turns away software', async () => {
    const w = await world('missing');
    const link = await foiForm(w);
    for (const [over, pattern] of [
      [{ requesterName: ' ' }, /real name/],
      [{ correspondenceAddress: '' }, /email or postal address/],
      [{ description: '' }, /Describe the information/],
      [{ trap: 'http://spam' }, /could not be sent/],
      [{ started: startedToken(link.slug) }, /very quickly/]
    ] as const) {
      const result = await send(link.slug, over);
      assert.equal(result.ok, false);
      assert.match((result as { message: string }).message, pattern);
    }
  });

  it('will not take one kind of request through the other kind of form', async () => {
    const w = await world('cross');
    const foi = await foiForm(w);
    const dp = await issueIntakeLink({
      organisationId: w.org.id,
      entityId: w.entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    const viaDp = await send(dp.slug);
    assert.equal(viaDp.ok, false);
    const viaFoi = await submitIntake({
      slug: foi.slug,
      started: tenSecondsAgo(foi.slug),
      address: '203.0.113.11',
      forSomeoneElse: false,
      requesterName: 'Jo Public',
      contact: 'jo@example.org',
      rights: ['access'],
      description: 'Everything about me.'
    });
    assert.equal(viaFoi.ok, false);
  });

  it('limits how often one address can submit', async () => {
    const w = await world('limit');
    const link = await foiForm(w);
    for (let i = 0; i < PER_ADDRESS_PER_HOUR; i++)
      assert.ok((await send(link.slug)).ok);
    const over = await send(link.slug);
    assert.equal(over.ok, false);
    assert.match((over as { message: string }).message, /Too many/);
  });
});
