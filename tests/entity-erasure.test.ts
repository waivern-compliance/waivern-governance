import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  entityAgreements,
  entityErasures,
  integrationConnections,
  memberships,
  notifications,
  organisations,
  roleAssignments,
  users
} from '@/db/schema';
import { audit, verifyAuditChain } from '@/lib/audit';
import {
  AGREE_FIRST,
  erasureDoneEmail,
  erasureLinkEmail,
  IRREVOCABLE
} from '@/lib/email/entity-erasure';
import type { Email } from '@/lib/email/resend';
import { currentDocument } from '@/lib/legal/documents';
import { mayDeleteEntity, type Grant } from '@/lib/rbac';
import * as aiAssurance from '@/services/ai-assurance';
import * as aiIncidents from '@/services/ai-incidents';
import * as aiLifecycle from '@/services/ai-lifecycle';
import * as aiRegister from '@/services/ai-register';
import * as assessmentsSvc from '@/services/assessments';
import * as atrs from '@/services/atrs';
import * as breachesSvc from '@/services/breaches';
import * as collaboration from '@/services/collaboration';
import * as complaintsSvc from '@/services/complaints';
import * as connections from '@/services/connections';
import * as contributorLinks from '@/services/contributor-links';
import * as dsr from '@/services/data-subject-requests';
import * as documentsSvc from '@/services/documents';
import * as dsrIntake from '@/services/dsr-intake';
import { addEntity } from '@/services/entities';
import {
  confirmEntityErasure,
  confirms,
  deletedEntities,
  ERASED_BY_ENTITY,
  erasureBlockers,
  erasureForToken,
  KEPT_WITH_ENTITY_ID,
  previewErasure,
  requestEntityErasure
} from '@/services/entity-erasure';
import * as marketingSvc from '@/services/marketing';
import * as risksSvc from '@/services/risks';
import * as ropa from '@/services/ropa';
import * as sharingSvc from '@/services/sharing-agreements';
import * as inventory from '@/services/storage-inventory';
import * as templatesSvc from '@/services/templates';
import * as thirdParty from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'erasure test'
};
const DAY = 86_400_000;
const PDF = Buffer.from('%PDF-1.7\nerasure test\n');

async function person(
  orgId: string,
  label: string,
  grant: { role: 'owner' | 'privacy_admin'; entityId?: string }
) {
  const [user] = await db
    .insert(users)
    .values({
      email: `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`
    })
    .returning();
  const [m] = await db
    .insert(memberships)
    .values({ organisationId: orgId, userId: user.id })
    .returning();
  await db.insert(roleAssignments).values({
    membershipId: m.id,
    role: grant.role,
    scope: grant.entityId ? 'entity' : 'organisation',
    entityId: grant.entityId ?? null
  });
  return {
    user,
    actor: {
      actorKind: 'user' as const,
      actorUserId: user.id,
      actorLabel: user.email
    }
  };
}

/** Sends nothing, and keeps what would have been sent. */
function outbox() {
  const sent: Email[] = [];
  return {
    sent,
    send: async (email: Email) => {
      sent.push(email);
      return { sent: true as const, messageId: `m${sent.length}` };
    },
    lastToken: () =>
      /delete-entity\/(\S+)/.exec(sent.at(-1)?.text ?? '')?.[1] ?? ''
  };
}

