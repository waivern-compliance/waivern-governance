import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  entityAgreements,
  memberships,
  organisations,
  roleAssignments,
  termsAcceptances,
  users
} from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import {
  currentDocument,
  documentVersion,
  KEY_TERMS,
  LEGAL_DOCUMENT_KINDS,
  versionsOf
} from '@/lib/legal/documents';
import type { Grant } from '@/lib/rbac';
import {
  changeNoticeEmail,
  NOTICE_ACTION,
  notifyAgreementChanges
} from '@/services/agreement-notices';
import {
  acceptForEntity,
  acceptTerms,
  AgreementRefused,
  agreementStatus,
  hasAcceptedTerms,
  mayAcceptFor
} from '@/services/agreements';
import { addEntity, EntityRefused } from '@/services/entities';

after(() => pg.end());

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'agreements test'
};

const WHOLE_OWNER: Grant[] = [{ role: 'owner', scope: 'organisation' }];
const ADMIN: Grant[] = [{ role: 'privacy_admin', scope: 'organisation' }];

async function person(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `${label}-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: `${label} person`
    })
    .returning();
  return user;
}

async function world() {
  const [org] = await db
    .insert(organisations)
    .values({
      name: 'Agreement Group',
      slug: `agreement-group-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [main, other] = await db
    .insert(entities)
    .values([
      { organisationId: org.id, name: 'Group Holdings', isDefault: true },
      { organisationId: org.id, name: 'Group Trading', legalEntityRef: '0123' }
    ])
    .returning();
  const owner = await person('owner');
  const [membership] = await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: owner.id })
    .returning();
  await db.insert(roleAssignments).values({
    membershipId: membership.id,
    role: 'owner',
    scope: 'organisation'
  });
  return { org, main, other, owner };
}

function signed(over: Partial<Parameters<typeof acceptForEntity>[0]> = {}) {
  const terms = currentDocument('terms');
  const dpa = currentDocument('dpa');
  return {
    acceptTerms: true,
    acceptDpa: true,
    confirmAuthority: true,
    signatoryName: 'Ada Owner',
    signatoryPosition: 'Director',
    termsVersion: terms.version,
    dpaVersion: dpa.version,
    ipAddress: '203.0.113.7',
    userAgent: 'test browser',
    ...over
  };
}

/** Drizzle wraps the database's refusal; the reason is in its cause. */
function refusedBy(pattern: RegExp) {
  return (error: unknown) => {
    const cause = (error as { cause?: { message?: string } }).cause;
    return pattern.test(cause?.message ?? String(error));
  };
}

function plain(markdown: string) {
  return markdown.replace(/\*/g, '');
}

describe('the documents', () => {
  it('fingerprints every version by its exact text', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      for (const doc of versionsOf(kind)) {
        assert.equal(
          doc.sha256,
          createHash('sha256').update(doc.body, 'utf8').digest('hex')
        );
        assert.equal(documentVersion(kind, doc.version), doc);
      }
      assert.equal(currentDocument(kind), versionsOf(kind).at(-1));
    }
  });

  it('publishes no drafting notes', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      for (const doc of versionsOf(kind)) {
        assert.doesNotMatch(doc.body, /drafting note|not for publication/i);
      }
    }
  });

  it('summarises the key terms the terms actually contain', () => {
    const terms = plain(currentDocument('terms').body);
    // The cap stated above the boxes must be the cap in the clause.
    const cap = /limited to (£\d[\d,]*\d)/.exec(terms)?.[1];
    assert.ok(cap, 'the terms state a liability cap');
    assert.ok(
      KEY_TERMS.some((t) => t.text.includes(cap)),
      `the key terms state the cap of ${cap}`
    );
    for (const t of KEY_TERMS) {
      const first = t.clause.split('-')[0];
      assert.match(
        terms,
        new RegExp(`(^|\\n)(## )?${first.replace('.', '\\.')}[ .]`),
        `clause ${first} exists`
      );
    }
  });
});

describe('accepting the terms personally', () => {
  it('is outstanding until accepted, and records the version and digest', async () => {
    const user = await person('reader');
    const terms = currentDocument('terms');
    assert.equal(await hasAcceptedTerms(user.id), false);
    const row = await acceptTerms({
      userId: user.id,
      email: user.email.toUpperCase(),
      name: user.name,
      accepted: true,
      termsVersion: terms.version,
      ipAddress: '198.51.100.1',
      userAgent: 'test browser'
    });
    assert.equal(row.termsVersion, terms.version);
    assert.equal(row.termsSha256, terms.sha256);
    assert.equal(row.email, user.email);
    assert.equal(await hasAcceptedTerms(user.id), true);
  });

  it('refuses an unticked box, and a version that was not the one on screen', async () => {
    const user = await person('hasty');
    const terms = currentDocument('terms');
    await assert.rejects(
      acceptTerms({
        userId: user.id,
        email: user.email,
        name: null,
        accepted: false,
        termsVersion: terms.version
      }),
      AgreementRefused
    );
    await assert.rejects(
      acceptTerms({
        userId: user.id,
        email: user.email,
        name: null,
        accepted: true,
        termsVersion: '2020-01-01'
      }),
      /changed while this page was open/
    );
    assert.equal(await hasAcceptedTerms(user.id), false);
  });
});

