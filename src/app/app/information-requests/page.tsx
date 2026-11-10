import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, isNotNull } from 'drizzle-orm';

import { InformationRequestClock } from '@/components/foi/InformationRequestClock';
import { RefusableForm } from '@/components/foi/RefusableForm';
import { HelpLink } from '@/components/help/HelpLink';
import { AppearancePanel } from '@/components/intake/AppearancePanel';
import { EmbedPanel } from '@/components/intake/EmbedPanel';
import { IntakeFormList } from '@/components/intake/IntakeFormList';
import { NotPermitted } from '@/components/NotPermitted';
import { db, scoped } from '@/db/client';
import { entities } from '@/db/schema';
import { REGIME } from '@/lib/foi/statutory';
import { can, mayConfigureInformationRequests } from '@/lib/rbac';
import { requestOrigin } from '@/lib/request-origin';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import { intakeLinksFor } from '@/services/dsr-intake';
import { informationRequestRegister } from '@/services/information-requests';

import {
  issueFoiFormAction,
  recordInformationRequestAction,
  revokeFoiFormAction,
  setFoiFormAppearanceAction,
  setFoiFormOriginsAction
} from './actions';
import {
  FOI_CHANNEL_LABEL,
  inputClass,
  Label,
  regimeNames,
  STATUS_LABEL
} from './fields';

