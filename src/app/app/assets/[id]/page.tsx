import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { EditForm } from '@/components/EditForm';
import { NotPermitted } from '@/components/NotPermitted';
import {
  ASSET_GAP_WORDS,
  ASSET_TYPE_LABEL,
  classificationLabel,
  HOSTING_LABEL
} from '@/lib/assets/register';
import { can } from '@/lib/rbac';
import { savedKey } from '@/lib/saved-key';
import { getActiveSession } from '@/lib/session';
import { candidatesFor } from '@/services/handover';
import {
  classificationSchemeOf,
  linkOptions,
  loadAsset,
  type LinkKind
} from '@/services/information-assets';

import { inputClass, Label } from '../../requests/fields';
import {
  linkAssetAction,
  retireAssetAction,
  reviewAssetAction,
  unlinkAssetAction,
  updateAssetAction
} from '../actions';
import { AssetFields } from '../AssetFields';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const button =
  'rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand';

const LINK_HEADING: Record<LinkKind, string> = {
  activity: 'Processing activities',
  supplier: 'Third parties',
  risk: 'Risks'
};
const LINK_EMPTY: Record<LinkKind, string> = {
  activity:
    'No processing activity linked. Link the activities whose data it holds.',
  supplier: 'No third party linked. Link whoever hosts, runs or supports it.',
  risk: 'No risk linked.'
};

