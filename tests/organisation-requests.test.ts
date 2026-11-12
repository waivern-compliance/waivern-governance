import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { and, asc, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  memberships,
  organisations,
  retentionProfiles,
  roleAssignments,
  slaPolicies,
  templates,
  users,
  workflowDefinitions
} from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import { isEmailAddress } from '@/lib/email-address';
import { RETENTION_DEFAULTS, slugFor } from '@/lib/organisation/defaults';
import { isPlatformAdmin, requestsOpen } from '@/lib/platform';
import { offeredTo, SYSTEM_TEMPLATES } from '@/lib/templates/library';
import { DEFAULT_SLA, DEFAULT_WORKFLOWS } from '@/lib/workflow/defaults';
import {
  approveRequest,
  createOrganisation,
  declineRequest,
  DIRECT,
  requestOrganisation,
  requestQueue,
  RequestRefused,
  requestsBy
} from '@/services/organisation-requests';

async function person(label: string) {
  const [u] = await db
    .insert(users)
    .values({
      email: `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`
    })
    .returning();
  return u;
}

const ask = (
  u: { id: string; email: string },
  organisationName: string,
  entityName = ''
) =>
  requestOrganisation({
    userId: u.id,
    email: u.email,
    organisationName,
    entityName
  });

after(() => pg.end());

describe('who runs the platform', () => {
  it('is whoever PLATFORM_ADMINS names, and nobody otherwise', () => {
    const before = process.env.PLATFORM_ADMINS;
    try {
      delete process.env.PLATFORM_ADMINS;
      assert.equal(requestsOpen(), false);
      assert.equal(isPlatformAdmin('ops@waivern.com'), false);
      process.env.PLATFORM_ADMINS = ' Ops@Waivern.com , second@waivern.com';
      assert.equal(requestsOpen(), true);
      assert.equal(isPlatformAdmin('ops@waivern.com'), true);
      assert.equal(isPlatformAdmin('someone@example.test'), false);
    } finally {
      if (before === undefined) delete process.env.PLATFORM_ADMINS;
      else process.env.PLATFORM_ADMINS = before;
    }
  });

  it('makes a short reference from a name', () => {
    assert.equal(
      slugFor('Department for Example & Co.'),
      'department-for-example-co'
    );
  });
});

describe('asking for an organisation', () => {
  it('needs a name, and allows one request in the queue at a time', async () => {
    const u = await person('asker');
    await assert.rejects(ask(u, '   '), RequestRefused);
    await ask(u, 'Example Department');
    await assert.rejects(
      ask(u, 'Another One'),
      /already have a request waiting/
    );
  });

  it('can ask again once declined, and a decline says why', async () => {
    const u = await person('declined');
    const first = await ask(u, 'Not Yet Ltd');
    await assert.rejects(
      declineRequest({
        requestId: first.id,
        decidedByEmail: 'ops@waivern.com',
        note: ' '
      }),
      /Say why/
    );
    await declineRequest({
      requestId: first.id,
      decidedByEmail: 'ops@waivern.com',
      note: 'Talk to sales first.'
    });
    const [latest] = await requestsBy(u.id);
    assert.equal(latest.status, 'declined');
    assert.equal(latest.decisionNote, 'Talk to sales first.');
    await ask(u, 'Not Yet Ltd');
  });
});

