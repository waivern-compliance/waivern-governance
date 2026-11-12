import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { EditForm } from '@/components/EditForm';
import { EprivacyScopeField } from '@/components/EprivacyScopeField';
import { EprivacyScopeNote } from '@/components/EprivacyScopeNote';
import { NotPermitted } from '@/components/NotPermitted';
import {
  BANNER_CHECK_KEYS,
  BANNER_CHECKS,
  CONSENT_RENEWAL_LIMIT_MONTHS,
  suggestedIrishBasis
} from '@/lib/ie-eprivacy/storage';
import { RESCAN_INTERVALS, rescanState } from '@/lib/pecr/rescan';
import { BASES, suggestedBasis } from '@/lib/pecr/statutory';
import { can } from '@/lib/rbac';
import { savedKey } from '@/lib/saved-key';
import { getActiveSession } from '@/lib/session';
import { analyserSettings } from '@/services/consent-analyser';
import { ITEM_KINDS, loadProperty } from '@/services/storage-inventory';

import { ActionForm } from '../../requests/ActionForm';
import { inputClass, Label, stamp } from '../../requests/fields';
import {
  addItemAction,
  checkScanAction,
  decideBasisAction,
  decideProposalAction,
  startScanAction,
  updateItemAction,
  updatePropertyAction,
  uploadReportAction
} from '../actions';
import { BasisForm } from '../BasisForm';
import { LatestScan, ScanHistory } from '../ScanReport';
import { ScanStatus } from '../ScanStatus';
import { UploadReport } from '../UploadReport';

const KIND_LABEL: Record<string, string> = {
  cookie: 'Cookie',
  local_storage: 'Local storage',
  session_storage: 'Session storage',
  pixel: 'Pixel',
  sdk: 'App SDK',
  other: 'Other'
};

/**
 * What the last scan saw of an item, and whether that is a problem for the
 * basis recorded. Strictly necessary items may be set before any choice and
 * stay after Reject; anything else should do neither.
 */
function sightings(
  o: { seenBeforeConsent: boolean | null; seenAfterReject: boolean | null },
  basis: string | null
) {
  const exempt = basis === 'strictly_necessary';
  const out: Array<{ text: string; problem: boolean }> = [];
  if (o.seenBeforeConsent)
    out.push({ text: 'set before any choice', problem: !exempt });
  if (o.seenAfterReject)
    out.push({ text: 'still there after Reject', problem: !exempt });
  if (out.length === 0 && o.seenBeforeConsent === false)
    out.push({ text: 'only after Accept', problem: false });
  return out;
}

function Sightings({
  list,
  note
}: {
  list: ReturnType<typeof sightings>;
  note?: string;
}) {
  if (list.length === 0) return null;
  return (
    <span className="block text-xs">
      <span className="text-ink-soft">Last scan: </span>
      {list.map((x, i) => (
        <span
          key={x.text}
          className={x.problem ? 'text-red-800' : 'text-ink-soft'}
        >
          {i > 0 ? '; ' : ''}
          {x.text}
        </span>
      ))}
      {note ? <span className="text-ink-soft"> ({note})</span> : null}
    </span>
  );
}

const save =
  'rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

const LAW_SHORT: Record<'uk' | 'ie', string> = {
  uk: 'PECR',
  ie: 'Irish'
};
const LAW_LONG: Record<'uk' | 'ie', string> = {
  uk: 'UK PECR',
  ie: 'the Irish Regulations'
};

