import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql
} from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import {
  aiUseCases,
  documents,
  entities,
  memberships,
  policies,
  policyActivities,
  policyAiSystems,
  policyVersions,
  processingActivities,
  roleAssignments,
  tasks,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { addMonths } from '@/lib/dates';
import { nextReference } from '@/lib/references';

import {
  checkFile,
  insertDocument,
  UploadRefused,
  type CheckedFile
} from './documents';
import { SegregationOfDuties } from './risks';
import type { Actor } from './templates';
import { assertEntityIn, assertMemberOf } from './tenancy-guards';
import { refuseDuringTrial } from './trial-guard';
import { raiseTask } from './workflow';

/**
 * The register of an organisation's policies (issue #65).
 *
 * A policy changes through versions. A version is drafted, submitted, and
 * approved or rejected by a member who may decide approvals and is not the
 * person who submitted it, naming where it was agreed. Approving puts it in
 * force, supersedes the version before, and sets the next review. A review
 * that changes nothing is recorded by the owner; any change to what the
 * policy says is a new version, approved again.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type Policy = typeof policies.$inferSelect;
export type PolicyVersion = typeof policyVersions.$inferSelect;
export type PolicyLinkKind = 'activity' | 'ai_system';

export class PolicyRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyRefused';
  }
}

const TITLE_LIMIT = 200;
const LABEL_LIMIT = 40;
const TEXT_LIMIT = 4000;

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new PolicyRefused('Give the policy a title.');
  if (t.length > TITLE_LIMIT) throw new PolicyRefused('The title is too long.');
  return t;
}

function cleanLabel(label: string): string {
  const l = label.trim();
  if (!l) throw new PolicyRefused('Give the version a number, such as 1.0.');
  if (l.length > LABEL_LIMIT)
    throw new PolicyRefused('The version number is too long.');
  return l;
}

function cleanText(value: string | null | undefined): string | null {
  const v = value?.trim() ?? '';
  if (v.length > TEXT_LIMIT) throw new PolicyRefused('That text is too long.');
  return v || null;
}

function cleanInterval(months: number | undefined): number {
  const m = months ?? 12;
  if (!Number.isInteger(m) || m < 1 || m > 60)
    throw new PolicyRefused(
      'Set a review every one to sixty months: most policies are reviewed yearly.'
    );
  return m;
}

async function policyForWrite(tx: Tx, organisationId: string, id: string) {
  const [policy] = await tx
    .select()
    .from(policies)
    .where(
      and(eq(policies.id, id), eq(policies.organisationId, organisationId))
    )
    .for('update');
  if (!policy) throw new PolicyRefused('No such policy.');
  return policy;
}

/**
 * A version and its policy, the policy locked. The version is read again
 * once the lock is held, so two people deciding or submitting at once see
 * each other's work rather than the state before it.
 */
async function versionForWrite(tx: Tx, organisationId: string, id: string) {
  const read = () =>
    tx
      .select()
      .from(policyVersions)
      .where(
        and(
          eq(policyVersions.id, id),
          eq(policyVersions.organisationId, organisationId)
        )
      );
  const [first] = await read();
  if (!first) throw new PolicyRefused('No such version.');
  const policy = await policyForWrite(tx, organisationId, first.policyId);
  const [version] = await read();
  if (!version) throw new PolicyRefused('No such version.');
  return { version, policy };
}

const refuseIfWithdrawn = (policy: Policy) => {
  if (policy.status === 'withdrawn')
    throw new PolicyRefused('The policy has been withdrawn.');
};

/**
 * Who an approval task is for: the approvers who may decide it, or, where
 * the organisation has given nobody that role there, its owners, who hold
 * every capability and would otherwise not be asked.
 */
async function approvalRole(
  tx: Tx,
  policy: Policy
): Promise<'approver' | 'owner'> {
  const [held] = await tx
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .innerJoin(memberships, eq(memberships.id, roleAssignments.membershipId))
    .where(
      and(
        eq(memberships.organisationId, policy.organisationId),
        eq(roleAssignments.role, 'approver'),
        policy.entityId
          ? or(
              eq(roleAssignments.scope, 'organisation'),
              eq(roleAssignments.entityId, policy.entityId)
            )
          : eq(roleAssignments.scope, 'organisation')
      )
    )
    .limit(1);
  return held ? 'approver' : 'owner';
}

/** Tasks are raised against an entity: the policy's, or the default one. */
async function taskEntity(tx: Tx, policy: Policy): Promise<string | null> {
  if (policy.entityId) return policy.entityId;
  const [entity] = await tx
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.organisationId, policy.organisationId),
        eq(entities.isDefault, true)
      )
    );
  return entity?.id ?? null;
}

