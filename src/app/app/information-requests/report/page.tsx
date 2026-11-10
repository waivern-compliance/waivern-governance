import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { percent, type Timeliness } from '@/lib/foi/report';
import { REGIME } from '@/lib/foi/statutory';
import { can } from '@/lib/rbac';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import { foiReport } from '@/services/foi-reporting';

import { inputClass } from '../fields';

export const dynamic = 'force-dynamic';

const cell = 'py-1.5 pr-3';
const num = `${cell} text-right tabular-nums`;

/**
 * The figures an authority publishes about its freedom of information
 * requests, for a year or a quarter. Counts only: no requester appears.
 */
export default async function InformationRequestsReport({
  searchParams
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!can(active.membership.grants, 'foi.handle')) {
    return (
      <NotPermitted
        what="The figures for freedom of information requests"
        organisationName={active.membership.organisationName}
      />
    );
  }

  const { period: periodKey } = await searchParams;
  const entityIds = visibleEntityIds(active, 'foi.handle');
  const { period, periods, figures } = await foiReport(
    active.membership.organisationId,
    entityIds,
    periodKey
  );
  const f = figures;
  const notRecorded = f.outcomes.find((o) => o.outcome === null)?.count ?? 0;

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-6 py-12">
      <header className="space-y-3 border-b border-line pb-6">
        <Link
          href="/app/information-requests"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Freedom of information requests
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Figures for {period.label}
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          The requests received in {period.label}
          {entityIds === null ? '' : ', for your entities'}, followed through to
          their response, review and any case before the regulator. These are
          the figures authorities publish and the regulators ask about. No
          requester is named.
        </p>
        <form
          method="get"
          className="flex flex-wrap items-end gap-2"
        >
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Period</span>
            <select
              name="period"
              defaultValue={period.key}
              className={inputClass}
            >
              {periods.map((p) => (
                <option
                  key={p.key}
                  value={p.key}
                >
                  {p.key.includes('Q') ? `  ${p.label}` : p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded border border-line bg-surface px-3 py-2 text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
          >
            Show
          </button>
        </form>
      </header>

      <HelpLink topic="information-requests" />

      {f.total.received === 0 ? (
        <p className="text-sm text-ink-soft">
          No requests were received in {period.label}.
        </p>
      ) : (
        <>
          <Section
            title="Answered in time"
            hint="In time means by the deadline the law sets, including any extension it allows. The rate counts only requests whose time has run: answered, or still open and overdue."
          >
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-soft">
                <tr>
                  <th className={`${cell} font-medium`}>Under</th>
                  <th className={`${num} font-medium`}>Received</th>
                  <th className={`${num} font-medium`}>In time</th>
                  <th className={`${num} font-medium`}>Late</th>
                  <th className={`${num} font-medium`}>Overdue now</th>
                  <th className={`${num} font-medium`}>In progress</th>
                  <th className={`${num} font-medium`}>No response owed</th>
                  <th className={`${num} font-medium`}>Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {f.byRegime.map((r) => (
                  <TimelinessRow
                    key={r.regime}
                    label={<abbr title={r.label}>{r.short}</abbr>}
                    t={r}
                  />
                ))}
                {f.byRegime.length > 1 ? (
                  <TimelinessRow
                    label={<span className="font-medium">All requests</span>}
                    t={f.total}
                  />
                ) : null}
              </tbody>
            </table>
            {f.byRegime.length > 1 ? (
              <p className="text-xs text-ink-soft">
                A request under both an Act and its environmental regulations is
                counted under each, and once in all requests.
              </p>
            ) : null}
          </Section>

          <Section
            title="What the responses came to"
            hint="For the requests answered so far."
          >
            <table className="w-full max-w-md text-left text-sm">
              <tbody className="divide-y divide-line">
                {f.outcomes.map((o) => (
                  <tr key={o.label}>
                    <td className={cell}>{o.label}</td>
                    <td className={num}>{o.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {notRecorded > 0 ? (
              <p className="text-xs text-amber-900">
                {notRecorded === 1
                  ? '1 response was recorded before the outcome was asked for. Record it on the request to complete these figures.'
                  : `${notRecorded} responses were recorded before the outcome was asked for. Record it on each request to complete these figures.`}
              </p>
            ) : null}
          </Section>

          <Section
            title="Exemptions, exceptions and refusals relied on"
            hint="How many requests each was relied on in. A request can rely on more than one."
          >
            {f.refusals.length === 0 ? (
              <p className="text-sm text-ink-soft">
                None: nothing was refused.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-ink-soft">
                  <tr>
                    <th className={`${cell} font-medium`}>Under</th>
                    <th className={`${cell} font-medium`}>Provision</th>
                    <th className={`${cell} font-medium`}>What it covers</th>
                    <th className={`${num} font-medium`}>Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {f.refusals.map((r) => (
                    <tr key={`${r.regime}|${r.provision}`}>
                      <td className={cell}>
                        {r.regime ? REGIME[r.regime].short : '-'}
                      </td>
                      <td className={`${cell} whitespace-nowrap`}>
                        {r.provision}
                      </td>
                      <td className={cell}>{r.label}</td>
                      <td className={num}>{r.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Reviews"
            hint="Reviews of these requests, whenever they were asked for."
          >
            {f.reviews.requested === 0 ? (
              <p className="text-sm text-ink-soft">None was asked for.</p>
            ) : (
              <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <Figure
                  label="Asked for"
                  value={f.reviews.requested}
                />
                <Figure
                  label="Decided in time"
                  value={f.reviews.decidedInTime}
                />
                <Figure
                  label="Decided late"
                  value={f.reviews.decidedLate}
                />
                <Figure
                  label="Overdue now"
                  value={f.reviews.overdue}
                />
                <Figure
                  label="Still open"
                  value={f.reviews.open}
                />
                <Figure
                  label="Withdrawn"
                  value={f.reviews.withdrawn}
                />
                <Figure
                  label="Original decision upheld"
                  value={f.reviews.upheld}
                />
                <Figure
                  label="Varied"
                  value={f.reviews.varied}
                />
                <Figure
                  label="Reversed"
                  value={f.reviews.reversed}
                />
                <Figure
                  label="Declined as too late"
                  value={f.reviews.declined}
                />
              </dl>
            )}
          </Section>

          <Section
            title="Before the regulator"
            hint="Cases about these requests, whenever they happened."
          >
            <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <Figure
                label="Applications"
                value={f.regulator.applications}
              />
              <Figure
                label="Decision notices"
                value={f.regulator.decisionNotices}
              />
              <Figure
                label="Appeals lodged"
                value={f.regulator.appeals}
              />
            </dl>
          </Section>
        </>
      )}

      <p className="text-xs text-ink-soft">
        Each request, with its dates, decisions and outcome, is in the{' '}
        <Link
          href="/app/exports"
          className="text-brand underline"
        >
          freedom of information export
        </Link>
        .
      </p>
    </main>
  );
}

function TimelinessRow({ label, t }: { label: ReactNode; t: Timeliness }) {
  return (
    <tr>
      <td className={cell}>{label}</td>
      <td className={num}>{t.received}</td>
      <td className={num}>{t.inTime}</td>
      <td className={num}>{t.late}</td>
      <td className={`${num} ${t.overdue > 0 ? 'text-red-800' : ''}`}>
        {t.overdue}
      </td>
      <td className={num}>{t.inProgress}</td>
      <td className={num}>{t.noResponseOwed}</td>
      <td className={`${num} font-medium`}>{percent(t.inTimeRate)}</td>
    </tr>
  );
}

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-prose text-sm text-ink-soft">{hint}</p>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
