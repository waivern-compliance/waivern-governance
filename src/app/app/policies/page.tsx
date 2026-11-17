import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { EditForm } from '@/components/EditForm';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { db, scoped } from '@/db/client';
import { entities, memberships, users } from '@/db/schema';
import { ukLawApplies } from '@/lib/dpa2018/applies';
import { can, scopedEntityIds } from '@/lib/rbac';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import { policyRegister } from '@/services/policies';
import { policyDocumentRegister } from '@/services/policy-documents';

import { inputClass, Label } from '../requests/fields';
import { createPolicyAction } from './actions';

const day = (d: Date) => d.toISOString().slice(0, 10);

const STATUS_WORDS = {
  draft: 'Not yet approved',
  in_force: 'In force',
  withdrawn: 'Withdrawn'
} as const;

export default async function PoliciesPage() {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!can(active.membership.grants, 'record.read')) {
    return (
      <NotPermitted
        what="The policy register"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const org = active.membership.organisationId;
  const grants = active.membership.grants;
  const [rows, orgEntities, members, appropriate] = await Promise.all([
    policyRegister(org, visibleEntityIds(active)),
    scoped(org, () =>
      db
        .select({
          id: entities.id,
          name: entities.name,
          law: entities.dataProtectionLaw
        })
        .from(entities)
        .where(eq(entities.organisationId, org))
        .orderBy(asc(entities.name))
    ),
    scoped(org, () =>
      db
        .select({ id: users.id, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organisationId, org))
        .orderBy(asc(users.email))
    ),
    policyDocumentRegister(org, visibleEntityIds(active))
  ]);
  const organisationWide = scopedEntityIds(grants, 'record.write') === null;
  const writable = orgEntities.filter((e) => can(grants, 'record.write', e.id));
  const current = rows.filter((r) => r.policy.status !== 'withdrawn');
  const withdrawn = rows.filter((r) => r.policy.status === 'withdrawn');
  // Appropriate policy documents are a UK law requirement.
  const showAppropriate =
    appropriate.rows.length > 0 || orgEntities.some((e) => ukLawApplies(e.law));

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← {active.membership.organisationName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
        <p className="max-w-prose text-sm text-ink-soft">
          The organisation&rsquo;s policies, each with the version in force, who
          approved it and where, and when it is next reviewed. A change to what
          a policy says is a new version, approved by somebody other than the
          person who submitted it.
        </p>
      </header>

      <HelpLink topic="policies" />

      {writable.length > 0 || organisationWide ? (
        <details className="rounded border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Add a policy
          </summary>
          <EditForm
            action={createPolicyAction}
            className="space-y-4 border-t border-line p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 sm:col-span-2">
                <Label text="Title" />
                <input
                  name="title"
                  required
                  maxLength={200}
                  placeholder="Information security policy"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <Label
                  text="What it is for"
                  hint="Optional. A sentence or two."
                />
                <textarea
                  name="summary"
                  rows={2}
                  maxLength={4000}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="For" />
                <select
                  name="entityId"
                  className={inputClass}
                  defaultValue={organisationWide ? '' : writable[0]?.id}
                >
                  {organisationWide ? (
                    <option value="">Every entity</option>
                  ) : null}
                  {(organisationWide ? orgEntities : writable).map((e) => (
                    <option
                      key={e.id}
                      value={e.id}
                    >
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <Label text="Owner" />
                <select
                  name="ownerId"
                  className={inputClass}
                  defaultValue={active.userId}
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
                  text="First version"
                  hint="As you number it."
                />
                <input
                  name="versionLabel"
                  defaultValue="1.0"
                  maxLength={40}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="Reviewed every"
                  hint="Months. Most policies are reviewed yearly."
                />
                <input
                  name="reviewIntervalMonths"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={12}
                  className={inputClass}
                />
              </label>
            </div>
            <button
              type="submit"
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add it
            </button>
          </EditForm>
        </details>
      ) : null}

      <ul className="space-y-3">
        {current.map((r) => (
          <PolicyRow
            key={r.policy.id}
            row={r}
          />
        ))}
        {current.length === 0 ? (
          <li className="rounded border border-line bg-surface px-4 py-6 text-sm text-ink-soft">
            None recorded. Add each policy, attach its text, and send it for
            approval.
          </li>
        ) : null}
      </ul>

      {withdrawn.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Withdrawn, and kept</h2>
          <ul className="space-y-3">
            {withdrawn.map((r) => (
              <PolicyRow
                key={r.policy.id}
                row={r}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {showAppropriate ? (
        <section className="space-y-2 border-t border-line pt-6">
          <h2 className="text-sm font-semibold">
            Appropriate policy documents
          </h2>
          <p className="max-w-prose text-sm text-ink-soft">
            The documents the Data Protection Act 2018 requires for most
            Schedule 1 conditions are kept in their own register, with the
            conditions each covers.{' '}
            {appropriate.rows.filter((r) => !r.doc.withdrawnAt).length} in
            force.{' '}
            <Link
              href="/app/policy-documents"
              className="text-brand underline"
            >
              Open the register
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}

function PolicyRow({
  row
}: {
  row: Awaited<ReturnType<typeof policyRegister>>[number];
}) {
  const { policy, entityName, ownerEmail, inForce, inHand, overdue } = row;
  return (
    <li>
      <Link
        href={`/app/policies/${policy.id}`}
        className="block space-y-1.5 rounded border border-line bg-surface p-4 hover:bg-ground focus-visible:outline-2 focus-visible:outline-brand"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-medium">
            <span className="font-mono text-xs text-ink-soft">
              {policy.reference}
            </span>{' '}
            {policy.title}
            {inForce ? (
              <span className="font-normal text-ink-soft">
                {' '}
                · {inForce.label}
              </span>
            ) : null}
          </span>
          <span className="text-xs text-ink-soft">
            {entityName ?? 'Every entity'} · {ownerEmail ?? 'no owner'}
          </span>
        </div>
        <p className="text-xs text-ink-soft">
          {STATUS_WORDS[policy.status]}
          {policy.status === 'withdrawn' && policy.withdrawnAt
            ? ` ${day(policy.withdrawnAt)}`
            : ''}
          {policy.status === 'in_force' && policy.nextReviewAt
            ? ` · next review ${day(policy.nextReviewAt)}`
            : ''}
          {inHand
            ? ` · version ${inHand.label} ${inHand.status === 'submitted' ? 'waiting for approval' : 'in draft'}`
            : ''}
        </p>
        {overdue ? (
          <p className="text-xs text-amber-900">Past its review date</p>
        ) : null}
      </Link>
    </li>
  );
}
