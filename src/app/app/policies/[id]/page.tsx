import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { Attachments } from '@/components/documents/Attachments';
import { EditForm } from '@/components/EditForm';
import { ConfirmImported } from '@/components/imports/ConfirmImported';
import { ImportedFrom } from '@/components/imports/ImportedFrom';
import { NotPermitted } from '@/components/NotPermitted';
import { db, scoped } from '@/db/client';
import { memberships, users } from '@/db/schema';
import { can, canInScope } from '@/lib/rbac';
import { savedKey } from '@/lib/saved-key';
import { getActiveSession } from '@/lib/session';
import { documentsFor } from '@/services/documents';
import { importSourceName } from '@/services/imports';
import { loadPolicy, policyLinkOptions } from '@/services/policies';

import { inputClass, Label } from '../../requests/fields';
import {
  decideVersionAction,
  draftVersionAction,
  linkPolicyAction,
  reviewPolicyAction,
  submitVersionAction,
  unlinkPolicyAction,
  updateDraftAction,
  updatePolicyAction,
  withdrawPolicyAction
} from '../actions';

const day = (d: Date) => d.toISOString().slice(0, 10);

const VERSION_WORDS = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'In force',
  rejected: 'Not approved',
  superseded: 'Superseded'
} as const;

const button =
  'rounded border border-line px-4 py-2 text-sm hover:border-brand';
const primary =
  'rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90';