export default async function AssetPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const org = active.membership.organisationId;
  const loaded = await loadAsset(id, org);
  if (!loaded) notFound();
  const { asset, entityName, ownerEmail, gaps } = loaded;
  if (!can(active.membership.grants, 'record.read', asset.entityId)) {
    return (
      <NotPermitted
        what={`${asset.reference} belongs to another part of the organisation, and`}
        organisationName={active.membership.organisationName}
      />
    );
  }
  const mayEdit =
    can(active.membership.grants, 'record.write', asset.entityId) &&
    !asset.retiredAt;

  const [scheme, options, candidates] = await Promise.all([
    classificationSchemeOf(org),
    mayEdit ? linkOptions(org, asset.entityId) : null,
    candidatesFor(org)
  ]);

  // Active members, and the current owner even if they have since left, so
  // saving the form does not quietly take the asset away from them.
  const members = [
    ...candidates,
    ...(asset.ownerId && !candidates.some((m) => m.id === asset.ownerId)
      ? [
          {
            id: asset.ownerId,
            email: `${ownerEmail ?? 'former member'} (left)`
          }
        ]
      : [])
  ].sort((a, b) => a.email.localeCompare(b.email));

  const linked: Record<
    LinkKind,
    Array<{ id: string; href: string; label: string; note?: string }>
  > = {
    activity: loaded.activities.map((a) => ({
      id: a.id,
      href: `/app/ropa/${a.id}`,
      label: `${a.reference} ${a.name}`
    })),
    supplier: loaded.suppliers.map((s) => ({
      id: s.id,
      href: `/app/third-parties/${s.id}`,
      label: s.name
    })),
    risk: loaded.risks.map((k) => ({
      id: k.id,
      href: `/app/risks/${k.id}`,
      label: `${k.reference} ${k.title}`,
      note: [k.status, k.residualTier ?? k.inherentTier]
        .filter(Boolean)
        .join(' · ')
    }))
  };

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/assets"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Information asset register
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-sm text-ink-soft">
            {asset.reference}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {asset.name}
          </h1>
        </div>
        <p className="text-xs text-ink-soft">
          {entityName} · {ASSET_TYPE_LABEL[asset.assetType] ?? asset.assetType}{' '}
          · {ownerEmail ?? 'no owner'}
          {asset.lastReviewedAt
            ? ` · last reviewed ${day(asset.lastReviewedAt)}`
            : ''}
          {asset.nextReviewAt && !asset.retiredAt
            ? ` · review due ${day(asset.nextReviewAt)}`
            : ''}
        </p>
        {asset.retiredAt ? (
          <p className="text-xs">
            Retired {day(asset.retiredAt)}
            {asset.retiredReason ? `: ${asset.retiredReason}` : ''}. It is kept
            as it was.
          </p>
        ) : gaps.length > 0 ? (
          <p className="text-xs text-amber-900">
            {gaps.map((g) => ASSET_GAP_WORDS[g]).join(' · ')}
          </p>
        ) : (
          <p className="text-xs text-emerald-900">Nothing missing</p>
        )}
      </header>

      {mayEdit ? (
        <EditForm
          key={savedKey(asset)}
          action={updateAssetAction.bind(null, asset.id)}
          className="space-y-4 rounded border border-line bg-surface p-5"
        >
          <h2 className="text-sm font-semibold">The asset</h2>
          <AssetFields
            values={asset}
            members={members}
            scheme={scheme}
          />
          <button
            type="submit"
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Save the asset
          </button>
        </EditForm>
      ) : (
        <section className="space-y-2 rounded border border-line bg-surface p-5 text-sm">
          <p>
            <span className="text-ink-soft">What it is for:</span>{' '}
            {asset.description ?? 'Not recorded'}
          </p>
          <p>
            <span className="text-ink-soft">Where:</span>{' '}
            {[
              asset.hosting ? HOSTING_LABEL[asset.hosting] : null,
              asset.hostedBy,
              asset.region,
              asset.countries.join(', ') || null
            ]
              .filter(Boolean)
              .join(' · ') || 'Not recorded'}
          </p>
          <p>
            <span className="text-ink-soft">Classification:</span>{' '}
            {classificationLabel(asset.classification) ?? 'Not classified'}
          </p>
          <p>
            <span className="text-ink-soft">Retention:</span>{' '}
            {asset.retention ?? 'Not recorded'}
          </p>
        </section>
      )}

      {(['activity', 'supplier', 'risk'] as const).map((kind) => {
        const choices = (options?.[kind] ?? []).filter(
          (o) => !linked[kind].some((l) => l.id === o.id)
        );
        return (
          <section
            key={kind}
            className="space-y-2"
          >
            <h2 className="text-sm font-semibold">{LINK_HEADING[kind]}</h2>
            {linked[kind].length === 0 ? (
              <p className="text-sm text-ink-soft">{LINK_EMPTY[kind]}</p>
            ) : (
              <ul className="divide-y divide-line rounded border border-line bg-surface">
                {linked[kind].map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm"
                  >
                    <Link
                      href={l.href}
                      className="hover:text-brand"
                    >
                      {l.label}
                    </Link>
                    <span className="flex items-baseline gap-3">
                      {l.note ? (
                        <span className="font-mono text-[11px] text-ink-soft">
                          {l.note}
                        </span>
                      ) : null}
                      {mayEdit ? (
                        <EditForm
                          action={unlinkAssetAction.bind(
                            null,
                            asset.id,
                            kind,
                            l.id
                          )}
                        >
                          <button
                            type="submit"
                            className="text-xs text-red-900 hover:underline"
                          >
                            Unlink
                          </button>
                        </EditForm>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {mayEdit && choices.length > 0 ? (
              <EditForm
                action={linkAssetAction.bind(null, asset.id, kind)}
                className="flex flex-wrap items-end gap-2"
              >
                <label className="block space-y-1">
                  <Label
                    text={`Link ${kind === 'activity' ? 'an activity' : kind === 'supplier' ? 'a third party' : 'a risk'}`}
                  />
                  <select
                    name="targetId"
                    className={inputClass}
                  >
                    {choices.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                      >
                        {c.label}
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
            ) : null}
          </section>
        );
      })}

      {mayEdit ? (
        <>
          <EditForm
            action={reviewAssetAction.bind(null, asset.id)}
            className="flex flex-wrap items-end gap-3 rounded border border-line bg-surface p-5"
          >
            <label className="block space-y-1">
              <Label text="Reviewed today; next review due" />
              <input
                type="date"
                name="nextReviewAt"
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              className={button}
            >
              Record the review
            </button>
          </EditForm>
          <EditForm
            action={retireAssetAction.bind(null, asset.id)}
            className="space-y-2 rounded border border-line bg-surface p-5"
          >
            <label className="block space-y-1">
              <Label
                text="Retire it"
                hint="When it is decommissioned or replaced. It is kept with its links, and owes no more reviews."
              />
              <input
                name="reason"
                placeholder="Decommissioned; data migrated to IA-2027-0003"
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              className="rounded border border-red-800 px-4 py-2 text-sm text-red-900 hover:bg-red-50"
            >
              Retire the asset
            </button>
          </EditForm>
        </>
      ) : null}
    </main>
  );
}
