import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  documents,
  entities,
  memberships,
  organisations,
  policies,
  policyVersions,
  processingActivities,
  roleAssignments,
  tasks,
  trials,
  users
} from '@/db/schema';
import { createUseCase } from '@/services/ai-register';
import { attachDocument, removeDocument } from '@/services/documents';
import {
  createPolicy,
  decideVersion,
  draftVersion,
  linkPolicy,
  loadPolicy,
  policiesDueForReview,
  policiesGoverning,
  PolicyRefused,
  recordPolicyReview,
  submitVersion,
  updateDraft,
  withdrawPolicy
} from '@/services/policies';
import { SegregationOfDuties } from '@/services/risks';
import { sweepOrganisation } from '@/services/sweep';
import { TrialRestricted } from '@/services/trial-guard';

import { EICAR, fakeClamd } from './fixtures/fake-clamd';

after(() => pg.end());

const PDF = Buffer.from('%PDF-1.7\npolicy test\n');

async function person(organisationId: string, label: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `${label}-${crypto.randomUUID().slice(0, 8)}@example.com`
    })
    .returning();
  await db.insert(memberships).values({ organisationId, userId: user.id });
  return {
    user,
    actor: {
      actorKind: 'user' as const,
      actorUserId: user.id,
      actorLabel: user.email
    }
  };
}

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: label,
      slug: `${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true })
    .returning();
  const [other] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Subsidiary' })
    .returning();
  const author = await person(org.id, 'author');
  const approver = await person(org.id, 'approver');
  return { org, entity, other, author, approver };
}

type World = Awaited<ReturnType<typeof world>>;

/** A policy with its text attached and chosen for the first version. */
async function drafted(w: World, entityId: string | null = w.entity.id) {
  const policy = await createPolicy({
    organisationId: w.org.id,
    entityId,
    title: 'Information security policy',
    ownerId: w.author.user.id,
    actor: w.author.actor
  });
  const file = await attachDocument({
    organisationId: w.org.id,
    entityId,
    subjectType: 'policy',
    subjectId: policy.id,
    filename: 'infosec-1.0.pdf',
    contentType: 'application/pdf',
    content: PDF,
    actor: w.author.actor
  });
  const [version] = await db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyId, policy.id));
  await updateDraft({
    versionId: version.id,
    organisationId: w.org.id,
    label: '1.0',
    documentId: file.id,
    actor: w.author.actor
  });
  return { policy, version, file };
}

const approve = (w: World, versionId: string) =>
  decideVersion({
    versionId,
    organisationId: w.org.id,
    decision: 'approved',
    approvalReference: 'Board, 12 November 2026, minute 7',
    actor: w.approver.actor
  });

describe('approving a policy', () => {
  it('puts the policy in force once somebody else approves the submitted text', async () => {
    const w = await world('policy-approve');
    const { policy, version } = await drafted(w);
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    const [task] = await db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.subjectId, version.id), eq(tasks.type, 'policy_approval'))
      );
    assert.equal(task.status, 'open');
    // Nobody here holds the approver role, so the owners are asked.
    assert.equal(task.assigneeRole, 'owner');

    await approve(w, version.id);
    const loaded = (await loadPolicy(policy.id, w.org.id))!;
    assert.equal(loaded.policy.status, 'in_force');
    assert.ok(loaded.policy.nextReviewAt);
    const months =
      (loaded.policy.nextReviewAt.getUTCFullYear() -
        loaded.policy.lastReviewedAt!.getUTCFullYear()) *
        12 +
      loaded.policy.nextReviewAt.getUTCMonth() -
      loaded.policy.lastReviewedAt!.getUTCMonth();
    assert.equal(months, 12);
    assert.equal(loaded.versions[0].version.status, 'approved');
    assert.equal(
      loaded.versions[0].version.approvalReference,
      'Board, 12 November 2026, minute 7'
    );
    const [done] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    assert.equal(done.status, 'done');

    const actions = (
      await db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, w.org.id))
    ).map((e) => e.action);
    for (const a of [
      'policy.created',
      'policy_version.updated',
      'policy_version.submitted',
      'policy_version.approved'
    ])
      assert.ok(actions.includes(a), a);
  });

  it('supersedes the version in force when the next is approved', async () => {
    const w = await world('policy-supersede');
    const { policy, version, file } = await drafted(w);
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await approve(w, version.id);

    const next = await draftVersion({
      policyId: policy.id,
      organisationId: w.org.id,
      label: '1.1',
      changes: 'Adds remote working.',
      actor: w.author.actor
    });
    await updateDraft({
      versionId: next.id,
      organisationId: w.org.id,
      label: '1.1',
      changes: 'Adds remote working.',
      documentId: file.id,
      actor: w.author.actor
    });
    await submitVersion({
      versionId: next.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await approve(w, next.id);
    const [first] = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.id, version.id));
    assert.equal(first.status, 'superseded');
    assert.ok(first.supersededAt);
  });

  it('refuses a decision by the person who submitted it, and a decision without its grounds', async () => {
    const w = await world('policy-segregation');
    const { version } = await drafted(w);
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await assert.rejects(
      decideVersion({
        versionId: version.id,
        organisationId: w.org.id,
        decision: 'approved',
        approvalReference: 'Board',
        actor: w.author.actor
      }),
      SegregationOfDuties
    );
    await assert.rejects(
      decideVersion({
        versionId: version.id,
        organisationId: w.org.id,
        decision: 'approved',
        actor: w.approver.actor
      }),
      /where it was agreed/
    );
    await assert.rejects(
      decideVersion({
        versionId: version.id,
        organisationId: w.org.id,
        decision: 'rejected',
        actor: w.approver.actor
      }),
      /why it was not approved/
    );
  });

  it('leaves a rejected version out of force, and a new one can be drafted', async () => {
    const w = await world('policy-reject');
    const { policy, version } = await drafted(w);
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await decideVersion({
      versionId: version.id,
      organisationId: w.org.id,
      decision: 'rejected',
      rejectionReason: 'Say who may grant exceptions.',
      actor: w.approver.actor
    });
    const loaded = (await loadPolicy(policy.id, w.org.id))!;
    assert.equal(loaded.policy.status, 'draft');
    assert.equal(loaded.versions[0].version.status, 'rejected');
    await draftVersion({
      policyId: policy.id,
      organisationId: w.org.id,
      label: '1.0a',
      actor: w.author.actor
    });
  });
});

describe('what cannot change', () => {
  it('submits only a draft with its text, and changes nothing once submitted', async () => {
    const w = await world('policy-frozen');
    const policy = await createPolicy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Acceptable use',
      actor: w.author.actor
    });
    const [version] = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, policy.id));
    await assert.rejects(
      submitVersion({
        versionId: version.id,
        organisationId: w.org.id,
        actor: w.author.actor
      }),
      /Attach the policy's text/
    );

    const { version: v, file } = await drafted(w);
    await submitVersion({
      versionId: v.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await assert.rejects(
      updateDraft({
        versionId: v.id,
        organisationId: w.org.id,
        label: '9.9',
        actor: w.author.actor
      }),
      /Only a draft can be changed/
    );
    await assert.rejects(
      removeDocument({
        id: file.id,
        organisationId: w.org.id,
        actor: w.author.actor
      }),
      /submitted or decided, so it is kept/
    );
    await approve(w, v.id);
    // The database holds the decision too, whatever a query tries.
    await assert.rejects(
      db
        .update(policyVersions)
        .set({ label: 'rewritten' })
        .where(eq(policyVersions.id, v.id))
    );
  });

  it('allows one version in hand at a time', async () => {
    const w = await world('policy-one-open');
    const { policy } = await drafted(w);
    await assert.rejects(
      draftVersion({
        policyId: policy.id,
        organisationId: w.org.id,
        label: '2.0',
        actor: w.author.actor
      }),
      /still being worked on/
    );
  });
});

describe('reviews and withdrawal', () => {
  it('moves the next review on, and raises one task for policies past review', async () => {
    const w = await world('policy-review');
    const { policy, version } = await drafted(w);
    await assert.rejects(
      recordPolicyReview({
        policyId: policy.id,
        organisationId: w.org.id,
        actor: w.author.actor
      }),
      /Only a policy in force/
    );
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await approve(w, version.id);
    await db
      .update(policies)
      .set({ nextReviewAt: new Date('2025-01-01') })
      .where(eq(policies.id, policy.id));
    assert.equal((await policiesDueForReview(w.org.id)).length, 1);
    const swept = await sweepOrganisation(w.org.id);
    assert.equal(swept.policyReviewsRaised, 1);
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.organisationId, w.org.id),
              eq(tasks.type, 'policy_review')
            )
          )
      ).length,
      1
    );

    await recordPolicyReview({
      policyId: policy.id,
      organisationId: w.org.id,
      reviewedAt: new Date('2026-06-01'),
      actor: w.author.actor
    });
    const [after] = await db
      .select()
      .from(policies)
      .where(eq(policies.id, policy.id));
    assert.equal(after.nextReviewAt?.toISOString().slice(0, 10), '2027-06-01');
    assert.equal((await policiesDueForReview(w.org.id)).length, 0);
  });

  it('keeps a withdrawn policy, closes its version in hand, and raises no review', async () => {
    const w = await world('policy-withdraw');
    const { policy, version } = await drafted(w);
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await assert.rejects(
      withdrawPolicy({
        policyId: policy.id,
        organisationId: w.org.id,
        reason: ' ',
        actor: w.author.actor
      }),
      PolicyRefused
    );
    await withdrawPolicy({
      policyId: policy.id,
      organisationId: w.org.id,
      reason: 'Replaced by the group policy',
      actor: w.author.actor
    });
    const loaded = (await loadPolicy(policy.id, w.org.id))!;
    assert.equal(loaded.policy.status, 'withdrawn');
    assert.equal(loaded.versions[0].version.status, 'rejected');
    assert.equal(loaded.policy.nextReviewAt, null);
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.subjectId, version.id));
    assert.equal(task.status, 'done');
    await assert.rejects(
      draftVersion({
        policyId: policy.id,
        organisationId: w.org.id,
        label: '2.0',
        actor: w.author.actor
      }),
      /withdrawn/
    );
  });
});

describe('what a policy governs', () => {
  it("links to activities and AI systems of its own entity, or any for an organisation's policy", async () => {
    const w = await world('policy-links');
    const [here, there] = await db
      .insert(processingActivities)
      .values([
        {
          organisationId: w.org.id,
          entityId: w.entity.id,
          reference: 'ROPA-2026-0001',
          name: 'Payroll'
        },
        {
          organisationId: w.org.id,
          entityId: w.other.id,
          reference: 'ROPA-2026-0002',
          name: 'Recruitment'
        }
      ])
      .returning();
    const system = await createUseCase({
      organisationId: w.org.id,
      entityId: w.other.id,
      name: 'CV screening',
      purpose: 'Ranks applications for a recruiter to read first.',
      systemType: 'predictive',
      provenance: 'third_party_api',
      actor: w.author.actor
    });

    const { policy } = await drafted(w);
    await linkPolicy({
      policyId: policy.id,
      organisationId: w.org.id,
      kind: 'activity',
      targetId: here.id,
      actor: w.author.actor
    });
    await assert.rejects(
      linkPolicy({
        policyId: policy.id,
        organisationId: w.org.id,
        kind: 'activity',
        targetId: there.id,
        actor: w.author.actor
      }),
      /of the legal entity the policy is for/
    );

    const { policy: groupWide } = await drafted(w, null);
    await linkPolicy({
      policyId: groupWide.id,
      organisationId: w.org.id,
      kind: 'ai_system',
      targetId: system.id,
      actor: w.author.actor
    });
    assert.deepEqual(
      (await policiesGoverning(w.org.id, 'ai_system', system.id)).map(
        (p) => p.id
      ),
      [groupWide.id]
    );
    const loaded = (await loadPolicy(policy.id, w.org.id))!;
    assert.deepEqual(
      loaded.activities.map((a) => a.id),
      [here.id]
    );
  });
});

describe('what the database allows', () => {
  it('lets the file a decided version names be erased, and nothing else change', async () => {
    const w = await world('policy-guard');
    const { version, file } = await drafted(w);
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    await approve(w, version.id);
    // As when the record is erased: the reference empties, the decision stays.
    await db.delete(documents).where(eq(documents.id, file.id));
    const [kept] = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.id, version.id));
    assert.equal(kept.documentId, null);
    assert.equal(kept.status, 'approved');
    await assert.rejects(
      db
        .update(policyVersions)
        .set({ approvalReference: 'Somewhere else' })
        .where(eq(policyVersions.id, version.id))
    );
    await assert.rejects(
      db
        .update(policyVersions)
        .set({ status: 'rejected' })
        .where(eq(policyVersions.id, version.id))
    );
  });

  it('asks the approvers where somebody holds that role', async () => {
    const w = await world('policy-approver-role');
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, w.approver.user.id));
    await db.insert(roleAssignments).values({
      membershipId: membership.id,
      role: 'approver',
      scope: 'organisation'
    });
    const { version } = await drafted(w);
    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.subjectId, version.id));
    assert.equal(task.assigneeRole, 'approver');
  });
});

/** Point the service at a scanner for the length of `work`, as CLAMAV_HOST would. */
async function withScanner<T>(
  port: number,
  work: () => Promise<T>
): Promise<T> {
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(port);
  try {
    return await work();
  } finally {
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
  }
}

const addWithText = (w: World, content: Buffer, contentType: string) =>
  createPolicy({
    organisationId: w.org.id,
    entityId: w.entity.id,
    title: 'Acceptable use policy',
    ownerId: w.author.user.id,
    text: { filename: 'aup.pdf', contentType, content },
    actor: w.author.actor
  });

describe('adding a policy with its text', () => {
  it('attaches the file and makes it the first version, ready to submit', async () => {
    const w = await world('policy-with-text');
    const policy = await addWithText(w, PDF, 'application/pdf');

    const [file] = await db
      .select()
      .from(documents)
      .where(eq(documents.subjectId, policy.id));
    assert.equal(file.subjectType, 'policy');
    assert.equal(file.filename, 'aup.pdf');
    const [version] = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, policy.id));
    assert.equal(version.documentId, file.id);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, w.org.id));
    const created = events.find((e) => e.action === 'policy.created');
    const attached = events.find((e) => e.action === 'document.attached');
    assert.ok(created && attached);
    assert.equal(attached.subjectId, policy.id);
    assert.equal(
      (created.after as { version: { documentId: string } }).version.documentId,
      file.id
    );

    await submitVersion({
      versionId: version.id,
      organisationId: w.org.id,
      actor: w.author.actor
    });
  });

  it('records the scan where the deployment runs a scanner', async () => {
    const clamd = await fakeClamd();
    try {
      const w = await world('policy-text-scanned');
      const policy = await withScanner(clamd.port, () =>
        addWithText(w, PDF, 'application/pdf')
      );
      const [file] = await db
        .select()
        .from(documents)
        .where(eq(documents.subjectId, policy.id));
      assert.equal(file.scannerVersion, 'ClamAV 1.4.1/27450');
      assert.equal(clamd.scans, 1);
    } finally {
      await clamd.close();
    }
  });

  it('refuses an infected file, adds nothing, and records the attempt', async () => {
    const clamd = await fakeClamd();
    try {
      const w = await world('policy-text-infected');
      await assert.rejects(
        withScanner(clamd.port, () =>
          addWithText(w, Buffer.from(EICAR), 'text/plain')
        ),
        (e: Error) =>
          e instanceof PolicyRefused &&
          /Eicar-Test-Signature/.test(e.message) &&
          /has not been added/.test(e.message)
      );
      const kept = await db
        .select({ id: policies.id })
        .from(policies)
        .where(eq(policies.organisationId, w.org.id));
      assert.equal(kept.length, 0);
      const stored = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.organisationId, w.org.id));
      assert.equal(stored.length, 0);

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, w.org.id));
      const refused = events.find(
        (e) => e.action === 'document.refused_infected'
      );
      assert.ok(refused, 'the refusal is in the audit trail');
      assert.equal(refused.subjectType, 'organisation');
      assert.equal(
        events.some((e) => e.action === 'policy.created'),
        false
      );
    } finally {
      await clamd.close();
    }
  });

  it("refuses another organisation's entity before scanning the file", async () => {
    const clamd = await fakeClamd();
    try {
      const w = await world('policy-text-foreign');
      const elsewhere = await world('policy-text-elsewhere');
      await assert.rejects(
        withScanner(clamd.port, () =>
          createPolicy({
            organisationId: w.org.id,
            entityId: elsewhere.entity.id,
            title: 'Acceptable use policy',
            text: {
              filename: 'invoice.txt',
              contentType: 'text/plain',
              content: Buffer.from(EICAR)
            },
            actor: w.author.actor
          })
        )
      );
      assert.equal(clamd.scans, 0);
      for (const org of [w.org.id, elsewhere.org.id]) {
        const events = await db
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(eq(auditEvents.organisationId, org));
        assert.equal(
          events.some((e) => e.action === 'document.refused_infected'),
          false
        );
      }
    } finally {
      await clamd.close();
    }
  });

  it('refuses an empty file rather than adding the policy without it', async () => {
    const w = await world('policy-text-empty');
    await assert.rejects(
      addWithText(w, Buffer.alloc(0), 'application/pdf'),
      (e: Error) => e instanceof PolicyRefused && /empty/.test(e.message)
    );
    const kept = await db
      .select({ id: policies.id })
      .from(policies)
      .where(eq(policies.organisationId, w.org.id));
    assert.equal(kept.length, 0);
  });

  it('refuses a file in a trial, which adds its policies without one', async () => {
    // A trial has one member, so not the two-person world.
    const [org] = await db
      .insert(organisations)
      .values({ name: 'Trial', slug: `policy-trial-${crypto.randomUUID()}` })
      .returning();
    const [entity] = await db
      .insert(entities)
      .values({ organisationId: org.id, name: 'Main', isDefault: true })
      .returning();
    const { user, actor } = await person(org.id, 'trial');
    await db.insert(trials).values({
      organisationId: org.id,
      userId: user.id,
      canonicalEmail: user.email,
      endsAt: new Date(Date.now() + 86_400_000),
      fictionalDataAcceptedAt: new Date()
    });
    const add = (text?: {
      filename: string;
      contentType: string;
      content: Buffer;
    }) =>
      createPolicy({
        organisationId: org.id,
        entityId: entity.id,
        title: 'Acceptable use policy',
        text,
        actor
      });
    await assert.rejects(
      add({
        filename: 'aup.pdf',
        contentType: 'application/pdf',
        content: PDF
      }),
      TrialRestricted
    );
    const policy = await add();
    assert.equal(policy.title, 'Acceptable use policy');
  });
});