/** A file as it arrived from the form, before any check. */
export type UploadedFile = {
  filename: string;
  contentType: string;
  content: Buffer;
};

/**
 * The policy's text, checked and scanned before the policy is made, so a
 * refused file leaves nothing behind. A trial uploads nothing, whichever path
 * the file came by. There is no policy yet to record an infected file
 * against, so that refusal is recorded against the organisation.
 */
async function checkedText(input: {
  organisationId: string;
  entityId: string | null;
  text: UploadedFile;
  actor: Actor;
}): Promise<CheckedFile> {
  await refuseDuringTrial(input.organisationId, 'file.upload');
  // Before the scan, which audits a refusal against this entity.
  if (input.entityId)
    await withOrganisation(input.organisationId, () =>
      assertEntityIn(input.organisationId, input.entityId!)
    );
  try {
    return await checkFile({
      organisationId: input.organisationId,
      entityId: input.entityId,
      ...input.text,
      actor: input.actor,
      auditAs: { subjectType: 'organisation', subjectId: input.organisationId }
    });
  } catch (error) {
    if (!(error instanceof UploadRefused)) throw error;
    throw new PolicyRefused(
      `${error.message} The policy has not been added either - choose another file, or add the policy without one and attach its text afterwards.`
    );
  }
}

/**
 * A new policy, with its first version as a draft. Given its text, the file
 * is attached and chosen for that version in the same transaction, so the
 * draft is ready to submit without a second visit.
 */
export async function createPolicy(input: {
  organisationId: string;
  entityId: string | null;
  title: string;
  summary?: string | null;
  ownerId?: string | null;
  reviewIntervalMonths?: number;
  versionLabel?: string;
  text?: UploadedFile | null;
  actor: Actor;
}) {
  const title = cleanTitle(input.title);
  const summary = cleanText(input.summary);
  const reviewIntervalMonths = cleanInterval(input.reviewIntervalMonths);
  const label = cleanLabel(input.versionLabel ?? '1.0');
  // Outside the transaction, so the record of a refused infected file is
  // kept although nothing else is.
  const text = input.text
    ? await checkedText({ ...input, text: input.text })
    : null;
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      if (input.entityId)
        await assertEntityIn(input.organisationId, input.entityId, tx);
      if (input.ownerId)
        await assertMemberOf(input.organisationId, input.ownerId, tx);
      const reference = await nextReference(
        tx,
        input.organisationId,
        'POL',
        new Date().getUTCFullYear()
      );
      const [policy] = await tx
        .insert(policies)
        .values({
          organisationId: input.organisationId,
          entityId: input.entityId,
          reference,
          title,
          summary,
          ownerId: input.ownerId ?? null,
          reviewIntervalMonths
        })
        .returning();
      const document = text
        ? await insertDocument(tx, {
            organisationId: input.organisationId,
            entityId: input.entityId,
            subjectType: 'policy',
            subjectId: policy.id,
            file: text,
            actor: input.actor
          })
        : null;
      const [version] = await tx
        .insert(policyVersions)
        .values({
          organisationId: input.organisationId,
          policyId: policy.id,
          label,
          documentId: document?.id ?? null,
          draftedByLabel: input.actor.actorLabel
        })
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.entityId ?? undefined,
        action: 'policy.created',
        subjectType: 'policy',
        subjectId: policy.id,
        after: {
          reference,
          title,
          ownerId: policy.ownerId,
          reviewIntervalMonths,
          version: { id: version.id, label, documentId: version.documentId }
        }
      });
      return policy;
    })
  );
}

const AUDITED = [
  'title',
  'summary',
  'ownerId',
  'reviewIntervalMonths'
] as const;