export default async function PolicyPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const org = active.membership.organisationId;
  const grants = active.membership.grants;

  const loaded = await loadPolicy(id, org);
  if (!loaded) notFound();
  const { policy, entityName, ownerEmail, versions, activities, aiSystems } =
    loaded;
  if (!can(grants, 'record.read', policy.entityId ?? undefined)) {
    return (
      <NotPermitted
        what="This policy"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const open = policy.status !== 'withdrawn';
  const mayEdit = open && canInScope(grants, 'record.write', policy.entityId);
  const mayDecide =
    open && canInScope(grants, 'approval.decide', policy.entityId);

  const [files, members, options] = await Promise.all([
    documentsFor(org, 'policy', policy.id),
    mayEdit
      ? scoped(org, () =>
          db
            .select({ id: users.id, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.organisationId, org))
            .orderBy(asc(users.email))
        )
      : [],
    mayEdit ? policyLinkOptions(org, policy.entityId) : null
  ]);
  const inHand = versions.find(
    (v) => v.version.status === 'draft' || v.version.status === 'submitted'
  );
  const usable = files.filter((f) => !f.quarantinedAt);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/policies"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Policies
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          <span className="font-mono text-base text-ink-soft">
            {policy.reference}
          </span>{' '}
          {policy.title}
        </h1>
        <p className="text-xs text-ink-soft">
          {entityName ?? 'Every entity in the organisation'} ·{' '}
          {ownerEmail ?? 'no owner'} · reviewed every{' '}
          {policy.reviewIntervalMonths} month
          {policy.reviewIntervalMonths === 1 ? '' : 's'}
          {policy.lastReviewedAt
            ? ` · last reviewed ${day(policy.lastReviewedAt)}`
            : ''}
          {policy.nextReviewAt ? ` · next ${day(policy.nextReviewAt)}` : ''}
        </p>
        {policy.summary ? (
          <p className="max-w-prose text-sm">{policy.summary}</p>
        ) : null}
        {policy.status === 'withdrawn' ? (
          <p className="max-w-prose rounded border border-line bg-ground px-3 py-2 text-xs">
            Withdrawn on {day(policy.withdrawnAt!)}
            {policy.withdrawnReason ? `: ${policy.withdrawnReason}` : ''}. It is
            kept, with its versions, to show what applied while it was in force.
          </p>
        ) : policy.status === 'draft' ? (
          <p className="text-xs text-amber-900">
            Not yet in force: no version has been approved.
          </p>
        ) : loaded.overdue ? (
          <p className="text-xs text-amber-900">Past its review date.</p>
        ) : null}
      </header>

      {policy.importSourceId ? (
        <ImportedFrom
          sourceName={
            (await importSourceName(org, policy.importSourceId)) ??
            'another platform'
          }
          batchId={policy.importBatchId}
          confirmed={policy.importConfirmedAt !== null}
          legacy={policy.legacy}
          history={policy.sourceHistory}
          confirm={
            canInScope(grants, 'record.write', policy.entityId) ? (
              <ConfirmImported
                type="policy"
                id={policy.id}
                revalidate={`/app/policies/${policy.id}`}
                what="this policy"
              />
            ) : null
          }
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Versions</h2>
        <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface text-sm">
          {versions.map(({ version: v, filename }) => (
            <li
              key={v.id}
              className="space-y-1 px-4 py-3"
            >
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">Version {v.label}</span>
                <span className="text-xs text-ink-soft">
                  {VERSION_WORDS[v.status]}
                </span>
              </p>
              {v.changes ? (
                <p className="max-w-prose whitespace-pre-wrap text-xs">
                  {v.changes}
                </p>
              ) : null}
              <p className="text-xs text-ink-soft">
                {filename ? `Text: ${filename}` : 'No text chosen yet'} ·
                drafted by {v.draftedByLabel}
                {v.submittedAt
                  ? ` · submitted by ${v.submittedByLabel} on ${day(v.submittedAt)}`
                  : ''}
                {v.decidedAt
                  ? ` · ${v.status === 'rejected' ? 'rejected' : 'approved'} by ${v.decidedByLabel} on ${day(v.decidedAt)}`
                  : ''}
                {v.supersededAt ? ` · superseded ${day(v.supersededAt)}` : ''}
              </p>
              {v.approvalReference ? (
                <p className="text-xs">Agreed at: {v.approvalReference}</p>
              ) : null}
              {v.rejectionReason ? (
                <p className="text-xs">Why not: {v.rejectionReason}</p>
              ) : null}
            </li>
          ))}
        </ul>

        {inHand && inHand.version.status === 'draft' && mayEdit ? (
          <EditForm
            saved={savedKey(inHand.version)}
            action={updateDraftAction.bind(null, policy.id, inHand.version.id)}
            className="space-y-3 rounded border border-line bg-surface p-5"
          >
            <h3 className="text-sm font-semibold">
              Version {inHand.version.label}, in draft
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label text="Version" />
                <input
                  name="label"
                  required
                  maxLength={40}
                  defaultValue={inHand.version.label}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="Its text"
                  hint="One of the files attached below."
                />
                <select
                  name="documentId"
                  defaultValue={inHand.version.documentId ?? ''}
                  className={inputClass}
                >
                  <option value="">None chosen</option>
                  {usable.map((f) => (
                    <option
                      key={f.id}
                      value={f.id}
                    >
                      {f.filename}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <Label
                  text="What changed"
                  hint="Optional for a first version."
                />
                <textarea
                  name="changes"
                  rows={3}
                  maxLength={4000}
                  defaultValue={inHand.version.changes ?? ''}
                  className={inputClass}
                />
              </label>
            </div>
            <button
              type="submit"
              className={button}
            >
              Save the draft
            </button>
          </EditForm>
        ) : null}

        {inHand && inHand.version.status === 'draft' && mayEdit ? (
          <EditForm
            action={submitVersionAction.bind(
              null,
              policy.id,
              inHand.version.id
            )}
            className="space-y-2 rounded border border-line bg-surface p-5"
          >
            <p className="max-w-prose text-sm text-ink-soft">
              Send it to the approvers. Somebody other than you approves or
              rejects it; until then it cannot be changed.
            </p>
            <button
              type="submit"
              className={primary}
            >
              Submit for approval
            </button>
          </EditForm>
        ) : null}

        {inHand && inHand.version.status === 'submitted' && mayDecide ? (
          inHand.version.submittedByUserId === active.userId ? (
            <p className="text-sm text-ink-soft">
              You submitted version {inHand.version.label}, so somebody else
              decides it.
            </p>
          ) : (
            <EditForm
              action={decideVersionAction.bind(
                null,
                policy.id,
                inHand.version.id
              )}
              className="space-y-3 rounded border border-line bg-surface p-5"
            >
              <h3 className="text-sm font-semibold">
                Decide version {inHand.version.label}
              </h3>
              <label className="block space-y-1">
                <Label
                  text="Where it was agreed"
                  hint="To approve: the board or committee, the date and the minute."
                />
                <input
                  name="approvalReference"
                  maxLength={4000}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="Why not"
                  hint="To reject: what needs to change."
                />
                <input
                  name="rejectionReason"
                  maxLength={4000}
                  className={inputClass}
                />
              </label>
              <div className="flex gap-3">
                <button
                  type="submit"
                  name="decision"
                  value="approved"
                  className={primary}
                >
                  Approve
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="rejected"
                  className={button}
                >
                  Reject
                </button>
              </div>
            </EditForm>
          )
        ) : null}

        {!inHand && mayEdit ? (
          <EditForm
            action={draftVersionAction.bind(null, policy.id)}
            className="space-y-3 rounded border border-line bg-surface p-5"
          >
            <h3 className="text-sm font-semibold">Draft a new version</h3>
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <label className="block space-y-1">
                <Label text="Version" />
                <input
                  name="label"
                  required
                  maxLength={40}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="What changes" />
                <input
                  name="changes"
                  maxLength={4000}
                  className={inputClass}
                />
              </label>
            </div>
            <button
              type="submit"
              className={button}
            >
              Start it
            </button>
          </EditForm>
        ) : null}
      </section>

      <Attachments
        subjectType="policy"
        subjectId={policy.id}
        entityId={policy.entityId}
        revalidate={`/app/policies/${policy.id}`}
        documents={files}
        mayEdit={mayEdit}
        mayUpload={
          mayEdit && can(grants, 'file.upload', policy.entityId ?? undefined)
        }
        what="The policy's text"
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">What it governs</h2>
        {activities.length + aiSystems.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface text-sm">
            {activities.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-3 px-4 py-2"
              >
                <Link
                  href={`/app/ropa/${a.id}`}
                  className="hover:text-brand"
                >
                  <span className="font-mono text-xs text-ink-soft">
                    {a.reference}
                  </span>{' '}
                  {a.name}
                </Link>
                {mayEdit ? (
                  <EditForm
                    action={unlinkPolicyAction.bind(
                      null,
                      policy.id,
                      'activity',
                      a.id
                    )}
                  >
                    <button
                      type="submit"
                      className="text-xs text-ink-soft hover:text-brand"
                    >
                      Unlink
                    </button>
                  </EditForm>
                ) : null}
              </li>
            ))}
            {aiSystems.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-3 px-4 py-2"
              >
                <Link
                  href={`/app/ai/${a.id}`}
                  className="hover:text-brand"
                >
                  AI system: {a.name}
                </Link>
                {mayEdit ? (
                  <EditForm
                    action={unlinkPolicyAction.bind(
                      null,
                      policy.id,
                      'ai_system',
                      a.id
                    )}
                  >
                    <button
                      type="submit"
                      className="text-xs text-ink-soft hover:text-brand"
                    >
                      Unlink
                    </button>
                  </EditForm>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">
            Not linked to any processing activity or AI system.
          </p>
        )}
        {options && options.activity.length + options.ai_system.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(['activity', 'ai_system'] as const).map((kind) =>
              options[kind].length > 0 ? (
                <EditForm
                  key={kind}
                  action={linkPolicyAction.bind(null, policy.id)}
                  className="flex items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="kind"
                    value={kind}
                  />
                  <label className="block flex-1 space-y-1">
                    <Label
                      text={
                        kind === 'activity'
                          ? 'Link a processing activity'
                          : 'Link an AI system'
                      }
                    />
                    <select
                      name="targetId"
                      className={inputClass}
                    >
                      {options[kind].map((o) => (
                        <option
                          key={o.id}
                          value={o.id}
                        >
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className={button}
                  >
                    Link
                  </button>
                </EditForm>
              ) : null
            )}
          </div>
        ) : null}
      </section>

      {mayEdit ? (
        <>
          <EditForm
            saved={savedKey(policy)}
            action={updatePolicyAction.bind(null, policy.id)}
            className="space-y-4 rounded border border-line bg-surface p-5"
          >
            <h2 className="text-sm font-semibold">Change its details</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 sm:col-span-2">
                <Label text="Title" />
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={policy.title}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <Label text="What it is for" />
                <textarea
                  name="summary"
                  rows={2}
                  maxLength={4000}
                  defaultValue={policy.summary ?? ''}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="Owner" />
                <select
                  name="ownerId"
                  defaultValue={policy.ownerId ?? ''}
                  className={inputClass}
                >
                  <option value="">Nobody yet</option>
                  {members.map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                    >
                      {m.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <Label
                  text="Reviewed every"
                  hint="Months. Applies from the next approval or review."
                />
                <input
                  name="reviewIntervalMonths"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={policy.reviewIntervalMonths}
                  className={inputClass}
                />
              </label>
            </div>
            <button
              type="submit"
              className={primary}
            >
              Save
            </button>
          </EditForm>

          {policy.status === 'in_force' ? (
            <EditForm
              action={reviewPolicyAction.bind(null, policy.id)}
              className="flex flex-wrap items-end gap-3 rounded border border-line bg-surface p-5"
            >
              <label className="block space-y-1">
                <Label
                  text="Record a review"
                  hint="Read again and still right, unchanged. Blank for today. A change is a new version."
                />
                <input
                  type="date"
                  name="reviewedAt"
                  className={inputClass}
                />
              </label>
              <button
                type="submit"
                className={button}
              >
                Reviewed
              </button>
            </EditForm>
          ) : null}

          <EditForm
            action={withdrawPolicyAction.bind(null, policy.id)}
            className="space-y-2 rounded border border-line bg-surface p-5"
          >
            <label className="block space-y-1">
              <Label
                text="Withdraw it"
                hint="When it no longer applies. It is kept, with its versions; a version still in draft or waiting for approval is closed."
              />
              <input
                name="reason"
                required
                maxLength={4000}
                placeholder="Replaced by the group information security policy"
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              className="rounded border border-red-800 px-4 py-2 text-sm text-red-900 hover:bg-red-50"
            >
              Withdraw
            </button>
          </EditForm>
        </>
      ) : null}
    </main>
  );
}