describe('approving', () => {
  it('sets up everything an organisation starts with, with its requester as owner', async () => {
    const u = await person('owner');
    const request = await ask(u, 'Approved Agency', 'Approved Agency Limited');
    const { organisation, request: decided } = await approveRequest({
      requestId: request.id,
      decidedByEmail: 'ops@waivern.com'
    });
    assert.equal(decided.status, 'approved');
    assert.equal(decided.createdOrganisationId, organisation.id);

    const org = organisation.id;
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.organisationId, org));
    assert.equal(entity.name, 'Approved Agency Limited');
    assert.equal(entity.isDefault, true);

    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.organisationId, org), eq(memberships.userId, u.id))
      );
    const grants = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.membershipId, membership.id));
    assert.deepEqual(
      grants.map((g) => g.role),
      ['owner']
    );

    assert.equal(
      (
        await db
          .select()
          .from(templates)
          .where(eq(templates.organisationId, org))
      ).length,
      SYSTEM_TEMPLATES.filter((t) =>
        offeredTo(t, {
          aiFramework: 'uk_dsit',
          competentAuthority: false,
          ukLaw: true,
          irishProvider: false
        })
      ).length,
      'everything for the UK framework, which it starts on, bar the Part 3 DPIA and the Irish provider checklist'
    );
    assert.equal(
      (
        await db
          .select()
          .from(workflowDefinitions)
          .where(eq(workflowDefinitions.organisationId, org))
      ).length,
      DEFAULT_WORKFLOWS.length
    );
    assert.equal(
      (
        await db
          .select()
          .from(slaPolicies)
          .where(eq(slaPolicies.organisationId, org))
      ).length,
      DEFAULT_SLA.length
    );
    assert.equal(
      (
        await db
          .select()
          .from(retentionProfiles)
          .where(eq(retentionProfiles.organisationId, org))
      ).length,
      RETENTION_DEFAULTS.length
    );

    const [first] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, org))
      .orderBy(asc(auditEvents.seq))
      .limit(1);
    assert.equal(first.action, 'organisation.created');
    assert.equal((await verifyAuditChain(org)).ok, true);

    await assert.rejects(
      approveRequest({
        requestId: request.id,
        decidedByEmail: 'ops@waivern.com'
      }),
      /already been approved/
    );
  });

  it('gives two organisations of the same name different references', async () => {
    const a = await approveRequest({
      requestId: (await ask(await person('s1'), 'Same Name Council')).id,
      decidedByEmail: 'ops@waivern.com'
    });
    const b = await approveRequest({
      requestId: (await ask(await person('s2'), 'Same Name Council')).id,
      decidedByEmail: 'ops@waivern.com'
    });
    assert.notEqual(a.organisation.slug, b.organisation.slug);
    const both = await db
      .select()
      .from(organisations)
      .where(eq(organisations.name, 'Same Name Council'));
    assert.ok(both.length >= 2);
  });
});

describe('creating one directly', () => {
  const membersOf = (organisationId: string) =>
    db
      .select({
        email: users.email,
        role: roleAssignments.role,
        scope: roleAssignments.scope
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(
        roleAssignments,
        eq(roleAssignments.membershipId, memberships.id)
      )
      .where(eq(memberships.organisationId, organisationId));

  it('makes the operator its owner, with everything an organisation starts with', async () => {
    const operator = await person('operator');
    const org = await createOrganisation({
      organisationName: `Waivern Test Client ${crypto.randomUUID().slice(0, 8)}`,
      entityName: '',
      ownerEmail: operator.email.toUpperCase(),
      createdByEmail: operator.email
    });
    assert.deepEqual(await membersOf(org.id), [
      { email: operator.email, role: 'owner', scope: 'organisation' }
    ]);
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.organisationId, org.id));
    assert.equal(entity.name, org.name);
    assert.equal(entity.isDefault, true);
    const shipped = await db
      .select()
      .from(templates)
      .where(eq(templates.organisationId, org.id));
    assert.ok(shipped.length > 0);
    const [created] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'organisation.created')
        )
      );
    assert.equal(created.actorLabel, `Waivern: ${operator.email}`);
    assert.deepEqual(
      (created.after as { createdDirectly: boolean }).createdDirectly,
      true
    );
    assert.equal((await verifyAuditChain(org.id)).ok, true);
  });

  it('can name somebody with no account yet, who becomes owner on signing in', async () => {
    const operator = await person('operator');
    const contact = `contact-${crypto.randomUUID().slice(0, 8)}@client.example`;
    const org = await createOrganisation({
      organisationName: `New Client ${crypto.randomUUID().slice(0, 8)}`,
      entityName: 'New Client Ltd',
      ownerEmail: contact,
      createdByEmail: operator.email
    });
    assert.deepEqual(await membersOf(org.id), [
      { email: contact, role: 'owner', scope: 'organisation' }
    ]);
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.organisationId, org.id));
    assert.equal(entity.name, 'New Client Ltd');
  });

  it('refuses a missing name or owner, and leaves nothing behind', async () => {
    const operator = await person('operator');
    await assert.rejects(
      createOrganisation({
        organisationName: ' ',
        entityName: '',
        ownerEmail: operator.email,
        createdByEmail: operator.email
      }),
      RequestRefused
    );
    const name = `Nobody ${crypto.randomUUID().slice(0, 8)}`;
    await assert.rejects(
      createOrganisation({
        organisationName: name,
        entityName: '',
        ownerEmail: 'not an address',
        createdByEmail: operator.email
      }),
      RequestRefused
    );
    assert.equal(
      (
        await db
          .select()
          .from(organisations)
          .where(eq(organisations.name, name))
      ).length,
      0
    );
  });
});