/** What the policy is called, who owns it, and how often it is reviewed. */
export async function updatePolicy(input: {
  id: string;
  organisationId: string;
  title: string;
  summary?: string | null;
  ownerId?: string | null;
  reviewIntervalMonths?: number;
  actor: Actor;
}) {
  const title = cleanTitle(input.title);
  const summary = cleanText(input.summary);
  const reviewIntervalMonths = cleanInterval(input.reviewIntervalMonths);
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await policyForWrite(tx, input.organisationId, input.id);
      refuseIfWithdrawn(before);
      if (input.ownerId)
        await assertMemberOf(input.organisationId, input.ownerId, tx);
      const [after] = await tx
        .update(policies)
        .set({
          title,
          summary,
          ownerId: input.ownerId ?? null,
          reviewIntervalMonths,
          updatedAt: new Date()
        })
        .where(eq(policies.id, input.id))
        .returning();
      const changed = AUDITED.filter((k) => before[k] !== after[k]);
      if (changed.length === 0) return after;
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: after.entityId ?? undefined,
        action: 'policy.updated',
        subjectType: 'policy',
        subjectId: after.id,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k]]))
      });
      return after;
    })
  );
}

/** Start the next version, while none is being worked on. */
export async function draftVersion(input: {
  policyId: string;
  organisationId: string;
  label: string;
  changes?: string | null;
  actor: Actor;
}) {
  const label = cleanLabel(input.label);
  const changes = cleanText(input.changes);
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const policy = await policyForWrite(
        tx,
        input.organisationId,
        input.policyId
      );
      refuseIfWithdrawn(policy);
      const [open] = await tx
        .select({ label: policyVersions.label })
        .from(policyVersions)
        .where(
          and(
            eq(policyVersions.policyId, policy.id),
            inArray(policyVersions.status, ['draft', 'submitted'])
          )
        );
      if (open)
        throw new PolicyRefused(
          `Version ${open.label} is still being worked on. Finish it first.`
        );
      const [version] = await tx
        .insert(policyVersions)
        .values({
          organisationId: input.organisationId,
          policyId: policy.id,
          label,
          changes,
          draftedByLabel: input.actor.actorLabel
        })
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action: 'policy_version.drafted',
        subjectType: 'policy_version',
        subjectId: version.id,
        after: { policy: policy.id, label, changes }
      });
      return version;
    })
  );
}

/** A file attached to the policy, checked to be one. */
async function policyFile(tx: Tx, policyId: string, documentId: string) {
  const [file] = await tx
    .select({ id: documents.id, quarantinedAt: documents.quarantinedAt })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.subjectType, 'policy'),
        eq(documents.subjectId, policyId)
      )
    );
  if (!file) throw new PolicyRefused('Choose a file attached to this policy.');
  if (file.quarantinedAt)
    throw new PolicyRefused(
      'That file was found to be infected and is quarantined. Attach a clean copy.'
    );
  return file.id;
}

/** Change a version that has not been submitted yet. */
export async function updateDraft(input: {
  versionId: string;
  organisationId: string;
  label: string;
  changes?: string | null;
  documentId?: string | null;
  actor: Actor;
}) {
  const label = cleanLabel(input.label);
  const changes = cleanText(input.changes);
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const { version, policy } = await versionForWrite(
        tx,
        input.organisationId,
        input.versionId
      );
      refuseIfWithdrawn(policy);
      if (version.status !== 'draft')
        throw new PolicyRefused(
          'Only a draft can be changed. Once submitted, a version is approved or rejected as it stands.'
        );
      const documentId = input.documentId
        ? await policyFile(tx, policy.id, input.documentId)
        : null;
      const [after] = await tx
        .update(policyVersions)
        .set({ label, changes, documentId, updatedAt: new Date() })
        .where(eq(policyVersions.id, version.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action: 'policy_version.updated',
        subjectType: 'policy_version',
        subjectId: version.id,
        before: {
          label: version.label,
          changes: version.changes,
          documentId: version.documentId
        },
        after: { label, changes, documentId }
      });
      return after;
    })
  );
}

