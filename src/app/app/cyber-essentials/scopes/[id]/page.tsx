import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { EditForm } from '@/components/EditForm';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { StartAssessment } from '@/components/StartAssessment';
import { db, scoped } from '@/db/client';
import { entities } from '@/db/schema';
import { outOfSupport, typeLabel } from '@/lib/assets/types';
import {
  countsSummary,
  editionAnswered,
  readinessOf,
  SIGN_OFF
} from '@/lib/cyber-essentials/readiness';
import { OUT_OF_SCOPE_REASONS } from '@/lib/cyber-essentials/scope';
import {
  isCloudService,
  SCOPE_KIND_LABEL,
  scopeFindings,
  unplacedAssets,
  type ScopeAsset
} from '@/lib/cyber-essentials/scope-checks';
import { can } from '@/lib/rbac';
import { savedKey } from '@/lib/saved-key';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import { CYBER_ESSENTIALS_READINESS_NAME } from '@/lib/templates/library';
import { assetTypology } from '@/services/asset-types';
import {
  cyberEssentialsEnabled,
  loadScope,
  scopeReadiness
} from '@/services/cyber-essentials';
import { candidatesFor } from '@/services/handover';

import { inputClass, Label } from '../../../requests/fields';
import {
  placeAssetAction,
  unplaceAssetAction,
  updateScopeAction
} from '../../actions';
import { ScopeFields } from '../../ScopeFields';

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  OUT_OF_SCOPE_REASONS.map((r) => [r.value, r.label])
);

const button =
  'rounded border border-line px-3 py-2 text-sm hover:border-brand';

