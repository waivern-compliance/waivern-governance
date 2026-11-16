import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { EditForm } from '@/components/EditForm';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { db, scoped } from '@/db/client';
import { entities, suppliers } from '@/db/schema';
import { can } from '@/lib/rbac';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import { NOTICE_WORDS } from '@/lib/thirdparty/contracts';
import { contractRegister, type ContractRow } from '@/services/contracts';
import { candidatesFor } from '@/services/handover';

import { inputClass, Label } from '../requests/fields';
import { createContractAction } from './actions';
import { ContractFields, ViewerFields } from './ContractFields';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function ContractsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!can(active.membership.grants, 'record.read')) {
    return (
      <NotPermitted
        what="Supplier contracts"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const preselect = (await searchParams).supplier;
  const org = active.membership.organisationId;
  const [rows, orgEntities, orgSuppliers, members] = await Promise.all([
    contractRegister(org, visibleEntityIds(active), {
      userId: active.userId,
      grants: active.membership.grants
    }),
    scoped(org, () =>
      db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(eq(entities.organisationId, org))
        .orderBy(asc(entities.name))
    ),
    scoped(org, () =>
      db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.organisationId, org))
        .orderBy(asc(suppliers.name))
    ),
    candidatesFor(org)
  ]);
  const people = [...members].sort((a, b) => a.email.localeCompare(b.email));
  const writable = orgEntities.filter((e) =>
    can(active.membership.grants, 'record.write', e.id)
  );
  const attention = rows.filter(
    (r) => r.notice === 'due_soon' || r.notice === 'passed'
  );
  const inForce = rows.filter(
    (r) => !r.contract.endedAt && !attention.includes(r)
  );
  const ended = rows.filter((r) => r.contract.endedAt);

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← {active.membership.organisationName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Supplier contracts
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          Commercial contracts with third parties, each signed by one of your
          legal entities: who owns each, when it ends, and the last day to give
          notice. What a contract is worth, and its signed copy, are shown only
          to the people named on it. Processor agreements under Article 28 stay
          on the third-party register.
        </p>
      </header>

      <HelpLink topic="contracts" />

      {writable.length > 0 && orgSuppliers.length > 0 ? (
        <details
          className="rounded border border-line bg-surface"
          open={typeof preselect === 'string'}
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Add a contract
          </summary>
          <EditForm
            action={createContractAction}
            className="space-y-3 border-t border-line p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label text="Third party" />
                <select
                  name="supplierId"
                  defaultValue={
                    typeof preselect === 'string' ? preselect : undefined
                  }
                  className={inputClass}
                >
                  {orgSuppliers.map((s) => (
                    <option
                      key={s.id}
                      value={s.id}
                    >
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <Label
                  text="Signed by"
                  hint="Our legal entity that is party to it."
                />
                <select
                  name="entityId"
                  className={inputClass}
                >
                  {writable.map((e) => (
                    <option
                      key={e.id}
                      value={e.id}
                    >
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ContractFields
              members={people}
              withTerms
            />
            <ViewerFields
              members={people.filter((m) => m.id !== active.userId)}
              checked={new Set()}
            />
            <button
              type="submit"
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add the contract
            </button>
          </EditForm>
        </details>
      ) : null}

      <Group
        title="Notice due or passed"
        rows={attention}
        empty={null}
      />
      <Group
        title="In force"
        rows={inForce}
        empty={
          rows.length === 0
            ? 'No contract recorded. Add each commercial contract with a third party.'
            : null
        }
      />
      <Group
        title="Ended"
        rows={ended}
        empty={null}
      />
    </main>
  );
}

function Group({
  title,
  rows,
  empty
}: {
  title: string;
  rows: ContractRow[];
  empty: string | null;
}) {
  if (rows.length === 0 && !empty) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        {title} ({rows.length})
      </h2>
      <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface">
        {rows.map((r) => (
          <li key={r.contract.id}>
            <Link
              href={`/app/contracts/${r.contract.id}`}
              className="block space-y-1 px-4 py-3 hover:bg-ground focus-visible:outline-2 focus-visible:outline-brand"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-ink-soft">
                    {r.contract.reference}
                  </span>
                  <span className="font-medium">{r.contract.title}</span>
                </span>
                <span
                  className={`text-xs ${
                    r.notice === 'passed' || r.notice === 'due_soon'
                      ? 'text-amber-900'
                      : 'text-ink-soft'
                  }`}
                >
                  {NOTICE_WORDS[r.notice]}
                  {r.noticeBy && !r.contract.endedAt
                    ? `: notice by ${day(r.noticeBy)}`
                    : ''}
                </span>
              </div>
              <p className="text-xs text-ink-soft">
                {r.supplierName} · {r.entityName} · {r.ownerEmail ?? 'no owner'}
                {r.contract.autoRenews ? ' · renews automatically' : ''}
                {r.termsVisible && r.contract.value
                  ? ` · ${r.contract.currency} ${r.contract.value}`
                  : ''}
              </p>
            </Link>
          </li>
        ))}
        {rows.length === 0 && empty ? (
          <li className="px-4 py-6 text-sm text-ink-soft">{empty}</li>
        ) : null}
      </ul>
    </section>
  );
}