/** Send a draft for approval, raising a task for the approvers. */
export async function submitVersion(input: {
  versionId: string;
  organisationId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const { version, policy } = await versionForWrite(
        tx,
        input.organisationId,
        input.versionId
      );
      refuseIfWithdrawn(policy);
      if (version.status !== 'draft')
        throw new PolicyRefused(`This version is already ${version.status}.`);
      // What is approved is a text, not a title: without one there is
      // nothing for the approver to read, or for anybody to hold to later.
      if (!version.documentId)
        throw new PolicyRefused(
          "Attach the policy's text and choose it for this version before submitting it."
        );
      const now = new Date();
      const [after] = await tx
        .update(policyVersions)
        .set({
          status: 'submitted',
          submittedByUserId: input.actor.actorUserId ?? null,
          submittedByLabel: input.actor.actorLabel,
          submittedAt: now,
          updatedAt: now
        })
        .where(eq(policyVersions.id, version.id))
        .returning();
      const entityId = await taskEntity(tx, policy);
      if (entityId)
        await raiseTask(tx, {
          organisationId: input.organisationId,
          entityId,
          type: 'policy_approval',
          title: `${policy.reference}: approve version ${version.label} of ${policy.title}`,
          description:
            'Read it and approve it, naming where it was agreed, or reject it with the reason. Not by the person who submitted it.',
          subjectType: 'policy_version',
          subjectId: version.id,
          assigneeRole: await approvalRole(tx, policy),
          idempotencyKey: `policy-approval:${version.id}`,
          actor: input.actor
        });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action: 'policy_version.submitted',
        subjectType: 'policy_version',
        subjectId: version.id,
        before: { status: 'draft' },
        after: {
          status: 'submitted',
          policy: policy.id,
          label: version.label,
          documentId: version.documentId
        }
      });
      return after;
    })
  );
}

/** The approval tasks for a version, closed once it is decided. */
async function closeApprovalTasks(tx: Tx, versionId: string, by: string) {
  await tx
    .update(tasks)
    .set({ status: 'done', completedAt: new Date(), completedByLabel: by })
    .where(
      and(
        eq(tasks.subjectType, 'policy_version'),
        eq(tasks.subjectId, versionId),
        eq(tasks.type, 'policy_approval'),
        inArray(tasks.status, ['open', 'in_progress'])
      )
    );
}

/**
 * Approve or reject a submitted version.
 *
 * Not by the person who submitted it: a policy its own author signed off has
 * been signed off by nobody. Approval names where it was agreed, as a risk
 * appetite does, because that is what a regulator or auditor asks for.
 */
export async function decideVersion(input: {
  versionId: string;
  organisationId: string;
  decision: 'approved' | 'rejected';
  approvalReference?: string;
  rejectionReason?: string;
  actor: Actor;
}) {
  const reference = input.approvalReference?.trim() ?? '';
  const reason = input.rejectionReason?.trim() ?? '';
  if (input.decision === 'approved' && !reference)
    throw new PolicyRefused(
      'Say where it was agreed: the board or committee, the date and the minute.'
    );
  if (input.decision === 'rejected' && !reason)
    throw new PolicyRefused('Say why it was not approved.');
  if (reference.length > TEXT_LIMIT || reason.length > TEXT_LIMIT)
    throw new PolicyRefused('That text is too long.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const { version, policy } = await versionForWrite(
        tx,
        input.organisationId,
        input.versionId
      );
      refuseIfWithdrawn(policy);
      if (version.status !== 'submitted')
        throw new PolicyRefused(
          version.status === 'draft'
            ? 'It has not been submitted for approval yet.'
            : `This version is already ${version.status}.`
        );
      if (
        version.submittedByUserId &&
        version.submittedByUserId === input.actor.actorUserId
      )
        throw new SegregationOfDuties(
          'A policy cannot be approved or rejected by the person who submitted it.'
        );

      const now = new Date();
      let superseded: string | null = null;
      if (input.decision === 'approved') {
        const [current] = await tx
          .update(policyVersions)
          .set({ status: 'superseded', supersededAt: now, updatedAt: now })
          .where(
            and(
              eq(policyVersions.policyId, policy.id),
              eq(policyVersions.status, 'approved')
            )
          )
          .returning({ id: policyVersions.id });
        superseded = current?.id ?? null;
      }
      const [decided] = await tx
        .update(policyVersions)
        .set({
          status: input.decision,
          decidedByUserId: input.actor.actorUserId ?? null,
          decidedByLabel: input.actor.actorLabel,
          decidedAt: now,
          updatedAt: now,
          ...(input.decision === 'approved'
            ? { approvalReference: reference }
            : { rejectionReason: reason })
        })
        .where(eq(policyVersions.id, version.id))
        .returning();
      if (input.decision === 'approved')
        await tx
          .update(policies)
          .set({
            status: 'in_force',
            lastReviewedAt: now,
            nextReviewAt: addMonths(now, policy.reviewIntervalMonths),
            updatedAt: now
          })
          .where(eq(policies.id, policy.id));
      await closeApprovalTasks(tx, version.id, input.actor.actorLabel);
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action:
          input.decision === 'approved'
            ? 'policy_version.approved'
            : 'policy_version.rejected',
        subjectType: 'policy_version',
        subjectId: version.id,
        before: { status: 'submitted' },
        after: {
          status: decided.status,
          policy: policy.id,
          label: version.label,
          ...(input.decision === 'approved'
            ? { approvalReference: reference, supersedes: superseded }
            : { rejectionReason: reason })
        }
      });
      return decided;
    })
  );
}