describe('who may bind an entity', () => {
  it('is an owner of the whole organisation or of that entity', () => {
    const entityId = crypto.randomUUID();
    assert.equal(mayAcceptFor(WHOLE_OWNER, entityId), true);
    assert.equal(
      mayAcceptFor([{ role: 'owner', scope: 'entity', entityId }], entityId),
      true
    );
    assert.equal(
      mayAcceptFor(
        [{ role: 'owner', scope: 'entity', entityId: crypto.randomUUID() }],
        entityId
      ),
      false,
      'an owner of another entity'
    );
    assert.equal(mayAcceptFor(ADMIN, entityId), false, 'a privacy admin');
  });
});

describe("an entity's acceptance", () => {
  it('holds back somebody across the organisation until every entity has accepted', async () => {
    const w = await world();
    const reader = await person('member');
    const before = await agreementStatus({
      userId: reader.id,
      organisationId: w.org.id,
      grants: ADMIN
    });
    assert.equal(before.clear, false);
    assert.deepEqual(
      before.pendingEntities.map((e) => [e.name, e.mayAccept]),
      [
        ['Group Holdings', false],
        ['Group Trading', false]
      ]
    );
    assert.deepEqual(
      before.pendingEntities[0].owners.map((o) => o.email),
      [w.owner.email],
      'names the owner to ask'
    );

    for (const entity of [w.main, w.other]) {
      await acceptForEntity({
        ...signed(),
        organisationId: w.org.id,
        entityId: entity.id,
        grants: WHOLE_OWNER,
        user: { id: w.owner.id, email: w.owner.email },
        actor: SYSTEM
      });
    }
    await acceptTerms({
      userId: reader.id,
      email: reader.email,
      name: reader.name,
      accepted: true,
      termsVersion: currentDocument('terms').version
    });
    const afterwards = await agreementStatus({
      userId: reader.id,
      organisationId: w.org.id,
      grants: ADMIN
    });
    assert.deepEqual(afterwards.pendingEntities, []);
    assert.equal(afterwards.clear, true);
  });

  it('holds back somebody confined to one entity only for that entity', async () => {
    const w = await world();
    const grants: Grant[] = [
      { role: 'contributor', scope: 'entity', entityId: w.other.id }
    ];
    const status = await agreementStatus({
      userId: w.owner.id,
      organisationId: w.org.id,
      grants
    });
    assert.deepEqual(
      status.pendingEntities.map((e) => e.name),
      ['Group Trading']
    );
  });

  it('records what was accepted, by whom, in what capacity, and audits it', async () => {
    const w = await world();
    const row = await acceptForEntity({
      ...signed({ signatoryName: '  Ada   Owner ' }),
      organisationId: w.org.id,
      entityId: w.other.id,
      grants: WHOLE_OWNER,
      user: { id: w.owner.id, email: w.owner.email },
      actor: SYSTEM
    });
    const terms = currentDocument('terms');
    const dpa = currentDocument('dpa');
    assert.equal(row.entityName, 'Group Trading');
    assert.equal(row.legalEntityRef, '0123');
    assert.equal(row.termsSha256, terms.sha256);
    assert.equal(row.dpaSha256, dpa.sha256);
    assert.equal(row.acceptedByName, 'Ada Owner');
    assert.equal(row.acceptedByPosition, 'Director');
    assert.equal(row.authorityConfirmed, true);
    assert.equal(row.ipAddress, '203.0.113.7');

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectId, w.other.id));
    assert.equal(event.action, 'entity.agreements_accepted');
    assert.equal(
      (event.after as Record<string, unknown>).dpaSha256,
      dpa.sha256
    );
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
  });

  it('refuses anybody but an owner, and any box left unticked', async () => {
    const w = await world();
    const base = {
      organisationId: w.org.id,
      entityId: w.main.id,
      user: { id: w.owner.id, email: w.owner.email },
      actor: SYSTEM
    };
    await assert.rejects(
      acceptForEntity({ ...signed(), ...base, grants: ADMIN }),
      /Only an owner/
    );
    for (const box of ['acceptTerms', 'acceptDpa', 'confirmAuthority']) {
      await assert.rejects(
        acceptForEntity({
          ...signed({ [box]: false }),
          ...base,
          grants: WHOLE_OWNER
        }),
        AgreementRefused,
        box
      );
    }
    await assert.rejects(
      acceptForEntity({
        ...signed({ dpaVersion: '2020-01-01' }),
        ...base,
        grants: WHOLE_OWNER
      }),
      /changed while this page was open/
    );
    await assert.rejects(
      acceptForEntity({
        ...signed({ signatoryPosition: ' ' }),
        ...base,
        grants: WHOLE_OWNER
      }),
      /Give your position/
    );
    const rows = await db
      .select()
      .from(entityAgreements)
      .where(eq(entityAgreements.entityId, w.main.id));
    assert.equal(rows.length, 0);
  });
});

