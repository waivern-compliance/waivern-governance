import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { EditForm } from '@/components/EditForm';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { db, scoped } from '@/db/client';
import { entities } from '@/db/schema';
import {
  ASSET_GAP_WORDS,
  ASSET_TYPE_LABEL,
  ASSET_TYPES,
  classificationLabel,
  HOSTING_LABEL,
  levelsOf,
  matchesFilter,
  reviewOverdue,
  type AssetFilter
} from '@/lib/assets/register';
import { can } from '@/lib/rbac';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import { candidatesFor } from '@/services/handover';
import {
  assetRegister,
  classificationSchemeOf,
  type AssetRow
} from '@/services/information-assets';

import { inputClass, Label } from '../requests/fields';
import { createAssetAction } from './actions';
import { AssetFields } from './AssetFields';

const day = (d: Date) => d.toISOString().slice(0, 10);
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AssetsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!can(active.membership.grants, 'record.read')) {
    return (
      <NotPermitted
        what="The information asset register"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const params = await searchParams;
  const filter: AssetFilter = {
    ownerId: one(params.owner),
    classification: one(params.classification),
    assetType: one(params.type),
    overdue: one(params.overdue) === 'on',
    retired: one(params.retired) === 'on'
  };
  const org = active.membership.organisationId;
  const [rows, scheme, orgEntities, activeMembers] = await Promise.all([
    assetRegister(org, visibleEntityIds(active)),
    classificationSchemeOf(org),
    scoped(org, () =>
      db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(eq(entities.organisationId, org))
        .orderBy(asc(entities.name))
    ),
    candidatesFor(org)
  ]);
  // Owners are offered from active members. The filter also offers anyone
  // who still owns an asset after leaving, so their assets can be found.
  const members = [...activeMembers].sort((a, b) =>
    a.email.localeCompare(b.email)
  );
  const owners = [
    ...members,
    ...rows
      .filter(
        (r) =>
          r.asset.ownerId &&
          r.ownerEmail &&
          !members.some((m) => m.id === r.asset.ownerId)
      )
      .map((r) => ({ id: r.asset.ownerId!, email: `${r.ownerEmail} (left)` }))
  ].filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i);
  const writable = orgEntities.filter((e) =>
    can(active.membership.grants, 'record.write', e.id)
  );
  const now = new Date();
  const shown = rows.filter((r) => matchesFilter({ ...r.asset }, filter, now));
  const inUse = rows.filter((r) => !r.asset.retiredAt);
  const overdue = inUse.filter((r) => reviewOverdue(r.asset, now));
  const filtered =
    filter.ownerId ||
    filter.classification ||
    filter.assetType ||
    filter.overdue ||
    filter.retired;

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
          Information asset register
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          The systems and repositories you hold information in - databases, file
          shares, SaaS applications, paper archives, devices - with who owns
          each, where it is hosted, how it is classified and how long what it
          holds is kept. It describes the systems, not their contents, and links
          to the processing, third parties and risks that concern them.
        </p>
        <p className="text-xs text-ink-soft">
          {inUse.length} in use
          {overdue.length > 0 ? ` · ${overdue.length} past review` : ''}
        </p>
      </header>

      <HelpLink topic="information-assets" />

      {writable.length > 0 ? (
        <details className="rounded border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Add an asset
          </summary>
          <EditForm
            action={createAssetAction}
            className="space-y-3 border-t border-line p-4"
          >
            <label className="block space-y-1">
              <Label
                text="Legal entity"
                hint="The entity that holds it."
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
            <AssetFields
              members={members}
              scheme={scheme}
            />
            <button
              type="submit"
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add the asset
            </button>
          </EditForm>
        </details>
      ) : null}

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded border border-line bg-surface p-4"
        aria-label="Filter the register"
      >
        <label className="block space-y-1">
          <Label text="Owner" />
          <select
            name="owner"
            defaultValue={filter.ownerId ?? ''}
            className={inputClass}
          >
            <option value="">Anyone</option>
            <option value="none">Nobody</option>
            {owners.map((m) => (
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
          <Label text="Classification" />
          <select
            name="classification"
            defaultValue={filter.classification ?? ''}
            className={inputClass}
          >
            <option value="">Any</option>
            <option value="none">Not classified</option>
            {levelsOf(scheme).map(([key, label]) => (
              <option
                key={key}
                value={key}
              >
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <Label text="Type" />
          <select
            name="type"
            defaultValue={filter.assetType ?? ''}
            className={inputClass}
          >
            <option value="">Any</option>
            {ASSET_TYPES.map((t) => (
              <option
                key={t}
                value={t}
              >
                {ASSET_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="overdue"
            defaultChecked={filter.overdue}
            className="accent-brand"
          />
          Past review
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="retired"
            defaultChecked={filter.retired}
            className="accent-brand"
          />
          Include retired
        </label>
        <button
          type="submit"
          className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand"
        >
          Filter
        </button>
        {filtered ? (
          <Link
            href="/app/assets"
            className="pb-2 text-xs text-ink-soft hover:text-brand"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <ul className="space-y-3">
        {shown.map((r) => (
          <AssetRowItem
            key={r.asset.id}
            row={r}
          />
        ))}
        {shown.length === 0 ? (
          <li className="rounded border border-line bg-surface px-4 py-6 text-sm text-ink-soft">
            {filtered
              ? 'Nothing matches these filters.'
              : 'None recorded. Add each system or repository that holds information you are responsible for.'}
          </li>
        ) : null}
      </ul>
    </main>
  );
}

function AssetRowItem({ row }: { row: AssetRow }) {
  const { asset, entityName, ownerEmail, gaps } = row;
  return (
    <li>
      <Link
        href={`/app/assets/${asset.id}`}
        className="block space-y-1.5 rounded border border-line bg-surface p-4 hover:bg-ground focus-visible:outline-2 focus-visible:outline-brand"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-ink-soft">
              {asset.reference}
            </span>
            <span className="font-medium">{asset.name}</span>
            <span className="text-xs text-ink-soft">
              {ASSET_TYPE_LABEL[asset.assetType] ?? asset.assetType}
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs text-ink-soft">
            {entityName}
            {asset.classification ? (
              <span className="rounded border border-line px-2 py-0.5 font-mono text-[11px]">
                {classificationLabel(asset.classification)}
              </span>
            ) : null}
            {asset.retiredAt ? (
              <span className="rounded border border-line px-2 py-0.5 font-mono text-[11px]">
                retired {day(asset.retiredAt)}
              </span>
            ) : null}
          </span>
        </div>
        <p className="text-xs text-ink-soft">
          {ownerEmail ?? 'No owner'}
          {asset.hosting ? ` · ${HOSTING_LABEL[asset.hosting]}` : ''}
          {asset.hostedBy ? ` · ${asset.hostedBy}` : ''}
          {asset.nextReviewAt && !asset.retiredAt
            ? ` · review due ${day(asset.nextReviewAt)}`
            : ''}
        </p>
        {gaps.length > 0 ? (
          <p className="text-xs text-amber-900">
            {gaps.map((g) => ASSET_GAP_WORDS[g]).join(' · ')}
          </p>
        ) : null}
      </Link>
    </li>
  );
}
