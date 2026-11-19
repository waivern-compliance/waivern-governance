import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { EditForm } from '@/components/EditForm';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { db, scoped } from '@/db/client';
import { entities } from '@/db/schema';
import { SCOPE_KIND_LABEL } from '@/lib/cyber-essentials/scope-checks';
import { can } from '@/lib/rbac';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import {
  cyberEssentialsEnabled,
  scopeRegister
} from '@/services/cyber-essentials';
import { candidatesFor } from '@/services/handover';

import { inputClass, Label } from '../requests/fields';
import { createScopeAction } from './actions';
import { ScopeFields } from './ScopeFields';

/**
 * Cyber Essentials: the organisation's certification scopes. Reached only
 * once an owner has turned it on; the requirements stay open to everyone.
 */
export default async function CyberEssentialsPage() {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!can(active.membership.grants, 'record.read')) {
    return (
      <NotPermitted
        what="Cyber Essentials"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const org = active.membership.organisationId;
  const enabled = await cyberEssentialsEnabled(org);

  const header = (
    <header className="space-y-2 border-b border-line pb-6">
      <Link
        href="/app"
        className="text-xs text-ink-soft hover:text-brand"
      >
        ← {active.membership.organisationName}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">
        Cyber Essentials
      </h1>
      <p className="max-w-prose text-sm text-ink-soft">
        The government-backed certification against five technical controls. A
        scope says what one certificate covers: its legal entities, and the
        devices, servers and cloud services from the information asset register
        that are in it or left out. It is a scheme an organisation chooses, or a
        contract asks for, not a legal duty.
      </p>
      <p className="text-sm">
        <Link
          href="/app/cyber-essentials/requirements"
          className="text-brand hover:underline"
        >
          The requirements, by edition →
        </Link>
      </p>
    </header>
  );

  if (!enabled)
    return (
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
        {header}
        <p className="max-w-prose text-sm">
          Cyber Essentials is not turned on for this organisation.{' '}
          {can(active.membership.grants, 'org.manage') ? (
            <>
              Turn it on in the{' '}
              <Link
                href="/app/admin/organisation"
                className="text-brand hover:underline"
              >
                organisation settings
              </Link>{' '}
              to define what a certificate will cover.
            </>
          ) : (
            'An owner can turn it on in the organisation settings.'
          )}
        </p>
        <HelpLink topic="cyber-essentials" />
      </main>
    );

  const [rows, orgEntities, members] = await Promise.all([
    scopeRegister(org, visibleEntityIds(active)),
    scoped(org, () =>
      db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(eq(entities.organisationId, org))
        .orderBy(asc(entities.name))
    ),
    candidatesFor(org)
  ]);
  const writable = orgEntities.filter((e) =>
    can(active.membership.grants, 'record.write', e.id)
  );

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      {header}
      <HelpLink topic="cyber-essentials" />

      <section className="space-y-3">
        <h2 className="border-b border-line pb-2 text-lg font-semibold">
          Scopes
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No scope yet. Add one for each certificate you hold or will apply
            for.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded border border-line bg-surface">
            {rows.map((r) => (
              <li
                key={r.scope.id}
                className="space-y-1 px-4 py-3"
              >
                <Link
                  href={`/app/cyber-essentials/scopes/${r.scope.id}`}
                  className="text-sm font-medium hover:text-brand"
                >
                  {r.scope.reference} {r.scope.name}
                </Link>
                <p className="text-xs text-ink-soft">
                  {SCOPE_KIND_LABEL[r.scope.kind]} · {r.entityName} ·{' '}
                  {r.scope.edition} · {r.inScope} in scope, {r.outOfScope} left
                  out · {r.ownerEmail ?? 'no owner'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {writable.length > 0 ? (
        <EditForm
          action={createScopeAction}
          className="space-y-4 rounded border border-line bg-surface p-5"
        >
          <h2 className="text-sm font-semibold">Add a scope</h2>
          <label className="block space-y-1">
            <Label
              text="Home entity"
              hint="Who may open and change the scope follows from it. It is always covered."
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
          <ScopeFields
            entities={orgEntities}
            members={members}
          />
          <button
            type="submit"
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Add the scope
          </button>
        </EditForm>
      ) : null}
    </main>
  );
}