async function world() {
  const [org] = await db
    .insert(organisations)
    .values({
      name: 'Erasure Group',
      slug: `erasure-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [main] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true })
    .returning();
  const owner = await person(org.id, 'owner', { role: 'owner' });
  const otherOwner = await person(org.id, 'other-owner', { role: 'owner' });
  const terms = currentDocument('terms');
  const dpa = currentDocument('dpa');
  const gone = await addEntity({
    organisationId: org.id,
    name: 'Gone Limited',
    legalEntityRef: '01234567',
    actor: owner.actor,
    agreementRequired: true,
    agreement: {
      acceptTerms: true,
      acceptDpa: true,
      confirmAuthority: true,
      signatoryName: 'Ada Owner',
      signatoryPosition: 'Director',
      termsVersion: terms.version,
      dpaVersion: dpa.version,
      user: { id: owner.user.id, email: owner.user.email }
    }
  });
  return { org, main, gone, owner, otherOwner };
}

/** Something in most registers, for the entity. */
async function populate(orgId: string, entityId: string) {
  await templatesSvc.installShippedTemplates({
    organisationId: orgId,
    actor: SYSTEM
  });
  const [dpia] = await templatesSvc.availableTemplates(orgId, 'dpia');
  const risk = await risksSvc.createRisk({
    organisationId: orgId,
    entityId,
    title: 'A risk',
    description: 'About Jane Example.',
    likelihood: 3,
    impact: 3,
    actor: SYSTEM
  });
  await risksSvc.addMitigation({
    riskId: risk.id,
    organisationId: orgId,
    description: 'A control',
    actor: SYSTEM
  });
  await risksSvc.setResidual({
    riskId: risk.id,
    organisationId: orgId,
    likelihood: 1,
    impact: 1,
    actor: SYSTEM
  });
  await risksSvc.acceptRisk({
    riskId: risk.id,
    organisationId: orgId,
    rationale: 'Low.',
    expiresAt: new Date(Date.now() + 90 * DAY),
    actor: SYSTEM
  });
  const supplier = await thirdParty.createSupplier({
    organisationId: orgId,
    name: `Supplier ${crypto.randomUUID().slice(0, 6)}`,
    actor: SYSTEM
  });
  const activity = await ropa.createActivity({
    organisationId: orgId,
    entityId,
    name: 'Payroll',
    actor: SYSTEM
  });
  const breach = await breachesSvc.recordBreach({
    organisationId: orgId,
    entityId,
    title: 'A breach',
    description: 'Jane Example was emailed someone else’s payslip.',
    discoveredAt: new Date(),
    actor: SYSTEM
  });
  const request = await dsr.recordRequest({
    organisationId: orgId,
    entityId,
    rights: ['access'],
    channel: 'email',
    receivedAt: new Date(),
    description: 'Everything about me.',
    requesterName: 'Jane Example',
    actor: SYSTEM
  });
  await dsr.addScopeEntry({
    requestId: request.id,
    organisationId: orgId,
    kind: 'recipient',
    label: 'A recipient',
    actor: SYSTEM
  });
  await dsrIntake.issueIntakeLink({
    organisationId: orgId,
    entityId,
    label: 'A form',
    actor: SYSTEM
  });
  await complaintsSvc.recordComplaint({
    organisationId: orgId,
    entityId,
    channel: 'email',
    receivedAt: new Date(),
    subject: 'request_handling',
    description: 'A grievance.',
    complainantName: 'Jane Example',
    requestId: request.id,
    actor: SYSTEM
  });
  const property = await inventory.createProperty({
    organisationId: orgId,
    entityId,
    name: 'Site',
    url: 'https://gone.example.com',
    actor: SYSTEM
  });
  await inventory.addItem({
    propertyId: property.id,
    organisationId: orgId,
    name: 'a_cookie',
    domain: 'gone.example.com',
    actor: SYSTEM
  });
  const marketing = await marketingSvc.createMarketingActivity({
    organisationId: orgId,
    entityId,
    name: 'Call list',
    channel: 'live_call',
    processingActivityId: activity.id,
    actor: SYSTEM
  });
  await marketingSvc.recordMarketingDecision({
    activityId: marketing.id,
    organisationId: orgId,
    basis: 'screened_calls',
    rationale: 'Reasons',
    actor: SYSTEM
  });
  const sharing = await sharingSvc.createSharingAgreement({
    organisationId: orgId,
    entityId,
    title: 'Sharing',
    actor: SYSTEM
  });
  const partner = await thirdParty.createSupplier({
    organisationId: orgId,
    name: `Partner ${crypto.randomUUID().slice(0, 6)}`,
    actor: SYSTEM
  });
  await thirdParty.updateSupplier({
    supplierId: partner.id,
    organisationId: orgId,
    changes: { role: 'controller' },
    actor: SYSTEM
  });
  await sharingSvc.addSharingParty({
    agreementId: sharing.id,
    organisationId: orgId,
    supplierId: partner.id,
    actor: SYSTEM
  });
  const useCase = await aiRegister.createUseCase({
    organisationId: orgId,
    entityId,
    name: 'A model',
    purpose: 'Purpose.',
    systemType: 'generative',
    provenance: 'third_party_api',
    supplierId: supplier.id,
    actor: SYSTEM
  });
  await aiLifecycle.recordChange({
    useCaseId: useCase.id,
    organisationId: orgId,
    kind: 'data',
    summary: 'A change',
    actor: SYSTEM
  });
  await aiAssurance.recordAssurance({
    useCaseId: useCase.id,
    organisationId: orgId,
    kind: 'evaluation',
    title: 'An evaluation',
    performedAt: new Date(Date.now() - DAY),
    performedBy: 'Team',
    independent: false,
    metrics: [],
    result: 'passed',
    actor: SYSTEM
  });
  await aiIncidents.reportIncident({
    organisationId: orgId,
    useCaseId: useCase.id,
    kind: 'challenge',
    source: 'public',
    summary: 'An incident',
    harm: 'actual',
    confidential: false,
    reportedByLabel: 'someone',
    actor: SYSTEM
  });
  await atrs.startRecord({
    useCaseId: useCase.id,
    organisationId: orgId,
    actor: SYSTEM
  });
  const assessment = await assessmentsSvc.createAssessment({
    organisationId: orgId,
    entityId,
    templateVersionId: dpia.version.id,
    title: 'A DPIA',
    actor: SYSTEM
  });
  await contributorLinks.issueContributorLink({
    organisationId: orgId,
    assessmentId: assessment.id,
    email: 'helper@example.test',
    actor: SYSTEM
  });
  await collaboration.postComment({
    organisationId: orgId,
    entityId,
    subjectType: 'risk',
    subjectId: risk.id,
    subjectLabel: risk.reference,
    body: 'A comment naming Jane Example',
    actor: SYSTEM
  });
  // Attached to the entity's breach, with no entity of its own.
  const document = await documentsSvc.attachDocument({
    organisationId: orgId,
    entityId: null,
    subjectType: 'breach',
    subjectId: breach.id,
    filename: 'evidence.pdf',
    contentType: 'application/pdf',
    content: PDF,
    actor: SYSTEM
  });
  const connection = await connections.createConnection({
    organisationId: orgId,
    kind: 'har_analyser',
    name: `Scanner ${crypto.randomUUID().slice(0, 6)}`,
    defaultEntityId: entityId,
    actor: SYSTEM
  });
  return {
    risk,
    breach,
    request,
    useCase,
    assessment,
    document,
    connection,
    supplier
  };
}

/** Every row anywhere that still names the entity in an `entity_id`. */
async function rowsNaming(entityId: string) {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'entity_id'
      and table_name not in ('entity_erasure', 'audit_event')`);
  const found: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table_name)} where entity_id = ${entityId}`
    );
    if (row.n > 0) found[table_name] = row.n;
  }
  return found;
}

after(async () => {
  await pg.end();
});

const appendOnly = (error: unknown) =>
  /append-only/.test(String((error as { cause?: unknown }).cause ?? error));

describe('who may delete a legal entity', () => {
  const entity = crypto.randomUUID();
  const other = crypto.randomUUID();
  const g = (grant: Grant) => [grant];

  it('an owner of the whole organisation', () => {
    assert.equal(
      mayDeleteEntity(
        g({ role: 'owner', scope: 'organisation' }),
        entity,
        false
      ),
      true
    );
  });

  it('an owner of that entity alone, and of no other', () => {
    const grants = g({ role: 'owner', scope: 'entity', entityId: entity });
    assert.equal(mayDeleteEntity(grants, entity, false), true);
    assert.equal(mayDeleteEntity(grants, other, false), false);
  });

  it('a platform administrator', () => {
    assert.equal(mayDeleteEntity([], entity, true), true);
  });

  it('nobody else, whatever they manage', () => {
    for (const role of [
      'privacy_admin',
      'privacy_analyst',
      'approver',
      'auditor',
      'ai_governance_lead'
    ] as const)
      assert.equal(
        mayDeleteEntity(g({ role, scope: 'organisation' }), entity, false),
        false,
        role
      );
  });
});

describe('the confirmation', () => {
  it('is exactly "delete everything"', () => {
    assert.equal(confirms('delete everything'), true);
    assert.equal(confirms('  delete everything  '), true);
    assert.equal(confirms('Delete everything'), false);
    assert.equal(confirms('delete'), false);
    assert.equal(confirms('delete everything please'), false);
  });

  it('says it is irrevocable and should be agreed, in both emails', () => {
    const link = erasureLinkEmail({
      entityName: 'Gone Limited',
      organisationName: 'Group',
      url: 'https://govern.example/app/admin/organisation/delete-entity/x',
      expiresAt: new Date(Date.now() + 30 * 60_000)
    });
    assert.match(link.text, /IRREVOCABLE/);
    assert.ok(link.text.includes(IRREVOCABLE));
    assert.ok(link.text.includes(AGREE_FIRST));
    assert.match(link.text, /27 days/);
    assert.match(link.subject, /permanently delete Gone Limited/);
    const done = erasureDoneEmail({
      entityName: 'Gone Limited',
      organisationName: 'Group',
      deletedBy: 'a@example.test',
      records: 12,
      completedAt: new Date()
    });
    assert.match(done.text, /cannot be undone/);
    assert.match(done.text, /27 days/);
  });
});

describe('asking to delete', () => {
  let w: Awaited<ReturnType<typeof world>>;
  before(async () => {
    w = await world();
  });

  it('refuses the only entity and the default', async () => {
    const [alone] = await db
      .insert(organisations)
      .values({
        name: 'Alone',
        slug: `alone-${crypto.randomUUID().slice(0, 8)}`
      })
      .returning();
    const [only] = await db
      .insert(entities)
      .values({ organisationId: alone.id, name: 'Only', isDefault: true })
      .returning();
    assert.match(
      (await erasureBlockers(alone.id, only.id)).join(),
      /only legal entity/
    );
    assert.match(
      (await erasureBlockers(w.org.id, w.main.id)).join(),
      /default entity/
    );
    assert.deepEqual(await erasureBlockers(w.org.id, w.gone.id), []);
    const mail = outbox();
    await assert.rejects(
      requestEntityErasure({
        organisationId: w.org.id,
        entityId: w.main.id,
        userId: w.owner.user.id,
        actor: w.owner.actor,
        origin: 'https://govern.example',
        send: mail.send
      }),
      /default entity/
    );
    assert.equal(mail.sent.length, 0);
  });

  it('emails the link to the address of record, and replaces an earlier one', async () => {
    const mail = outbox();
    const first = await requestEntityErasure({
      organisationId: w.org.id,
      entityId: w.gone.id,
      userId: w.owner.user.id,
      actor: w.owner.actor,
      origin: 'https://govern.example',
      send: mail.send
    });
    assert.equal(first.sentTo, w.owner.user.email);
    assert.deepEqual(mail.sent[0].to, [w.owner.user.email]);
    assert.ok(mail.sent[0].text.includes(IRREVOCABLE));
    const firstToken = mail.lastToken();
    assert.equal((await erasureForToken(firstToken)).state, 'open');

    await requestEntityErasure({
      organisationId: w.org.id,
      entityId: w.gone.id,
      userId: w.owner.user.id,
      actor: w.owner.actor,
      origin: 'https://govern.example',
      send: mail.send
    });
    assert.equal((await erasureForToken(firstToken)).state, 'used');
    assert.equal((await erasureForToken(mail.lastToken())).state, 'open');

    // Nothing is deleted by asking.
    const [still] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, w.gone.id));
    assert.ok(still);
  });

  it('refuses a link that is not theirs, has expired, or is not confirmed exactly', async () => {
    const mail = outbox();
    await requestEntityErasure({
      organisationId: w.org.id,
      entityId: w.gone.id,
      userId: w.owner.user.id,
      actor: w.owner.actor,
      origin: 'https://govern.example',
      send: mail.send
    });
    const token = mail.lastToken();
    await assert.rejects(
      confirmEntityErasure({
        token,
        userId: w.owner.user.id,
        typed: 'delete it all',
        actor: w.owner.actor,
        send: mail.send
      }),
      /exactly/
    );
    await assert.rejects(
      confirmEntityErasure({
        token,
        userId: w.otherOwner.user.id,
        typed: 'delete everything',
        actor: w.otherOwner.actor,
        send: mail.send
      }),
      /sent to somebody else/
    );
    await db
      .update(entityErasures)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(entityErasures.status, 'requested'));
    await assert.rejects(
      confirmEntityErasure({
        token,
        userId: w.owner.user.id,
        typed: 'delete everything',
        actor: w.owner.actor,
        send: mail.send
      }),
      /expired/
    );
    await assert.rejects(
      confirmEntityErasure({
        token: 'not-a-real-token-at-all-000000',
        userId: w.owner.user.id,
        typed: 'delete everything',
        actor: w.owner.actor,
        send: mail.send
      }),
      /not valid/
    );
    const [still] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, w.gone.id));
    assert.ok(still, 'nothing was deleted');
  });
});

describe('deleting', () => {
  let w: Awaited<ReturnType<typeof world>>;
  let made: Awaited<ReturnType<typeof populate>>;
  let kept: Awaited<ReturnType<typeof populate>>;
  let mail: ReturnType<typeof outbox>;
  let result: Awaited<ReturnType<typeof confirmEntityErasure>>;
  let preview: Awaited<ReturnType<typeof previewErasure>>;
  let token: string;

  before(async () => {
    w = await world();
    made = await populate(w.org.id, w.gone.id);
    kept = await populate(w.org.id, w.main.id);
    preview = await previewErasure(w.org.id, w.gone.id);
    mail = outbox();
    await requestEntityErasure({
      organisationId: w.org.id,
      entityId: w.gone.id,
      userId: w.owner.user.id,
      actor: w.owner.actor,
      origin: 'https://govern.example',
      send: mail.send
    });
    token = mail.lastToken();
    result = await confirmEntityErasure({
      token,
      userId: w.owner.user.id,
      typed: 'delete everything',
      actor: w.owner.actor,
      send: mail.send
    });
  });

  it('covers every table that names an entity', async () => {
    const tables = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'entity_id'
      order by table_name`);
    const covered = new Set<string>([
      ...ERASED_BY_ENTITY,
      ...Object.keys(KEPT_WITH_ENTITY_ID)
    ]);
    assert.deepEqual(
      tables.map((t) => t.table_name).filter((t) => !covered.has(t)),
      [],
      'tables with an entity_id that deleting an entity does not account for'
    );
  });

  it('leaves no row naming the entity, and the entity gone', async () => {
    assert.deepEqual(await rowsNaming(w.gone.id), {});
    const [row] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, w.gone.id));
    assert.equal(row, undefined);
  });

  it('takes what hangs off its records, including attached files', async () => {
    for (const [table, id] of [
      ['risk', made.risk.id],
      ['breach', made.breach.id],
      ['data_subject_request', made.request.id],
      ['ai_use_case', made.useCase.id],
      ['assessment', made.assessment.id],
      ['document', made.document.id]
    ] as const) {
      const [r] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where id = ${id}`
      );
      assert.equal(r.n, 0, `${table} survived`);
    }
    for (const [table, column, id] of [
      ['risk_acceptance', 'risk_id', made.risk.id],
      ['mitigation', 'risk_id', made.risk.id],
      ['breach_decision', 'breach_id', made.breach.id],
      ['data_subject_request_scope', 'request_id', made.request.id],
      ['assessment_revision', 'assessment_id', made.assessment.id],
      ['contributor_link', 'assessment_id', made.assessment.id]
    ] as const) {
      const [r] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${id}`
      );
      assert.equal(r.n, 0, `${table} survived`);
    }
    const [comments] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from comment where subject_id = ${made.risk.id}`
    );
    assert.equal(comments.n, 0);
  });

  it('deletes as many records as the preview said', () => {
    assert.ok(preview.records > 20);
    assert.equal(result.records, preview.records);
  });

  it("leaves the other entity's records and the organisation's suppliers alone", async () => {
    for (const [table, id] of [
      ['risk', kept.risk.id],
      ['breach', kept.breach.id],
      ['data_subject_request', kept.request.id],
      ['ai_use_case', kept.useCase.id],
      ['assessment', kept.assessment.id],
      ['document', kept.document.id],
      ['supplier', made.supplier.id]
    ] as const) {
      const [r] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where id = ${id}`
      );
      assert.equal(r.n, 1, `${table} was taken`);
    }
  });

  it('keeps the audit chain whole, with what changed erased', async () => {
    const check = await verifyAuditChain(w.org.id);
    assert.equal(check.ok, true);
    assert.ok(check.ok && check.erased === result.auditErased);
    assert.ok(result.auditErased > 10);
    const erased = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          sql`${auditEvents.erasedAt} is not null`
        )
      );
    assert.equal(erased.length, result.auditErased);
    for (const e of erased) {
      assert.equal(e.before, null);
      assert.equal(e.after, null);
      assert.deepEqual(e.metadata, {});
      assert.ok(e.contentDigest);
    }
    // Nothing about the entity's records is left with its contents.
    const [left] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from audit_event
      where organisation_id = ${w.org.id} and erased_at is null
        and entity_id = ${w.gone.id}`);
    assert.equal(left.n, 0);
    const text = JSON.stringify(
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, w.org.id))
    );
    assert.ok(!text.includes(made.risk.reference));
    const [done] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'entity.deleted')
        )
      );
    assert.equal(done.subjectId, w.gone.id);
    assert.equal(done.entityId, null);
    assert.equal(done.erasedAt, null);
  });

  it('keeps the acceptance of the terms, detached', async () => {
    const rows = await db
      .select()
      .from(entityAgreements)
      .where(eq(entityAgreements.organisationId, w.org.id));
    const forGone = rows.filter((r) => r.entityName === 'Gone Limited');
    assert.equal(forGone.length, 1);
    assert.equal(forGone[0].entityId, null);
  });

  it('stops a connection whose records landed there', async () => {
    const [c] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, made.connection.id));
    assert.equal(c.isActive, false);
    assert.equal(c.defaultEntityId, null);
    const [k] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, kept.connection.id));
    assert.equal(k.isActive, true);
  });

  it('confirms in writing, tells the other owners, and lists it', async () => {
    const done = mail.sent.at(-1)!;
    assert.deepEqual(done.to, [w.owner.user.email]);
    assert.match(done.subject, /Gone Limited has been deleted/);
    const told = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organisationId, w.org.id),
          eq(notifications.kind, 'entity.deleted')
        )
      );
    assert.deepEqual(
      told.map((n) => n.recipient),
      [w.otherOwner.user.email]
    );
    const listed = await deletedEntities(w.org.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].entityName, 'Gone Limited');
  });

  it('cannot be used twice', async () => {
    await assert.rejects(
      confirmEntityErasure({
        token,
        userId: w.owner.user.id,
        typed: 'delete everything',
        actor: w.owner.actor,
        send: mail.send
      })
    );
  });

  it("still refuses an audit event naming another organisation's entity", async () => {
    const other = await world();
    await assert.rejects(
      audit({
        organisationId: w.org.id,
        actorKind: 'system',
        actorLabel: 'test',
        action: 'test.cross',
        subjectType: 'entity',
        subjectId: other.main.id,
        entityId: other.main.id
      }),
      (error: unknown) =>
        /outside its organisation/.test(
          String((error as { cause?: unknown }).cause ?? error)
        )
    );
  });

  it('leaves the guards closed outside a deletion', async () => {
    const [risk] = await db.execute<{ id: string }>(
      sql`select risk_id as id from risk_acceptance limit 1`
    );
    await assert.rejects(
      db.execute(sql`delete from risk_acceptance where risk_id = ${risk.id}`),
      appendOnly
    );
    await assert.rejects(
      db.execute(
        sql`update audit_event set actor_label = 'erased' where organisation_id = ${w.org.id} and seq = 1`
      ),
      appendOnly
    );
  });
});