describe('accepting twice', () => {
  it('keeps the first acceptance when a person accepts the terms again', async () => {
    const user = await person('twice');
    const accept = () =>
      acceptTerms({
        userId: user.id,
        email: user.email,
        name: user.name,
        accepted: true,
        termsVersion: currentDocument('terms').version
      });
    const [first, second] = await Promise.all([accept(), accept()]);
    assert.equal(second.id, first.id);
    const rows = await db
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, user.id));
    assert.equal(rows.length, 1);
  });

  it('records and audits one acceptance when two owners accept an entity at once', async () => {
    const w = await world();
    const accept = () =>
      acceptForEntity({
        ...signed(),
        organisationId: w.org.id,
        entityId: w.main.id,
        grants: WHOLE_OWNER,
        user: { id: w.owner.id, email: w.owner.email },
        actor: SYSTEM
      });
    const [first, second] = await Promise.all([accept(), accept()]);
    assert.equal(second.id, first.id);
    const rows = await db
      .select()
      .from(entityAgreements)
      .where(eq(entityAgreements.entityId, w.main.id));
    assert.equal(rows.length, 1);
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectId, w.main.id));
    assert.equal(events.length, 1);
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
  });
});

describe('the record of acceptances', () => {
  it('can be added to but never changed or removed', async () => {
    const w = await world();
    const row = await acceptForEntity({
      ...signed(),
      organisationId: w.org.id,
      entityId: w.main.id,
      grants: WHOLE_OWNER,
      user: { id: w.owner.id, email: w.owner.email },
      actor: SYSTEM
    });
    await assert.rejects(
      db
        .update(entityAgreements)
        .set({ acceptedByName: 'Somebody else' })
        .where(eq(entityAgreements.id, row.id)),
      refusedBy(/append-only/)
    );
    await assert.rejects(
      db.delete(entityAgreements).where(eq(entityAgreements.id, row.id)),
      refusedBy(/append-only/)
    );
    const [mine] = await db.select().from(termsAcceptances).limit(1);
    if (mine)
      await assert.rejects(
        db.execute(
          sql`update terms_acceptance set terms_version = 'x' where id = ${mine.id}`
        ),
        refusedBy(/append-only/)
      );
  });

  it('refuses an acceptance with no confirmation of authority, even written directly', async () => {
    const w = await world();
    const terms = currentDocument('terms');
    const dpa = currentDocument('dpa');
    await assert.rejects(
      db.insert(entityAgreements).values({
        organisationId: w.org.id,
        entityId: w.main.id,
        entityName: w.main.name,
        termsVersion: terms.version,
        termsSha256: terms.sha256,
        dpaVersion: dpa.version,
        dpaSha256: dpa.sha256,
        acceptedBy: w.owner.id,
        acceptedByEmail: w.owner.email,
        acceptedByName: 'Ada Owner',
        acceptedByPosition: 'Director',
        authorityConfirmed: false
      }),
      refusedBy(/authority_confirmed/)
    );
  });
});

