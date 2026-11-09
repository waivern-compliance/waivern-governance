import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { InformationRequestClock } from '@/components/foi/InformationRequestClock';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import {
  REFUSAL_MUST_SAY,
  REGIME,
  REGULATOR,
  type FoiRegime
} from '@/lib/foi/statutory';
import { can } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';
import {
  feePausesOf,
  loadInformationRequest,
  refuses
} from '@/services/information-requests';

import { ActionForm } from '../../requests/ActionForm';
import {
  closeAction,
  convertAction,
  recordClarificationAction,
  respondAction,
  updateInformationRequestAction
} from '../actions';
import {
  FOI_CHANNEL_LABEL,
  inputClass,
  Label,
  regimeNames,
  RegimesField,
  STATUS_LABEL
} from '../fields';
import { DecisionForms, DecisionHistory } from './Decisions';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

export default async function InformationRequestPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const { id } = await params;

  const request = await loadInformationRequest(
    id,
    active.membership.organisationId
  );
  if (!request) notFound();
  if (!can(active.membership.grants, 'foi.handle', request.entityId)) {
    return (
      <NotPermitted
        what="This freedom of information request"
        organisationName={active.membership.organisationName}
      />
    );
  }

  const open = request.status === 'open';
  const refusing = refuses(request.decisions);
  const feeAwaited = feePausesOf(request.decisions).some((p) => p.to === null);
  const written = request.regimes.filter((r) => REGIME[r].mustBeInWriting);
  const environmental = request.regimes.some(
    (r) => r === 'eir' || r === 'eisr'
  );

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/information-requests"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Freedom of information requests
        </Link>
        <h1 className="flex flex-wrap items-baseline gap-3 text-2xl font-semibold tracking-tight">
          <span className="font-mono text-base text-ink-soft">
            {request.reference}
          </span>
          <span>{regimeNames(request.regimes)} request</span>
        </h1>
        <p className="text-sm text-ink-soft">
          To {request.entityName} · {STATUS_LABEL[request.status]} · received{' '}
          {longDate(request.receivedAt)} by{' '}
          {(
            FOI_CHANNEL_LABEL[request.channel] ?? request.channel
          ).toLowerCase()}
          {request.timeProfile !== 'standard'
            ? ` · ${request.timeProfile} time limits`
            : ''}
        </p>
        {request.entityCoveredFor ? (
          <p className="max-w-prose text-sm text-ink-soft">
            {request.entityName} is covered only for {request.entityCoveredFor}.
            Information it holds for anything else is outside the Act.
          </p>
        ) : null}
      </header>

      <HelpLink topic="information-requests" />

      <InformationRequestClock clock={request.clock} />

      {request.pseudonymous && written.length > 0 ? (
        <p
          role="note"
          className="rounded border border-amber-700 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          The name looks like a pseudonym. A request under the{' '}
          {REGIME[written[0]].label} needs the applicant&apos;s real name, so
          this one is not valid as it stands. Ask for their name, and advise
          them how to make a valid request (s.16).
        </p>
      ) : null}

      {request.status === 'converted' && request.convertedToRequestId ? (
        <p className="rounded border border-line bg-surface px-4 py-3 text-sm">
          This was for the requester&apos;s own personal data, so it is being
          handled as subject access request{' '}
          <Link
            href={`/app/requests/${request.convertedToRequestId}`}
            className="font-mono text-brand underline"
          >
            {request.convertedToReference}
          </Link>
          , with the month running from the day this arrived.
        </p>
      ) : null}

      <section className="space-y-3 rounded border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold">The request</h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Fact
            term="Requester"
            value={request.requesterName}
          />
          <Fact
            term="Address for correspondence"
            value={request.correspondenceAddress ?? 'Not recorded'}
          />
          <Fact
            term="How they would like it"
            value={request.preferredMeans ?? 'No preference given'}
          />
          <Fact
            term="Handled by"
            value={request.ownerEmail ?? 'Nobody yet'}
          />
        </dl>
        <p className="whitespace-pre-wrap text-sm">{request.description}</p>
      </section>

      {request.respondedAt ? (
        <section className="space-y-2 rounded border border-line bg-surface p-5 text-sm">
          <h2 className="font-semibold">Response</h2>
          <p>
            Sent {longDate(request.respondedAt)}.{' '}
            {request.published === true
              ? 'Published on the disclosure log.'
              : request.published === false
                ? 'Not published.'
                : ''}
          </p>
          <p className="whitespace-pre-wrap">{request.responseSummary}</p>
          {request.responseLink ? (
            <p className="break-all text-ink-soft">
              Kept at {request.responseLink}
            </p>
          ) : null}
          {request.lateReason ? (
            <p>Why it was late: {request.lateReason}</p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Decisions</h2>
        <p className="max-w-prose text-sm text-ink-soft">
          Each step and judgement, with its reason. Nothing is changed or
          removed: a changed mind is a new decision. The ordinary deadline is{' '}
          {longDate(request.ordinaryDeadline)}.
        </p>
        <DecisionHistory decisions={request.decisions} />
        {open ? (
          <DecisionForms
            requestId={request.id}
            regimes={request.regimes}
            feeAwaited={feeAwaited}
          />
        ) : null}
      </section>

      {request.status === 'closed' ? (
        <section className="space-y-2 rounded border border-line bg-surface p-5 text-sm">
          <h2 className="font-semibold">Closed</h2>
          <p>{request.closureRationale}</p>
        </section>
      ) : null}

      {open ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Clarification</h2>
            <p className="max-w-prose text-sm text-ink-soft">
              Where you need more to identify what they want, ask, and help them
              (s.16). Nothing is owed until they answer, and the twenty working
              days then start again.
              {request.clarificationSoughtAt
                ? ` Asked on ${longDate(request.clarificationSoughtAt)}.`
                : ''}
              {request.clarificationReceivedAt
                ? ` Answered on ${longDate(request.clarificationReceivedAt)}.`
                : ''}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionForm
                action={recordClarificationAction.bind(
                  null,
                  request.id,
                  'sought'
                )}
                submit="Record asking"
              >
                <label className="block space-y-1">
                  <Label text="Asked on" />
                  <input
                    type="date"
                    name="at"
                    required
                    className={inputClass}
                  />
                </label>
              </ActionForm>
              {request.clarificationSoughtAt ? (
                <ActionForm
                  action={recordClarificationAction.bind(
                    null,
                    request.id,
                    'received'
                  )}
                  submit="Record their answer"
                >
                  <label className="block space-y-1">
                    <Label text="Answered on" />
                    <input
                      type="date"
                      name="at"
                      required
                      className={inputClass}
                    />
                  </label>
                </ActionForm>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Respond</h2>
            <p className="max-w-prose text-sm text-ink-soft">
              Say whether the information is held and send it, or refuse with a
              notice. Whatever the regime, a refusal notice must say:
            </p>
            {request.regimes.map((r: FoiRegime) => (
              <div
                key={r}
                className="text-sm"
              >
                <p className="font-medium">{REGIME[r].label}</p>
                <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                  {REFUSAL_MUST_SAY[r].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
            <ActionForm
              action={respondAction.bind(null, request.id)}
              submit="Record the response"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <Label text="Sent on" />
                  <input
                    type="date"
                    name="respondedAt"
                    required
                    className={inputClass}
                  />
                </label>
                <label className="block space-y-1">
                  <Label
                    text="Published on the disclosure log?"
                    hint="Optional."
                  />
                  <select
                    name="published"
                    className={inputClass}
                    defaultValue=""
                  >
                    <option value="">Not said</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <Label
                  text="What the response was"
                  hint="Released in full, in part, refused (and under what), or not held."
                />
                <textarea
                  name="summary"
                  rows={3}
                  required
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="Where the response is kept"
                  hint="Optional: a link to the letter or email."
                />
                <input
                  name="link"
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label
                  text="If it was late, why"
                  hint={`The requester can complain to ${REGULATOR[request.act]} about the delay alone.`}
                />
                <input
                  name="lateReason"
                  className={inputClass}
                />
              </label>
              {refusing ? (
                <label className="flex items-start gap-2.5 rounded border border-amber-700 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    name="refusalNoticeChecked"
                    required
                    className="mt-1 accent-brand"
                  />
                  <span>
                    Something was refused, so this is a refusal notice. I have
                    checked it says everything listed above.
                  </span>
                </label>
              ) : null}
            </ActionForm>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              Is it for their own personal data?
            </h2>
            <p className="max-w-prose text-sm text-ink-soft">
              Then it is exempt from freedom of information and is a subject
              access request instead. Converting it records one, with the month
              running from the day this request arrived.
            </p>
            <ActionForm
              action={convertAction.bind(null, request.id)}
              submit="Convert to a subject access request"
              pendingLabel="Converting…"
            >
              <span className="sr-only">Convert this request</span>
            </ActionForm>
          </section>

          <details className="rounded border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Correct the record
            </summary>
            <ActionForm
              action={updateInformationRequestAction.bind(null, request.id)}
              submit="Save"
              className="space-y-3 border-t border-line p-4"
            >
              <RegimesField
                act={request.act}
                selected={request.regimes}
              />
              <label className="block space-y-1">
                <Label text="What they asked for" />
                <textarea
                  name="description"
                  rows={4}
                  defaultValue={request.description}
                  className={inputClass}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <Label text="Address for correspondence" />
                  <input
                    name="correspondenceAddress"
                    defaultValue={request.correspondenceAddress ?? ''}
                    className={inputClass}
                  />
                </label>
                <label className="block space-y-1">
                  <Label text="How they would like it" />
                  <input
                    name="preferredMeans"
                    defaultValue={request.preferredMeans ?? ''}
                    className={inputClass}
                  />
                </label>
                {request.timeProfile === 'school' ? (
                  <label className="block space-y-1">
                    <Label
                      text="Twentieth school day"
                      hint="Counting only school days. Never later than the sixtieth working day."
                    />
                    <input
                      type="date"
                      name="schoolDaysDeadline"
                      defaultValue={day(request.schoolDaysDeadline)}
                      className={inputClass}
                    />
                  </label>
                ) : null}
                {request.act === 'foia' ? (
                  <label className="block space-y-1">
                    <Label
                      text="Day set by the Information Commission"
                      hint="Only for armed forces operations or information held outside the UK, on application."
                    />
                    <input
                      type="date"
                      name="commissionSetDeadline"
                      defaultValue={day(request.commissionSetDeadline)}
                      className={inputClass}
                    />
                  </label>
                ) : null}
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="pseudonymous"
                  defaultChecked={request.pseudonymous}
                  className="mt-1 accent-brand"
                />
                <span>The name looks like a pseudonym</span>
              </label>
              {environmental ? (
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="extendedForComplexity"
                    defaultChecked={request.extendedForComplexity}
                    className="mt-1 accent-brand"
                  />
                  <span>
                    Extended to forty working days because it is both complex
                    and voluminous, and the requester was told within the first
                    twenty (reg 7)
                  </span>
                </label>
              ) : null}
            </ActionForm>
          </details>

          <details className="rounded border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Close without a response
            </summary>
            <ActionForm
              action={closeAction.bind(null, request.id)}
              submit="Close it"
              className="space-y-3 border-t border-line p-4"
            >
              <label className="block space-y-1">
                <Label
                  text="Why no response is owed"
                  hint="Withdrawn, or a duplicate. A refusal is a response: record it above."
                />
                <textarea
                  name="rationale"
                  rows={2}
                  required
                  className={inputClass}
                />
              </label>
            </ActionForm>
          </details>
        </>
      ) : null}
    </main>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-soft">
        {term}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