export default async function PropertyPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const loaded = await loadProperty(id, active.membership.organisationId);
  if (!loaded) notFound();
  const {
    property,
    entityName,
    entityEprivacy,
    scope,
    irishPropertyGaps,
    lifespanThresholdMonths,
    ownerEmail,
    items,
    gapSummary,
    rescanDueAt,
    scans,
    proposals,
    suppliers
  } = loaded;
  if (!can(active.membership.grants, 'record.read', property.entityId)) {
    return (
      <NotPermitted
        what={`${property.reference} is a website's cookie inventory, and`}
        organisationName={active.membership.organisationName}
      />
    );
  }
  const mayWrite = can(
    active.membership.grants,
    'record.write',
    property.entityId
  );
  const analyser = await analyserSettings(active.membership.organisationId);
  const running = scans.find((s) => s.status === 'running');
  const latestScan = scans.find((s) => s.status === 'done') ?? null;
  const inUse = items.filter((i) => i.status === 'active');
  // The laws each item's basis is recorded under: PECR, the Irish
  // Regulations, or both. Read as PECR where no ePrivacy law reaches it.
  const laws: Array<'uk' | 'ie'> =
    scope === 'ie' ? ['ie'] : scope === 'uk_ie' ? ['uk', 'ie'] : ['uk'];
  const irish = laws.includes('ie');
  const retired = items.filter((i) => i.status !== 'active');
  const rescan = rescanState(rescanDueAt);

  return (
    <main className="mx-auto max-w-4xl space-y-9 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/cookies"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Cookies and similar technologies
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-sm text-ink-soft">
            {property.reference}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {property.name}
          </h1>
        </div>
        <p className="break-all text-xs text-ink-soft">
          {property.url} · {entityName} · {property.kind}
          {property.cmp ? ` · consent platform: ${property.cmp}` : ''}
          {ownerEmail ? ` · owned by ${ownerEmail}` : ''}
        </p>
        <p className="text-xs text-ink-soft">
          {inUse.length} in use ·{' '}
          {
            inUse.filter((i) =>
              laws.some((l) => !(l === 'ie' ? i.irishDecision : i.decision))
            ).length
          }{' '}
          with no basis · {inUse.filter((i) => i.gaps.length > 0).length} with
          gaps ·{' '}
          {property.lastScannedAt
            ? `last scanned ${stamp(property.lastScannedAt)}`
            : 'never scanned'}
          {rescanDueAt ? (
            <span
              className={
                rescan === 'overdue'
                  ? 'text-red-800'
                  : rescan === 'due_soon'
                    ? 'text-amber-900'
                    : ''
              }
            >
              {' '}
              · next scan {rescan === 'overdue' ? 'overdue since' : 'due'}{' '}
              {rescanDueAt.toISOString().slice(0, 10)}
            </span>
          ) : (
            ' · no rescan reminders'
          )}
        </p>
      </header>

      {gapSummary.length > 0 ? (
        <section
          className="space-y-1.5 rounded border border-amber-700 bg-amber-50 p-4"
          aria-label="What the record does not yet show"
        >
          <h2 className="text-sm font-semibold text-amber-900">
            What the record does not yet show
          </h2>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {gapSummary.map((g) => (
              <li key={g.kind}>{g.text}</li>
            ))}
          </ul>
        </section>
      ) : inUse.length > 0 ? (
        <p className="text-sm text-emerald-900">
          Every item in use has a basis, and nothing is missing from the record.
        </p>
      ) : null}

      <LatestScan scan={latestScan}>
        {running ? (
          <div className="w-full">
            <ScanStatus
              key={running.id}
              check={checkScanAction.bind(null, running.id, property.id)}
              startedAt={running.startedAt.toISOString()}
            />
          </div>
        ) : property.kind === 'website' && mayWrite && analyser.configured ? (
          <ActionForm
            action={startScanAction.bind(null, property.id)}
            submit={latestScan ? 'Scan again now' : 'Scan now'}
            pendingLabel="Starting…"
          >
            {scope === 'uk_ie' ? (
              <label className="block space-y-1 text-xs">
                <span className="text-ink-soft">Scan as a visitor from</span>
                <select
                  name="region"
                  defaultValue="uk"
                  className="rounded border border-line bg-ground px-2 py-1 text-xs"
                >
                  <option value="uk">The UK, for PECR</option>
                  <option value="eu">The EU, for the Irish Regulations</option>
                </select>
              </label>
            ) : null}
            <span className="block max-w-xs text-[11px] text-ink-soft">
              {scope === 'ie'
                ? 'From the EU, where its visitors are.'
                : scope === 'uk_ie'
                  ? 'A banner can differ by country: scan from each to check each law.'
                  : 'From the UK where the analyser can.'}{' '}
              Uses one of the token owner&apos;s scan credits; takes one to five
              minutes.
            </span>
          </ActionForm>
        ) : null}
      </LatestScan>

      {proposals.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            Waiting for review ({proposals.length})
          </h2>
          <p className="max-w-prose text-xs text-ink-soft">
            What the scans found that the inventory does not yet reflect.
            Nothing is added, or retired, until somebody agrees. Rejecting needs
            a reason.
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface">
            {proposals.map((p) => {
              const o = p.observed as Record<string, string | boolean | null>;
              return (
                <li
                  key={p.id}
                  className="space-y-2 px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {p.change === 'new' ? 'New: ' : 'No longer seen: '}
                      <span className="font-mono">{String(o.name)}</span>
                    </span>
                    <span className="font-mono text-[11px] text-ink-soft">
                      {o.domain ? String(o.domain) : 'domain unknown'}
                      {o.party ? ` · ${o.party} party` : ''}
                      {o.category
                        ? ` · the analyser calls it ${String(o.category).replace(/_/g, ' ')}`
                        : ''}
                      {o.seenBeforeConsent ? ' · set before any choice' : ''}
                      {o.seenAfterReject ? ' · still there after Reject' : ''}
                    </span>
                  </div>
                  {mayWrite ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <ActionForm
                        action={decideProposalAction.bind(
                          null,
                          p.id,
                          property.id,
                          true
                        )}
                        submit="Accept"
                        className="space-y-2"
                      >
                        <span className="sr-only">Accept {String(o.name)}</span>
                      </ActionForm>
                      <ActionForm
                        action={decideProposalAction.bind(
                          null,
                          p.id,
                          property.id,
                          false
                        )}
                        submit="Reject"
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input
                          name="note"
                          placeholder="Why it is wrong"
                          className="rounded border border-line bg-ground px-3 py-2 text-sm"
                        />
                      </ActionForm>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">In use ({inUse.length})</h2>
        {inUse.length === 0 ? (
          <p className="rounded border border-line bg-surface px-4 py-5 text-sm text-ink-soft">
            Nothing on the inventory yet. Upload a report, or add an item by
            hand.
          </p>
        ) : null}
        {inUse.map((item) => {
          const suggested = suggestedBasis(item.suggestedCategory);
          const bases = laws.map(
            (l) => (l === 'ie' ? item.irishDecision : item.decision)?.basis
          );
          const decided = bases.every(Boolean);
          // Expected to be seen before a choice only where every law it
          // answers to has it as strictly necessary.
          const exempt = bases.every((b) => b === 'strictly_necessary');
          return (
            <details
              key={item.id}
              className="rounded border border-line bg-surface"
              open={!decided || item.gaps.length > 0}
            >
              <summary className="cursor-pointer space-y-1 px-4 py-3">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    <span className="font-mono">{item.name}</span>{' '}
                    <span className="text-xs font-normal text-ink-soft">
                      {KIND_LABEL[item.kind] ?? item.kind}
                    </span>
                  </span>
                  <span
                    className={`text-xs font-medium ${!decided || item.gaps.length ? 'text-amber-900' : 'text-emerald-900'}`}
                  >
                    {laws
                      .map((l) => {
                        const d =
                          l === 'ie' ? item.irishDecision : item.decision;
                        const said = d
                          ? BASES[d.basis].label
                          : 'No basis recorded yet';
                        return laws.length > 1
                          ? `${LAW_SHORT[l]}: ${said}`
                          : said;
                      })
                      .join(' · ')}
                    {item.gaps.length
                      ? ` · ${item.gaps.length} thing${item.gaps.length === 1 ? '' : 's'} missing`
                      : decided
                        ? ' · nothing missing'
                        : ''}
                  </span>
                </span>
                <span className="block text-xs text-ink-soft">
                  {item.party === 'first'
                    ? 'First party'
                    : item.party === 'third'
                      ? 'Third party'
                      : 'Party not known'}
                  {item.domain ? `, set on ${item.domain}` : ''}
                  {item.expiry ? ` · lasts ${item.expiry}` : ''}
                  {item.suggestedCategory
                    ? ` · the analyser calls it ${item.suggestedCategory.replace(/_/g, ' ')}`
                    : ''}
                  {item.source === 'manual' ? ' · added by hand' : ''}
                </span>
                <Sightings
                  list={sightings(
                    item,
                    exempt ? 'strictly_necessary' : (bases[0] ?? null)
                  )}
                  note={
                    exempt && (item.seenBeforeConsent || item.seenAfterReject)
                      ? 'expected for strictly necessary'
                      : undefined
                  }
                />
              </summary>
              <div className="space-y-3 border-t border-line px-4 py-3">
                {item.gaps.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
                    {item.gaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                ) : null}
                {item.history.length > 0 ? (
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                    Basis recorded
                  </h3>
                ) : null}
                {item.history.length > 0 ? (
                  <ul className="space-y-1.5">
                    {item.history.map((d) => (
                      <li
                        key={d.id}
                        className="text-xs"
                      >
                        <span className="font-medium">
                          {laws.length > 1 ? `${LAW_SHORT[d.law]}: ` : ''}
                          {BASES[d.basis].label}
                        </span>{' '}
                        <span className="font-mono text-ink-soft">
                          {d.statutoryBasis}
                        </span>{' '}
                        - {d.rationale}{' '}
                        <span className="font-mono text-[11px] text-ink-soft">
                          {d.decidedByEmail ?? d.decidedByLabel} ·{' '}
                          {stamp(d.decidedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <EditForm
                  key={savedKey(item)}
                  action={updateItemAction.bind(null, item.id, property.id)}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <label className="block space-y-1 sm:col-span-2">
                    <Label text="What it is for" />
                    <input
                      name="purpose"
                      defaultValue={item.purpose ?? ''}
                      disabled={!mayWrite}
                      className={inputClass}
                    />
                  </label>
                  <label className="block space-y-1">
                    <Label
                      text="Who receives it"
                      hint="Where a supplier collects what it holds."
                    />
                    <select
                      name="supplierId"
                      defaultValue={item.supplierId ?? ''}
                      disabled={!mayWrite}
                      className={inputClass}
                    >
                      <option value="">Nobody outside the organisation</option>
                      {suppliers.map((s) => (
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
                    <Label text="Party" />
                    <select
                      name="party"
                      defaultValue={item.party}
                      disabled={!mayWrite}
                      className={inputClass}
                    >
                      <option value="first">First party</option>
                      <option value="third">Third party</option>
                      <option value="unknown">Not known</option>
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <Label text="Lasts" />
                    <input
                      name="expiry"
                      defaultValue={item.expiry ?? ''}
                      disabled={!mayWrite}
                      className={inputClass}
                    />
                  </label>
                  <label className="block space-y-1">
                    <Label text="Still used?" />
                    <select
                      name="status"
                      defaultValue="active"
                      disabled={!mayWrite}
                      className={inputClass}
                    >
                      <option value="active">In use</option>
                      <option value="removed">Removed from the site</option>
                    </select>
                  </label>
                  {mayWrite ? (
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        className={save}
                      >
                        Save
                      </button>
                    </div>
                  ) : null}
                </EditForm>
                {mayWrite
                  ? laws.map((l) => {
                      const current =
                        l === 'ie' ? item.irishDecision : item.decision;
                      const form = (
                        <BasisForm
                          action={decideBasisAction.bind(
                            null,
                            item.id,
                            property.id
                          )}
                          current={current?.basis ?? null}
                          suggested={
                            l === 'ie'
                              ? suggestedIrishBasis(item.suggestedCategory)
                              : suggested
                          }
                          law={l}
                        />
                      );
                      const under =
                        laws.length > 1 ? ` under ${LAW_LONG[l]}` : '';
                      return current ? (
                        <details
                          key={l}
                          className="border-t border-line pt-3"
                        >
                          <summary className="cursor-pointer text-xs font-medium text-brand">
                            Record a different basis{under}
                          </summary>
                          {form}
                        </details>
                      ) : (
                        <div key={l}>
                          {under ? (
                            <h3 className="pt-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">
                              The basis{under}
                            </h3>
                          ) : null}
                          {form}
                        </div>
                      );
                    })
                  : null}
              </div>
            </details>
          );
        })}
      </section>

      {mayWrite ? (
        <details className="rounded border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Add an item by hand
          </summary>
          <ActionForm
            action={addItemAction.bind(null, property.id)}
            submit="Add it"
            className="space-y-3 border-t border-line p-4"
          >
            <p className="max-w-prose text-xs text-ink-soft">
              For what a scan cannot see: an app SDK, a cookie set only after
              signing in, a pixel in an email. Items added by hand are never
              proposed as no longer seen.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <Label text="Name" />
                <input
                  name="name"
                  required
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="Kind" />
                <select
                  name="kind"
                  defaultValue="cookie"
                  className={inputClass}
                >
                  {ITEM_KINDS.map((k) => (
                    <option
                      key={k}
                      value={k}
                    >
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <Label text="Domain" />
                <input
                  name="domain"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="Party" />
                <select
                  name="party"
                  defaultValue="unknown"
                  className={inputClass}
                >
                  <option value="first">First party</option>
                  <option value="third">Third party</option>
                  <option value="unknown">Not known</option>
                </select>
              </label>
              <label className="block space-y-1">
                <Label text="Lasts" />
                <input
                  name="expiry"
                  placeholder="session, 13 months"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="What it is for" />
                <input
                  name="purpose"
                  className={inputClass}
                />
              </label>
            </div>
          </ActionForm>
        </details>
      ) : null}

      {retired.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            No longer in use ({retired.length})
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface text-xs">
            {retired.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap justify-between gap-2 px-4 py-2"
              >
                <span className="font-mono">{i.name}</span>
                <span className="text-ink-soft">
                  {i.status === 'removed'
                    ? 'removed'
                    : 'not seen by the last scan'}{' '}
                  · {i.domain ?? 'domain unknown'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <EprivacyScopeNote
        entity={entityEprivacy}
        scope={property.eprivacyScope}
        irishChecked
      />

      {irishPropertyGaps.length > 0 ? (
        <section className="space-y-2 rounded border border-amber-700 bg-amber-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-amber-900">
            Under the Irish Regulations, this website or app does not yet show
          </h2>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
            {irishPropertyGaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <EditForm
        key={savedKey(property)}
        action={updatePropertyAction.bind(null, property.id)}
        className="space-y-3 rounded border border-line bg-surface p-5"
      >
        <h2 className="text-sm font-semibold">
          What people are told, and how they object
        </h2>
        <p className="max-w-prose text-xs text-ink-soft">
          Schedule A1 paragraphs 5 and 6 let statistics and appearance cookies
          be set without consent only if people get clear and comprehensive
          information and a simple, free way to object. Record both once here;
          every such cookie on this site is checked against them.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <Label text="Name" />
            <input
              name="name"
              defaultValue={property.name}
              disabled={!mayWrite}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <Label text="Address" />
            <input
              name="url"
              defaultValue={property.url}
              disabled={!mayWrite}
              className={inputClass}
            />
          </label>
        </div>
        <label className="block space-y-1">
          <Label
            text="Where people are told"
            hint="The cookie notice's address."
          />
          <input
            name="informationUrl"
            type="url"
            defaultValue={property.informationUrl ?? ''}
            disabled={!mayWrite}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <Label
            text="How people object"
            hint="For example: the analytics switch in Cookie settings, linked from every page footer."
          />
          <textarea
            name="objectionMechanism"
            rows={2}
            defaultValue={property.objectionMechanism ?? ''}
            disabled={!mayWrite}
            className={inputClass}
          />
        </label>
        {entityEprivacy === 'uk_ie' && mayWrite ? (
          <EprivacyScopeField
            label={
              <Label
                text="ePrivacy law"
                hint={`${entityName} is under both: which law this one answers to.`}
              />
            }
            defaultValue={property.eprivacyScope}
            inputClass={inputClass}
          />
        ) : null}
        <label className="block space-y-1">
          <Label
            text="Scan it again"
            hint="A reminder is raised a fortnight before each scan is due. Sites change without anyone telling you."
          />
          <select
            name="rescanIntervalMonths"
            defaultValue={
              property.rescanIntervalMonths
                ? String(property.rescanIntervalMonths)
                : ''
            }
            disabled={!mayWrite}
            className={inputClass}
          >
            {RESCAN_INTERVALS.map((m) => (
              <option
                key={m}
                value={m}
              >
                {m === 1
                  ? 'Every month'
                  : m === 12
                    ? 'Every year'
                    : `Every ${m} months`}
              </option>
            ))}
            <option value="">No reminders</option>
          </select>
        </label>
        {irish ? (
          <fieldset className="space-y-3 border-t border-line pt-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Consent under the Irish Regulations
            </legend>
            <input
              type="hidden"
              name="irishAsked"
              value="1"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label
                  text="Consent is asked again after (months)"
                  hint={`The Data Protection Commission's outer limit is ${CONSENT_RENEWAL_LIMIT_MONTHS} months.`}
                />
                <input
                  name="consentRenewalMonths"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={property.consentRenewalMonths ?? ''}
                  disabled={!mayWrite}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="Why longer, if it is"
                  hint={`Needed only over ${CONSENT_RENEWAL_LIMIT_MONTHS} months: the Commission expects a case-by-case justification.`}
                />
                <input
                  name="consentRenewalJustification"
                  defaultValue={property.consentRenewalJustification ?? ''}
                  disabled={!mayWrite}
                  className={inputClass}
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <Label
                text="The banner and consent"
                hint="Tick what is true of this website or app. From the Commission's guidance note on cookies (April 2020)."
              />
              {BANNER_CHECK_KEYS.map((k) => (
                <label
                  key={k}
                  className="flex items-start gap-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="bannerChecks"
                    value={k}
                    defaultChecked={Boolean(property.bannerChecks[k])}
                    disabled={!mayWrite}
                    className="mt-1 accent-brand"
                  />
                  <span>
                    {BANNER_CHECKS[k].label}{' '}
                    <span className="text-xs text-ink-soft">
                      ({BANNER_CHECKS[k].pages})
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="max-w-prose text-xs text-ink-soft">
              A strictly necessary item lasting more than{' '}
              {lifespanThresholdMonths} months is flagged for a check; the
              threshold is set for the organisation on the cookies page.
            </p>
          </fieldset>
        ) : null}
        {mayWrite ? (
          <button
            type="submit"
            className={save}
          >
            Save
          </button>
        ) : null}
      </EditForm>

      {mayWrite ? (
        <section className="space-y-3 rounded border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">
            Upload a Consent Analyser report
          </h2>
          <p className="max-w-prose text-xs text-ink-soft">
            Download the report as JSON from the Waivern Consent Analyser and
            choose it here. Screenshots and cookie values are not kept. New
            items, and items no longer seen, wait below for you to review;
            failing checks are added to Findings.
          </p>
          <UploadReport action={uploadReportAction.bind(null, property.id)} />
        </section>
      ) : null}

      <ScanHistory scans={scans} />
    </main>
  );
}