describe('creating one directly, kept honest', () => {
  it('is listed on the platform page, by whom and for whom', async () => {
    const operator = await person('operator');
    const name = `Listed ${crypto.randomUUID().slice(0, 8)}`;
    const org = await createOrganisation({
      organisationName: name,
      entityName: '',
      ownerEmail:
        'Owner-' + crypto.randomUUID().slice(0, 8) + '@client.example',
      createdByEmail: operator.email.toUpperCase()
    });
    const { decided } = await requestQueue();
    const row = decided.find((r) => r.createdOrganisationId === org.id);
    assert.equal(row?.decisionNote, DIRECT);
    assert.equal(row?.status, 'approved');
    assert.equal(row?.decidedByEmail, operator.email);
    assert.match(row?.requestedByEmail ?? '', /^owner-.*@client\.example$/);
    const [created] = await db
      .select({ label: auditEvents.actorLabel })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'organisation.created')
        )
      );
    // Lowercased, so one operator is one actor in every audit filter.
    assert.equal(created.label, `Waivern: ${operator.email}`);
  });

  it('will not make a second organisation of the same name unless told to', async () => {
    const operator = await person('operator');
    const name = `Twice ${crypto.randomUUID().slice(0, 8)}`;
    const make = (sameNameConfirmed = false) =>
      createOrganisation({
        organisationName: name,
        entityName: '',
        ownerEmail: operator.email,
        createdByEmail: operator.email,
        sameNameConfirmed
      });
    await make();
    await assert.rejects(
      createOrganisation({
        organisationName: name.toUpperCase(),
        entityName: '',
        ownerEmail: operator.email,
        createdByEmail: operator.email
      }),
      (e: unknown) =>
        e instanceof RequestRefused && /already exists/.test(e.message)
    );
    await make(true);
    assert.equal(
      (
        await db
          .select()
          .from(organisations)
          .where(eq(organisations.name, name))
      ).length,
      2
    );
  });

  it('removes an account it made when setting up fails', async () => {
    const operator = await person('operator');
    const contact = `orphan-${crypto.randomUUID().slice(0, 8)}@client.example`;
    // Fail the setup after the owner's account is made, as a failing
    // installer would.
    await pg.unsafe(`
      create or replace function test_fail_owner_grant() returns trigger
      language plpgsql security definer as $$
      begin
        if exists (
          select 1 from membership m join organisation o on o.id = m.organisation_id
          where m.id = new.membership_id and o.name like 'Fails setup%'
        ) then raise exception 'setup failed on purpose'; end if;
        return new;
      end $$;
      create trigger test_fail_owner_grant before insert on role_assignment
        for each row execute function test_fail_owner_grant();
    `);
    try {
      await assert.rejects(
        createOrganisation({
          organisationName: `Fails setup ${crypto.randomUUID().slice(0, 8)}`,
          entityName: '',
          ownerEmail: contact,
          createdByEmail: operator.email
        }),
        (e: unknown) =>
          /setup failed on purpose/.test(
            String((e as { cause?: Error }).cause?.message ?? e)
          )
      );
    } finally {
      await pg.unsafe(`
        drop trigger if exists test_fail_owner_grant on role_assignment;
        drop function if exists test_fail_owner_grant();
      `);
    }
    assert.equal(
      (await db.select().from(users).where(eq(users.email, contact))).length,
      0
    );
  });

  it('checks addresses one way everywhere', () => {
    assert.equal(isEmailAddress('jo@client.example'), true);
    assert.equal(isEmailAddress(' jo@client.example '), true);
    for (const bad of ['jo', 'jo@intranet', '@client.example', 'jo @x.org'])
      assert.equal(isEmailAddress(bad), false, bad);
  });

  it('lets only a platform operator use any platform action', () => {
    const source = readFileSync(
      new URL('../src/app/platform/actions.ts', import.meta.url),
      'utf8'
    );
    const actions = [
      ...source.matchAll(
        /export async function (\w+)\([^)]*\)[^{]*\{([^]*?)\n\}/g
      )
    ];
    assert.ok(actions.length >= 4);
    for (const [, name, body] of actions)
      assert.match(
        body.trimStart(),
        /^const email = await operator\(\);/,
        `${name} must check the operator first`
      );
  });
});