/**
 * The owner has read the policy in force and it still holds: the next review
 * moves on. A review that changes anything is a new version instead.
 */
export async function recordPolicyReview(input: {
  policyId: string;
  organisationId: string;
  reviewedAt?: Date;
  actor: Actor;
}) {
  const reviewedAt = input.reviewedAt ?? new Date();
  if (Number.isNaN(reviewedAt.getTime()))
    throw new PolicyRefused('That is not a date.');
  if (reviewedAt.getTime() > Date.now())
    throw new PolicyRefused('A review cannot be in the future.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const policy = await policyForWrite(
        tx,
        input.organisationId,
        input.policyId
      );
      if (policy.status !== 'in_force')
        throw new PolicyRefused(
          'Only a policy in force is reviewed. Approve a version first.'
        );
      const nextReviewAt = addMonths(reviewedAt, policy.reviewIntervalMonths);
      const [after] = await tx
        .update(policies)
        .set({
          lastReviewedAt: reviewedAt,
          nextReviewAt,
          updatedAt: new Date()
        })
        .where(eq(policies.id, policy.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action: 'policy.reviewed',
        subjectType: 'policy',
        subjectId: policy.id,
        before: {
          lastReviewedAt: policy.lastReviewedAt?.toISOString() ?? null,
          nextReviewAt: policy.nextReviewAt?.toISOString() ?? null
        },
        after: {
          lastReviewedAt: reviewedAt.toISOString(),
          nextReviewAt: nextReviewAt.toISOString()
        }
      });
      return after;
    })
  );
}

/**
 * No longer in force. Kept, with its versions, so the register shows what
 * applied while it was. A version still being worked on goes: a draft is
 * removed, and one waiting for approval is rejected, saying why.
 */
export async function withdrawPolicy(input: {
  policyId: string;
  organisationId: string;
  reason: string;
  actor: Actor;
}) {
  const reason = input.reason.trim();
  if (!reason) throw new PolicyRefused('Say why it is withdrawn.');
  if (reason.length > TEXT_LIMIT)
    throw new PolicyRefused('That text is too long.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const policy = await policyForWrite(
        tx,
        input.organisationId,
        input.policyId
      );
      refuseIfWithdrawn(policy);
      const now = new Date();
      await tx
        .delete(policyVersions)
        .where(
          and(
            eq(policyVersions.policyId, policy.id),
            eq(policyVersions.status, 'draft')
          )
        );
      const pending = await tx
        .update(policyVersions)
        .set({
          status: 'rejected',
          decidedByUserId: input.actor.actorUserId ?? null,
          decidedByLabel: input.actor.actorLabel,
          decidedAt: now,
          rejectionReason: 'The policy was withdrawn.',
          updatedAt: now
        })
        .where(
          and(
            eq(policyVersions.policyId, policy.id),
            eq(policyVersions.status, 'submitted')
          )
        )
        .returning({ id: policyVersions.id });
      for (const v of pending)
        await closeApprovalTasks(tx, v.id, input.actor.actorLabel);
      const [after] = await tx
        .update(policies)
        .set({
          status: 'withdrawn',
          withdrawnAt: now,
          withdrawnReason: reason,
          nextReviewAt: null,
          updatedAt: now
        })
        .where(eq(policies.id, policy.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action: 'policy.withdrawn',
        subjectType: 'policy',
        subjectId: policy.id,
        before: { status: policy.status },
        after: { status: 'withdrawn', reason }
      });
      return after;
    })
  );
}

const LINK = {
  activity: {
    table: policyActivities,
    column: policyActivities.activityId,
    key: 'activityId',
    target: processingActivities,
    label: 'processing activity'
  },
  ai_system: {
    table: policyAiSystems,
    column: policyAiSystems.aiUseCaseId,
    key: 'aiUseCaseId',
    target: aiUseCases,
    label: 'AI system'
  }
} as const;