describe('adding an entity where agreement is required', () => {
  it('adds it and its agreement together', async () => {
    const w = await world();
    const created = await addEntity({
      organisationId: w.org.id,
      name: 'Group Services',
      actor: SYSTEM,
      agreementRequired: true,
      agreement: {
        ...signed(),
        user: { id: w.owner.id, email: w.owner.email }
      }
    });
    const rows = await db
      .select()
      .from(entityAgreements)
      .where(eq(entityAgreements.entityId, created.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entityName, 'Group Services');
  });

  it('adds nothing when the agreement is missing or refused', async () => {
    const w = await world();
    await assert.rejects(
      addEntity({
        organisationId: w.org.id,
        name: 'Group Ventures',
        actor: SYSTEM,
        agreementRequired: true
      }),
      EntityRefused
    );
    await assert.rejects(
      addEntity({
        organisationId: w.org.id,
        name: 'Group Ventures',
        actor: SYSTEM,
        agreementRequired: true,
        agreement: {
          ...signed({ confirmAuthority: false }),
          user: { id: w.owner.id, email: w.owner.email }
        }
      }),
      AgreementRefused
    );
    const named = await db
      .select()
      .from(entities)
      .where(eq(entities.organisationId, w.org.id));
    assert.deepEqual(
      named.map((e) => e.name).sort(),
      ['Group Holdings', 'Group Trading'],
      'no entity was created without its agreement'
    );
  });
});

describe('when the documents change', () => {
  /** An acceptance of an earlier version, as one made before a change would be. */
  async function acceptedEarlier(w: Awaited<ReturnType<typeof world>>) {
    for (const entity of [w.main, w.other])
      await db.insert(entityAgreements).values({
        organisationId: w.org.id,
        entityId: entity.id,
        entityName: entity.name,
        termsVersion: '2026-01-01',
        termsSha256: 'a'.repeat(64),
        dpaVersion: currentDocument('dpa').version,
        dpaSha256: currentDocument('dpa').sha256,
        acceptedBy: w.owner.id,
        acceptedByEmail: w.owner.email,
        acceptedByName: 'Ada Owner',
        acceptedByPosition: 'Director',
        authorityConfirmed: true
      });
    await db.insert(termsAcceptances).values({
      userId: w.owner.id,
      email: w.owner.email,
      termsVersion: '2026-01-01',
      termsSha256: 'a'.repeat(64)
    });
  }

  const config = { apiKey: 're_test', from: 'notices@example.com' };
  function fakeResend() {
    const sent: Array<{ to: string[]; subject: string; text: string }> = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: `msg-${sent.length}` }), {
        status: 200
      });
    }) as unknown as typeof globalThis.fetch;
    return { sent, fetch };
  }

  it('lets nobody be held back by an acceptance of an earlier version', async () => {
    const w = await world();
    await acceptedEarlier(w);
    assert.equal(await hasAcceptedTerms(w.owner.id), true);
    const status = await agreementStatus({
      userId: w.owner.id,
      organisationId: w.org.id,
      grants: WHOLE_OWNER
    });
    assert.equal(status.clear, true);
  });

  it('emails the owners once about the change, and audits the notice', async () => {
    const w = await world();
    await acceptedEarlier(w);
    const resend = fakeResend();
    assert.equal(
      await notifyAgreementChanges(w.org.id, { config, fetch: resend.fetch }),
      1,
      'only the terms changed'
    );
    assert.equal(resend.sent.length, 1);
    assert.deepEqual(resend.sent[0].to, [w.owner.email.toLowerCase()]);
    assert.match(resend.sent[0].subject, /Terms of Service changed/);
    assert.match(resend.sent[0].text, /within 30 days/);

    assert.equal(
      await notifyAgreementChanges(w.org.id, { config, fetch: resend.fetch }),
      0,
      'once'
    );
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, NOTICE_ACTION))
      .then((rows) => rows.filter((r) => r.organisationId === w.org.id));
    const terms = currentDocument('terms');
    assert.deepEqual(
      { kind: event.after?.kind, version: event.after?.version },
      { kind: 'terms', version: terms.version }
    );
    assert.equal(event.after?.sha256, terms.sha256);
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
  });

  it('sends nothing to an organisation that accepted the current versions', async () => {
    const w = await world();
    for (const entityId of [w.main.id, w.other.id])
      await acceptForEntity({
        ...signed(),
        organisationId: w.org.id,
        entityId,
        grants: WHOLE_OWNER,
        user: w.owner,
        actor: SYSTEM
      });
    const resend = fakeResend();
    assert.equal(
      await notifyAgreementChanges(w.org.id, { config, fetch: resend.fetch }),
      0
    );
    assert.equal(resend.sent.length, 0);
  });

  it('records nothing when the email could not be sent, so it is tried again', async () => {
    const w = await world();
    await acceptedEarlier(w);
    const failing = (async () =>
      new Response('{}', { status: 500 })) as unknown as typeof fetch;
    assert.equal(
      await notifyAgreementChanges(w.org.id, { config, fetch: failing }),
      0
    );
    assert.equal(await notifyAgreementChanges(w.org.id, { config: null }), 0);
    const resend = fakeResend();
    assert.equal(
      await notifyAgreementChanges(w.org.id, { config, fetch: resend.fetch }),
      1
    );
  });

  it('says what changed, links the new version and gives the right to end', () => {
    const email = changeNoticeEmail(
      { ...currentDocument('dpa'), changes: 'A new sub-processor.' },
      'Agreement Group',
      'https://govern.example'
    );
    assert.match(email.text, /A new sub-processor\./);
    assert.match(
      email.text,
      new RegExp(
        `https://govern\\.example/legal/dpa/${currentDocument('dpa').version}`
      )
    );
    assert.match(email.text, /info@waivern\.com within 30 days/);
  });

  it('says what changed in every version after the first', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS)
      for (const doc of versionsOf(kind).slice(1))
        assert.ok(doc.changes, `${kind} ${doc.version} has no summary`);
  });
});