export default async function InformationRequestsPage() {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');

  if (!can(active.membership.grants, 'foi.handle')) {
    return (
      <NotPermitted
        what="The register of freedom of information requests"
        organisationName={active.membership.organisationName}
      />
    );
  }

  const org = active.membership.organisationId;
  const [register, foiEntities, forms] = await Promise.all([
    informationRequestRegister(org, visibleEntityIds(active, 'foi.handle')),
    scoped(org, () =>
      db
        .select()
        .from(entities)
        .where(
          and(eq(entities.organisationId, org), isNotNull(entities.foiAct))
        )
    ),
    intakeLinksFor(org, visibleEntityIds(active, 'foi.handle'), 'foi')
  ]);
  const origin = await requestOrigin();
  const mayConfigure = mayConfigureInformationRequests(
    active.membership.grants
  );
  const mayRecordIn = foiEntities.filter((e) =>
    can(active.membership.grants, 'foi.handle', e.id)
  );

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
          Freedom of information requests
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          Every request for information you hold, with the twenty working days
          to answer it. Anyone can ask, for any reason, and need not name the
          law. A request for environmental information can even be made by phone
          or in person. Record it the day it arrives.
        </p>
        <p className="text-sm">
          <Link
            href="/app/information-requests/report"
            className="text-brand underline"
          >
            Figures by year and quarter
          </Link>
          <span className="text-ink-soft">
            : answered in time, outcomes, exemptions relied on, and reviews.
          </span>
        </p>
      </header>

      <HelpLink topic="information-requests" />

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Open"
          value={register.open}
          note="not yet answered or closed"
        />
        <Stat
          label="Due within five working days"
          value={register.dueSoon}
          note="respond, or send the refusal notice"
          tone={register.dueSoon > 0 ? 'warn' : 'plain'}
        />
        <Stat
          label="Past the deadline"
          value={register.overdue}
          note="still owed"
          tone={register.overdue > 0 ? 'stop' : 'plain'}
        />
      </section>

      {foiEntities.length === 0 ? (
        <p className="rounded border border-line bg-surface px-4 py-4 text-sm text-ink-soft">
          No entity is recorded as answering freedom of information requests. An
          owner sets which Act applies to each entity on the{' '}
          <Link
            href="/app/admin/organisation"
            className="text-brand underline"
          >
            Organisation page
          </Link>
          .
        </p>
      ) : null}

      {mayRecordIn.length > 0 ? (
        <details className="rounded border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Record a request
          </summary>
          <RefusableForm
            action={recordInformationRequestAction}
            submit="Record it"
            pendingLabel="Recording…"
            className="space-y-3 border-t border-line p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label
                  text="Who is asking?"
                  hint="Their name. FOI requests need a real name; environmental ones do not."
                />
                <input
                  name="requesterName"
                  required
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="Address for correspondence"
                  hint="An email or postal address, where the response goes."
                />
                <input
                  name="correspondenceAddress"
                  className={inputClass}
                />
              </label>
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="pseudonymous"
                className="mt-1 accent-brand"
              />
              <span>
                The name looks like a pseudonym. Under the FOI Acts that makes
                the request invalid (s.45 code 1.14), so ask for their real
                name. It does not matter for environmental information.
              </span>
            </label>
            <label className="block space-y-1">
              <Label
                text="What they asked for"
                hint="In their words. Do not ask why they want it: the law does not let you."
              />
              <textarea
                name="description"
                rows={4}
                required
                className={inputClass}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label
                  text="What kind of information"
                  hint="Environmental information is handled under the environmental regulations."
                />
                <select
                  name="kind"
                  className={inputClass}
                  defaultValue="general"
                >
                  <option value="general">Not environmental</option>
                  <option value="environmental">Environmental</option>
                  <option value="both">Some of each</option>
                </select>
              </label>
              <label className="block space-y-1">
                <Label
                  text="How they would like it"
                  hint="A copy, a chance to inspect it, a summary, or a format (s.11). Optional."
                />
                <input
                  name="preferredMeans"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="Received"
                  hint="The twenty working days run from the day after."
                />
                <input
                  type="datetime-local"
                  name="receivedAt"
                  required
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="How it arrived" />
                <select
                  name="channel"
                  className={inputClass}
                  defaultValue="email"
                >
                  {Object.entries(FOI_CHANNEL_LABEL).map(([value, label]) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <Label text="Made to" />
                <select
                  name="entityId"
                  className={inputClass}
                  defaultValue={mayRecordIn[0]?.id}
                >
                  {mayRecordIn.map((e) => (
                    <option
                      key={e.id}
                      value={e.id}
                    >
                      {e.name} ({e.foiAct ? REGIME[e.foiAct].short : ''})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="ownMe"
                defaultChecked
                className="mt-1 accent-brand"
              />
              <span>I will handle it</span>
            </label>
          </RefusableForm>
        </details>
      ) : null}

      {/* Shown while any form exists, so one can always be withdrawn. */}
      {foiEntities.length > 0 || forms.length > 0 ? (
        <section className="space-y-3 rounded border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Public request form</h2>
          <p className="max-w-prose text-xs text-ink-soft">
            A web form anyone can use to make a request without an account, one
            per entity. Publish its address on your freedom of information page.
            Each submission lands in this register as received by web form, with
            the twenty working days running from that day, and raises a task for
            the team. The form asks only what a valid request needs, never why
            they want it, and sends anybody asking for their own personal data
            to your data protection form if you have one. It shows nothing back
            except a reference and the deadline.
          </p>
          <IntakeFormList
            forms={forms}
            origin={origin}
            withdraw={
              mayConfigure
                ? (linkId) => revokeFoiFormAction.bind(null, linkId)
                : null
            }
            extra={(link, entityName) => (
              <>
                <EmbedPanel
                  appOrigin={origin}
                  slug={link.slug}
                  title={`Make a freedom of information request to ${entityName}`}
                  frameOrigins={link.frameOrigins}
                  setOrigins={
                    mayConfigure
                      ? setFoiFormOriginsAction.bind(null, link.id)
                      : null
                  }
                />
                <AppearancePanel
                  slug={link.slug}
                  link={link}
                  setAppearance={
                    mayConfigure
                      ? setFoiFormAppearanceAction.bind(null, link.id)
                      : null
                  }
                />
              </>
            )}
          />
          {mayConfigure && foiEntities.length > 0 ? (
            <RefusableForm
              action={issueFoiFormAction}
              submit="Create a form"
              className="flex flex-wrap items-end gap-3"
            >
              <label className="block space-y-1">
                <Label text="Entity" />
                <select
                  name="entityId"
                  className={inputClass}
                >
                  {foiEntities.map((e) => (
                    <option
                      key={e.id}
                      value={e.id}
                    >
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block flex-1 space-y-1">
                <Label text="Where it will be published" />
                <input
                  name="label"
                  placeholder="Freedom of information page"
                  className={inputClass}
                />
              </label>
            </RefusableForm>
          ) : null}
        </section>
      ) : null}

      <ul className="space-y-3">
        {register.rows.map((request) => (
          <li key={request.id}>
            <Link
              href={`/app/information-requests/${request.id}`}
              className="block space-y-2 rounded border border-line bg-surface p-4 hover:bg-ground focus-visible:outline-2 focus-visible:outline-brand"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-ink-soft">
                    {request.reference}
                  </span>
                  <span className="font-medium">
                    {regimeNames(request.regimes)}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-ink-soft">
                  {request.entityName} ·{' '}
                  {STATUS_LABEL[request.status] ?? request.status}
                </span>
              </div>
              <p className="line-clamp-2 text-sm">{request.description}</p>
              <p className="text-xs text-ink-soft">
                received {request.receivedAt.toISOString().slice(0, 10)} by{' '}
                {(
                  FOI_CHANNEL_LABEL[request.channel] ?? request.channel
                ).toLowerCase()}
              </p>
              <InformationRequestClock clock={request.clock} />
            </Link>
          </li>
        ))}
        {register.rows.length === 0 ? (
          <li className="rounded border border-line bg-surface px-4 py-6 text-sm text-ink-soft">
            No requests recorded yet.
          </li>
        ) : null}
      </ul>
    </main>
  );
}

function Stat({
  label,
  value,
  note,
  tone
}: {
  label: string;
  value: number;
  note: string;
  tone?: 'plain' | 'warn' | 'stop';
}) {
  return (
    <div className="rounded border border-line bg-surface px-4 py-3.5">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-soft">
        {label}
      </p>
      <p
        className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${
          tone === 'stop'
            ? 'text-red-800'
            : tone === 'warn'
              ? 'text-amber-800'
              : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-ink-soft">{note}</p>
    </div>
  );
}