export function isPolicyLinkKind(kind: string): kind is PolicyLinkKind {
  return kind in LINK;
}

/** The record to link, if it is one the policy may govern. */
async function linkTarget(
  tx: Tx,
  policy: Policy,
  kind: PolicyLinkKind,
  targetId: string
) {
  const { target, label } = LINK[kind];
  const [row] = await tx
    .select({ id: target.id, entityId: target.entityId, name: target.name })
    .from(target)
    .where(
      and(
        eq(target.id, targetId),
        eq(target.organisationId, policy.organisationId)
      )
    );
  if (!row || (policy.entityId && row.entityId !== policy.entityId))
    throw new PolicyRefused(
      `Choose a ${label} of the legal entity the policy is for.`
    );
  return row;
}

export async function linkPolicy(input: {
  policyId: string;
  organisationId: string;
  kind: PolicyLinkKind;
  targetId: string;
  actor: Actor;
}) {
  if (!isPolicyLinkKind(input.kind))
    throw new PolicyRefused('Nothing to link.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const policy = await policyForWrite(
        tx,
        input.organisationId,
        input.policyId
      );
      refuseIfWithdrawn(policy);
      const found = await linkTarget(tx, policy, input.kind, input.targetId);
      const { table, key } = LINK[input.kind];
      const made = await tx
        .insert(table)
        .values({
          organisationId: input.organisationId,
          policyId: policy.id,
          [key]: found.id
        } as typeof table.$inferInsert)
        .onConflictDoNothing()
        .returning();
      if (made.length === 0)
        throw new PolicyRefused(`${found.name} is already linked.`);
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action: 'policy.linked',
        subjectType: 'policy',
        subjectId: policy.id,
        after: { kind: input.kind, id: found.id, name: found.name }
      });
    })
  );
}

export async function unlinkPolicy(input: {
  policyId: string;
  organisationId: string;
  kind: PolicyLinkKind;
  targetId: string;
  actor: Actor;
}) {
  if (!isPolicyLinkKind(input.kind))
    throw new PolicyRefused('Nothing to unlink.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const policy = await policyForWrite(
        tx,
        input.organisationId,
        input.policyId
      );
      const { table, column } = LINK[input.kind];
      const gone = await tx
        .delete(table)
        .where(and(eq(table.policyId, policy.id), eq(column, input.targetId)))
        .returning();
      if (gone.length === 0) return;
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: policy.entityId ?? undefined,
        action: 'policy.unlinked',
        subjectType: 'policy',
        subjectId: policy.id,
        before: { kind: input.kind, id: input.targetId }
      });
    })
  );
}

/**
 * A policy is overdue for review once in force and past its date. One
 * imported and not yet confirmed is not yet relied on, as its held review
 * task says: its page asks for confirmation first.
 */
export function reviewOverdue(
  policy: Pick<
    Policy,
    'status' | 'nextReviewAt' | 'importBatchId' | 'importConfirmedAt'
  >,
  now = new Date()
): boolean {
  if (policy.importBatchId && !policy.importConfirmedAt) return false;
  return (
    policy.status === 'in_force' &&
    policy.nextReviewAt !== null &&
    policy.nextReviewAt.getTime() <= now.getTime()
  );
}

const visibleTo = (organisationId: string, entityIds: string[] | null) =>
  entityIds === null
    ? eq(policies.organisationId, organisationId)
    : and(
        eq(policies.organisationId, organisationId),
        entityIds.length
          ? sql`(${policies.entityId} is null or ${inArray(policies.entityId, entityIds)})`
          : isNull(policies.entityId)
      );

/** The register: each policy with the version in force and the one in hand. */
export async function policyRegister(
  organisationId: string,
  entityIds: string[] | null
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        policy: policies,
        entityName: entities.name,
        ownerEmail: users.email
      })
      .from(policies)
      .leftJoin(entities, eq(entities.id, policies.entityId))
      .leftJoin(users, eq(users.id, policies.ownerId))
      .where(visibleTo(organisationId, entityIds))
      .orderBy(asc(policies.title));
    const versions = rows.length
      ? await db
          .select({
            policyId: policyVersions.policyId,
            label: policyVersions.label,
            status: policyVersions.status
          })
          .from(policyVersions)
          .where(
            and(
              inArray(
                policyVersions.policyId,
                rows.map((r) => r.policy.id)
              ),
              inArray(policyVersions.status, ['approved', 'draft', 'submitted'])
            )
          )
      : [];
    return rows.map((r) => ({
      ...r,
      inForce:
        versions.find(
          (v) => v.policyId === r.policy.id && v.status === 'approved'
        ) ?? null,
      inHand:
        versions.find(
          (v) => v.policyId === r.policy.id && v.status !== 'approved'
        ) ?? null,
      overdue: reviewOverdue(r.policy)
    }));
  });
}