/** One certification scope: what it covers, and what stands before assessment. */
export default async function ScopePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const org = active.membership.organisationId;
  if (!(await cyberEssentialsEnabled(org))) redirect('/app/cyber-essentials');
  const loaded = await loadScope(org, id);
  if (!loaded) notFound();
  const { scope, placements, candidates } = loaded;
  if (!can(active.membership.grants, 'record.read', scope.entityId))
    return (
      <NotPermitted
        what="This Cyber Essentials scope"
        organisationName={active.membership.organisationName}
      />
    );
  const mayEdit = can(active.membership.grants, 'record.write', scope.entityId);

  const [types, orgEntities, members, readinessRead] = await Promise.all([
    assetTypology(org),
    scoped(org, () =>
      db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(eq(entities.organisationId, org))
        .orderBy(asc(entities.name))
    ),
    candidatesFor(org),
    scopeReadiness(org, scope.id)
  ]);
  const { submitted, open } = readinessRead;
  // Read against the edition it was answered for, not the scope's current one.
  const answeredFor = submitted?.edition ?? scope.edition;
  const readiness = readinessOf(answeredFor, readinessRead.outcomes);
  const signOff = submitted && SIGN_OFF[submitted.status];
  const mayAssess = can(
    active.membership.grants,
    'assessment.create',
    scope.entityId
  );

  const now = new Date();
  // Judged on every asset, shown only from the entities the reader can open:
  // the scope's home lets them in, not into its other entities' registers.
  const readable = visibleEntityIds(active);
  const shown = (a: Pick<ScopeAsset, 'entityId'>) =>
    readable === null || readable.includes(a.entityId);
  const hidden = candidates.filter((a) => !shown(a)).length;
  const findings = scopeFindings(scope, placements, candidates, now).map(
    (f) => ({ ...f, assets: f.assets.filter(shown) })
  );
  const byId = new Map(candidates.filter(shown).map((a) => [a.id, a]));
  const placed = placements.flatMap((p) => {
    const asset = byId.get(p.assetId);
    return asset ? [{ ...p, asset }] : [];
  });
  const inScope = placed.filter((p) => p.inScope);
  const leftOut = placed.filter((p) => !p.inScope);
  const unplaced = unplacedAssets(placements, candidates).filter(shown);
  const homeChoices = loaded.entities.filter((e) =>
    can(active.membership.grants, 'record.write', e.id)
  );

  const describe = (a: ScopeAsset) =>
    [
      typeLabel(types, a.assetType),
      a.details.quantity ? `${a.details.quantity} of them` : null,
      isCloudService(a) ? 'cloud service' : null,
      outOfSupport(a.details, now) ? 'out of vendor support' : null,
      a.retiredAt ? 'retired' : null
    ]
      .filter(Boolean)
      .join(' · ');

  const row = (p: (typeof placed)[number]) => (
    <li
      key={p.assetId}
      className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm"
    >
      <span className="space-y-0.5">
        <Link
          href={`/app/assets/${p.asset.id}`}
          className="hover:text-brand"
        >
          {p.asset.reference} {p.asset.name}
        </Link>
        <span className="block text-xs text-ink-soft">
          {describe(p.asset)}
          {p.reason ? ` · ${REASON_LABEL[p.reason]}` : ''}
          {p.note ? `: ${p.note}` : ''}
        </span>
      </span>
      {mayEdit ? (
        <EditForm action={unplaceAssetAction.bind(null, scope.id, p.assetId)}>
          <button
            type="submit"
            className="text-xs text-red-900 hover:underline"
          >
            Take off the list
          </button>
        </EditForm>
      ) : null}
    </li>
  );

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/cyber-essentials"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Cyber Essentials
        </Link>
        <p className="font-mono text-xs text-ink-soft">{scope.reference}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{scope.name}</h1>
        <p className="text-sm text-ink-soft">
          {SCOPE_KIND_LABEL[scope.kind]} · covers{' '}
          {loaded.entities.map((e) => e.name).join(', ')} · prepared against{' '}
          <Link
            href={`/app/cyber-essentials/requirements?edition=${scope.edition}`}
            className="text-brand hover:underline"
          >
            requirements {scope.edition}
          </Link>
        </p>
      </header>

      <HelpLink topic="cyber-essentials" />

      <section className="space-y-3">
        <h2 className="border-b border-line pb-2 text-lg font-semibold">
          Before assessment
        </h2>
        {findings.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Nothing outstanding in what the scope says.
          </p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f, i) => (
              <li
                key={i}
                className="rounded border border-amber-700 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <p>{f.message}</p>
                {f.assets.length ? (
                  <p className="mt-1 text-xs">
                    {f.assets.map((a) => `${a.reference} ${a.name}`).join(', ')}
                  </p>
                ) : null}
                <p className="mt-1 font-mono text-[11px]">
                  <Link
                    href={`/app/cyber-essentials/requirements?edition=${scope.edition}#${f.code}`}
                    className="hover:underline"
                  >
                    {f.code}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="border-b border-line pb-2 text-lg font-semibold">
          Readiness
        </h2>
        {submitted ? (
          <p className="text-sm">
            <Link
              href={`/app/assessments/${submitted.id}`}
              className="font-mono text-xs text-ink-soft hover:text-brand"
            >
              {submitted.reference}
            </Link>{' '}
            {submitted.scoreBand ?? 'Submitted'}
            {signOff ? ` (${signOff})` : ''}: {countsSummary(readiness.counts)}.{' '}
            <Link
              href={`/app/cyber-essentials/scopes/${scope.id}/readiness`}
              className="text-brand hover:underline"
            >
              Status by requirement
            </Link>
          </p>
        ) : (
          <p className="text-sm text-ink-soft">
            No readiness assessment submitted yet. Its answers give the
            scope&apos;s status against each requirement.
          </p>
        )}
        {submitted && answeredFor !== scope.edition ? (
          <p className="text-sm text-ink-soft">
            Answered against requirements {answeredFor}; the scope is now
            prepared against {scope.edition}, so assess it again.
          </p>
        ) : null}
        {open ? (
          <p className="text-sm">
            {open.status === 'in_review'
              ? 'Awaiting sign-off'
              : 'Being answered'}
            :{' '}
            <Link
              href={`/app/assessments/${open.id}`}
              className="text-brand hover:underline"
            >
              {open.reference}
            </Link>
          </p>
        ) : mayAssess ? (
          <StartAssessment
            organisationId={org}
            subjectType="cyber_scope"
            subjectId={scope.id}
            prefer={CYBER_ESSENTIALS_READINESS_NAME}
            fits={(definition) => editionAnswered(definition) === scope.edition}
            missing={`No readiness template for requirements ${scope.edition} is installed. Govern ships one for v3.3: an owner can install it from the templates page, or change the scope's edition.`}
          />
        ) : null}
      </section>

      {hidden > 0 ? (
        <p className="text-sm text-ink-soft">
          {hidden} assets of covered entities you cannot open are not shown.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="border-b border-line pb-2 text-lg font-semibold">
          In scope ({inScope.length})
        </h2>
        {inScope.length ? (
          <ul className="divide-y divide-line rounded border border-line bg-surface">
            {inScope.map(row)}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">Nothing yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="border-b border-line pb-2 text-lg font-semibold">
          Left out ({leftOut.length})
        </h2>
        {leftOut.length ? (
          <ul className="divide-y divide-line rounded border border-line bg-surface">
            {leftOut.map(row)}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">Nothing left out.</p>
        )}
      </section>

      {mayEdit && unplaced.length > 0 ? (
        <EditForm
          action={placeAssetAction.bind(null, scope.id)}
          className="space-y-3 rounded border border-line bg-surface p-5"
        >
          <h2 className="text-sm font-semibold">Place an asset</h2>
          <p className="max-w-prose text-xs text-ink-soft">
            Assets of the covered entities, from the information asset register.
            Record alike devices as one asset with how many there are. Cloud
            services cannot be left out.
          </p>
          <label className="block space-y-1">
            <Label text="Asset" />
            <select
              name="assetId"
              className={inputClass}
            >
              {unplaced.map((a) => (
                <option
                  key={a.id}
                  value={a.id}
                >
                  {a.reference} {a.name} ({describe(a)})
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex gap-4 text-sm">
            <legend className="sr-only">In or out</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="placement"
                value="in"
                defaultChecked
              />
              In scope
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="placement"
                value="out"
              />
              Left out
            </label>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <Label
                text="Why it is left out"
                hint="Only for an asset left out."
              />
              <select
                name="reason"
                defaultValue=""
                className={inputClass}
              >
                <option value="">Choose</option>
                {OUT_OF_SCOPE_REASONS.map((r) => (
                  <option
                    key={r.value}
                    value={r.value}
                  >
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <Label
                text="Note"
                hint="Needed for any other reason."
              />
              <input
                name="note"
                className={inputClass}
              />
            </label>
          </div>
          <button
            type="submit"
            className={button}
          >
            Place it
          </button>
        </EditForm>
      ) : null}

      {mayEdit ? (
        <EditForm
          saved={savedKey(scope)}
          action={updateScopeAction.bind(null, scope.id)}
          className="space-y-4 rounded border border-line bg-surface p-5"
        >
          <h2 className="text-sm font-semibold">The scope</h2>
          {homeChoices.length > 1 ? (
            <label className="block space-y-1">
              <Label
                text="Home entity"
                hint="Who may open and change the scope follows from it. Move it to another entity the scope covers."
              />
              <select
                name="homeEntityId"
                defaultValue={scope.entityId}
                className={inputClass}
              >
                {homeChoices.map((e) => (
                  <option
                    key={e.id}
                    value={e.id}
                  >
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <ScopeFields
            values={{
              ...scope,
              entityIds: loaded.entities.map((e) => e.id)
            }}
            entities={orgEntities}
            home={scope.entityId}
            members={members}
          />
          <button
            type="submit"
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Save the scope
          </button>
        </EditForm>
      ) : (
        <section className="space-y-2 rounded border border-line bg-surface p-5 text-sm">
          <p>
            <span className="text-ink-soft">Boundary:</span>{' '}
            {scope.boundary ?? 'Not recorded'}
          </p>
          {scope.segregation ? (
            <p>
              <span className="text-ink-soft">Separated by:</span>{' '}
              {scope.segregation}
            </p>
          ) : null}
          <p>
            <span className="text-ink-soft">Left out:</span>{' '}
            {scope.exclusions ?? 'Nothing recorded'}
          </p>
        </section>
      )}
    </main>
  );
}