/** One policy, with its versions, files and links. */
export async function loadPolicy(id: string, organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select({
        policy: policies,
        entityName: entities.name,
        ownerEmail: users.email
      })
      .from(policies)
      .leftJoin(entities, eq(entities.id, policies.entityId))
      .leftJoin(users, eq(users.id, policies.ownerId))
      .where(
        and(eq(policies.id, id), eq(policies.organisationId, organisationId))
      );
    if (!row) return null;
    const [versions, activities, aiSystems] = await Promise.all([
      db
        .select({ version: policyVersions, filename: documents.filename })
        .from(policyVersions)
        .leftJoin(documents, eq(documents.id, policyVersions.documentId))
        .where(eq(policyVersions.policyId, id))
        .orderBy(desc(policyVersions.createdAt)),
      db
        .select({
          id: processingActivities.id,
          reference: processingActivities.reference,
          name: processingActivities.name
        })
        .from(policyActivities)
        .innerJoin(
          processingActivities,
          eq(processingActivities.id, policyActivities.activityId)
        )
        .where(eq(policyActivities.policyId, id))
        .orderBy(asc(processingActivities.reference)),
      db
        .select({ id: aiUseCases.id, name: aiUseCases.name })
        .from(policyAiSystems)
        .innerJoin(aiUseCases, eq(aiUseCases.id, policyAiSystems.aiUseCaseId))
        .where(eq(policyAiSystems.policyId, id))
        .orderBy(asc(aiUseCases.name))
    ]);
    return {
      ...row,
      versions,
      activities,
      aiSystems,
      overdue: reviewOverdue(row.policy)
    };
  });
}

/** What a policy could be linked to: records of its entity, or of any. */
export async function policyLinkOptions(
  organisationId: string,
  entityId: string | null
) {
  return withOrganisation(organisationId, async () => {
    const [activity, aiSystem] = await Promise.all([
      db
        .select({
          id: processingActivities.id,
          label: sql<string>`${processingActivities.reference} || ' ' || ${processingActivities.name}`
        })
        .from(processingActivities)
        .where(
          and(
            eq(processingActivities.organisationId, organisationId),
            entityId ? eq(processingActivities.entityId, entityId) : undefined,
            isNull(processingActivities.retiredAt)
          )
        )
        .orderBy(asc(processingActivities.reference)),
      db
        .select({ id: aiUseCases.id, label: aiUseCases.name })
        .from(aiUseCases)
        .where(
          and(
            eq(aiUseCases.organisationId, organisationId),
            entityId ? eq(aiUseCases.entityId, entityId) : undefined
          )
        )
        .orderBy(asc(aiUseCases.name))
    ]);
    return { activity, ai_system: aiSystem };
  });
}

/** The policies governing an activity or AI system, for its page. */
export async function policiesGoverning(
  organisationId: string,
  kind: PolicyLinkKind,
  targetId: string
) {
  return withOrganisation(organisationId, () => {
    const { table, column } = LINK[kind];
    return db
      .select({
        id: policies.id,
        reference: policies.reference,
        title: policies.title,
        status: policies.status
      })
      .from(table)
      .innerJoin(policies, eq(policies.id, table.policyId))
      .where(eq(column, targetId))
      .orderBy(asc(policies.title));
  });
}

/** Policies in force past their review date, oldest first. For the sweep. */
export async function policiesDueForReview(
  organisationId: string,
  now = new Date()
) {
  return withOrganisation(organisationId, () =>
    db
      .select()
      .from(policies)
      .where(
        and(
          eq(policies.organisationId, organisationId),
          eq(policies.status, 'in_force'),
          lte(policies.nextReviewAt, now),
          // One imported raises no review until a person has confirmed it: a
          // register moved in with old review dates would otherwise ask for
          // every one at once (decision 5 of issue #64).
          or(
            isNull(policies.importBatchId),
            isNotNull(policies.importConfirmedAt)
          )
        )
      )
      .orderBy(asc(policies.nextReviewAt))
  );
}
