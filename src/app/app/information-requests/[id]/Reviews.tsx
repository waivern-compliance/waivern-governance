import type { ReactNode } from 'react';

import { RefusableForm } from '@/components/foi/RefusableForm';
import {
  allowsExceptionalReview,
  APPEAL,
  REGIME,
  REGULATOR,
  REGULATOR_APPLICATION,
  REVIEW,
  type FoiAct,
  type FoiRegime,
  type InformationRequestReviewClock
} from '@/lib/foi/statutory';
import type {
  InformationRequestRegulatorEvent,
  LoadedReview,
  RegulatorCase,
  RegulatorEventKind,
  ReviewOutcome
} from '@/services/information-request-reviews';

import {
  decideReviewAction,
  extendReviewAction,
  recordRegulatorEventAction,
  requestReviewAction,
  withdrawReviewAction
} from '../actions';
import { FOI_CHANNEL_LABEL, inputClass, Label } from '../fields';

const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

const OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  upheld: 'The original decision stands',
  varied: 'Changed in part',
  reversed: 'Reversed',
  declined: 'Not accepted: asked for after the last day'
};

const EVENT_LABEL: Record<RegulatorEventKind, string> = {
  application: 'Application made',
  enquiry: 'Enquiry from the regulator',
  information_notice: 'Information notice',
  decision_notice: 'Decision notice',
  complied: 'Steps taken',
  appeal_lodged: 'Appeal lodged',
  appeal_decided: 'Appeal decided',
  enforcement_notice: 'Enforcement notice',
  closed: 'Case closed'
};

const FINDING_LABEL: Record<string, string> = {
  for_authority: 'for the authority',
  partly: 'partly for the requester',
  against_authority: 'for the requester'
};

function ReviewClock({ clock }: { clock: InformationRequestReviewClock }) {
  const tone =
    clock.state === 'overdue' || clock.state === 'late'
      ? 'border-red-700 bg-red-50 text-red-900'
      : clock.state === 'due_soon'
        ? 'border-amber-700 bg-amber-50 text-amber-900'
        : clock.state === 'met'
          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
          : 'border-line bg-ground text-ink-soft';
  const heading = {
    running: 'Review under way',
    due_soon: 'Review due soon',
    overdue: 'Review past its time',
    met: 'Decided in time',
    late: 'Decided late',
    withdrawn: 'Withdrawn'
  }[clock.state];
  return (
    <div className={`rounded border px-4 py-3 ${tone}`}>
      <p className="text-xs font-medium uppercase tracking-wider">{heading}</p>
      <p className="mt-1 max-w-prose text-sm">{clock.words}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {title}
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

function Reviewer({ required }: { required?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-1">
        <Label
          text="Who is reviewing"
          hint="Someone more senior than whoever decided first, where you can."
        />
        <input
          name="reviewerName"
          required={required}
          className={inputClass}
        />
      </label>
      <label className="flex items-start gap-2.5 self-end text-sm">
        <input
          type="checkbox"
          name="reviewerNotInvolved"
          className="mt-1 accent-brand"
        />
        <span>They had no part in the original decision.</span>
      </label>
    </div>
  );
}

/** Words for the review a regime gives, and its limits. */
function reviewRules(regimes: readonly FoiRegime[]) {
  return regimes
    .map((r) => {
      const rule = REVIEW[r];
      const more =
        rule.decideAtMost > rule.decideWithin
          ? `, or ${rule.decideAtMost} in exceptional cases`
          : '';
      return `${REGIME[r].short}: ${rule.name} (${rule.provision}), asked for within ${rule.askWithin} working days and decided within ${rule.decideWithin}${more}.`;
    })
    .join(' ');
}

export function ReviewsSection({
  requestId,
  regimes,
  reviews,
  lastDayToAsk,
  mayAskForReview,
  aboutNoResponse,
  school
}: {
  requestId: string;
  regimes: readonly FoiRegime[];
  reviews: readonly LoadedReview[];
  lastDayToAsk: Date | null;
  mayAskForReview: boolean;
  aboutNoResponse: boolean;
  school: boolean;
}) {
  const openReview = reviews.find((r) => r.status === 'open');
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Review</h2>
      <p className="max-w-prose text-sm text-ink-soft">
        {reviewRules(regimes)}{' '}
        {lastDayToAsk
          ? `The last day to ask is ${longDate(lastDayToAsk)}; you may accept a later request, but need not.`
          : ''}
      </p>
      {reviews.map((review) => (
        <ReviewCard
          key={review.id}
          requestId={requestId}
          review={review}
        />
      ))}
      {mayAskForReview && !openReview ? (
        <Section title="Record a request for review">
          <RefusableForm
            action={requestReviewAction.bind(null, requestId)}
            submit="Record it"
            pendingLabel="Recording…"
            className="space-y-3 p-4"
          >
            {aboutNoResponse ? (
              <p className="text-sm text-ink-soft">
                No response has been sent, so this review is of the failure to
                respond in time.
              </p>
            ) : null}
            {regimes.length > 1 ? (
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                  About
                </legend>
                {regimes.map((r) => (
                  <label
                    key={r}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="regimes"
                      value={r}
                      defaultChecked
                      className="mt-1 accent-brand"
                    />
                    <span>{REGIME[r].label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <label className="block space-y-1">
              <Label
                text="What they are unhappy with"
                hint="In their words. They need not use the word review."
              />
              <textarea
                name="grounds"
                rows={3}
                required
                className={inputClass}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label
                  text="Asked for on"
                  hint="The day it arrived starts the review's clock."
                />
                <input
                  type="date"
                  name="requestedAt"
                  required
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="How" />
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
                      {label.replace(' (environmental only)', '')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Reviewer />
            {school ? (
              <label className="block space-y-1">
                <Label
                  text="The twentieth school day"
                  hint="For a school under the school-days rule. Capped at the 60th working day."
                />
                <input
                  type="date"
                  name="schoolDaysDeadline"
                  className={inputClass}
                />
              </label>
            ) : null}
            <fieldset className="space-y-2 rounded border border-line p-3">
              <legend className="px-1 text-xs font-medium uppercase tracking-wider text-ink-soft">
                Only if it was asked for after the last day
              </legend>
              <select
                name="late"
                className={inputClass}
                defaultValue=""
              >
                <option value="">It was in time</option>
                <option value="accept">Accept it anyway</option>
                <option value="decline">Decline it</option>
              </select>
              <textarea
                name="lateReason"
                rows={2}
                placeholder="Why"
                className={inputClass}
              />
            </fieldset>
          </RefusableForm>
        </Section>
      ) : null}
      {!mayAskForReview && reviews.length === 0 ? (
        <p className="text-sm text-ink-soft">
          A review can be asked for once the request is answered, or once it is
          late.
        </p>
      ) : null}
    </section>
  );
}

function ReviewCard({
  requestId,
  review
}: {
  requestId: string;
  review: LoadedReview;
}) {
  const names = [...new Set(review.regimes.map((r) => REVIEW[r].name))].join(
    ' and '
  );
  const mayExtend =
    review.status === 'open' &&
    !review.exceptional &&
    review.regimes.some(allowsExceptionalReview);
  return (
    <article className="space-y-3 rounded border border-line bg-surface p-5 text-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold first-letter:uppercase">{names}</h3>
        <span className="text-xs text-ink-soft">
          asked for {longDate(review.requestedAt)} by{' '}
          {(FOI_CHANNEL_LABEL[review.channel] ?? review.channel)
            .replace(' (environmental only)', '')
            .toLowerCase()}
        </span>
      </header>
      <ReviewClock clock={review.clock} />
      <p className="whitespace-pre-wrap">{review.grounds}</p>
      <ul className="space-y-1 text-ink-soft">
        {review.aboutNoResponse ? (
          <li>About the failure to respond in time.</li>
        ) : null}
        {review.lateAcceptedReason ? (
          <li>
            Asked for after the last day and accepted:{' '}
            {review.lateAcceptedReason}
          </li>
        ) : null}
        {review.exceptional ? (
          <li>
            Given the further twenty working days: {review.exceptionalReason}
          </li>
        ) : null}
        {review.reviewerName ? (
          <li>
            Reviewed by {review.reviewerName}
            {review.reviewerNotInvolved
              ? ', who had no part in the original decision'
              : ''}
            .
          </li>
        ) : null}
      </ul>
      {review.status === 'decided' && review.outcome ? (
        <div className="space-y-1 border-t border-line pt-3">
          <p className="font-medium">{OUTCOME_LABEL[review.outcome]}</p>
          <p className="whitespace-pre-wrap">{review.outcomeSummary}</p>
          {review.informationReleased ? (
            <p className="text-ink-soft">More information was released.</p>
          ) : null}
          {review.lateReason ? (
            <p className="text-ink-soft">
              Why it was late: {review.lateReason}
            </p>
          ) : null}
        </div>
      ) : null}
      {review.status === 'withdrawn' ? (
        <p className="border-t border-line pt-3 text-ink-soft">
          {review.withdrawnNote}
        </p>
      ) : null}
      {review.status === 'open' ? (
        <div className="space-y-2">
          <Section title="Record the outcome">
            <RefusableForm
              action={decideReviewAction.bind(null, requestId, review.id)}
              submit="Record the outcome"
              pendingLabel="Recording…"
              className="space-y-3 p-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <Label text="What it came to" />
                  <select
                    name="outcome"
                    className={inputClass}
                    defaultValue="upheld"
                  >
                    <option value="upheld">{OUTCOME_LABEL.upheld}</option>
                    <option value="varied">{OUTCOME_LABEL.varied}</option>
                    <option value="reversed">{OUTCOME_LABEL.reversed}</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <Label text="Notice sent on" />
                  <input
                    type="date"
                    name="decidedAt"
                    required
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <Label
                  text="What the review found"
                  hint="And what changes because of it."
                />
                <textarea
                  name="summary"
                  rows={3}
                  required
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="More information released?" />
                <select
                  name="informationReleased"
                  className={inputClass}
                  defaultValue=""
                >
                  <option value="">Not applicable</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              {review.reviewerName ? null : <Reviewer required />}
              <label className="block space-y-1">
                <Label
                  text="Why it was late"
                  hint="Only if it was decided after the time allowed."
                />
                <input
                  name="lateReason"
                  className={inputClass}
                />
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="noticeChecked"
                  className="mt-1 accent-brand"
                />
                <span>
                  The notice tells the requester they can apply to the regulator
                  if they are still unhappy
                  {review.regimes.some((r) => r === 'foisa' || r === 'eisr')
                    ? ', and of the appeal to the Court of Session'
                    : ''}
                  .
                </span>
              </label>
            </RefusableForm>
          </Section>
          {mayExtend ? (
            <Section title="Take the further twenty working days">
              <RefusableForm
                action={extendReviewAction.bind(null, requestId, review.id)}
                submit="Extend"
                className="space-y-3 p-4"
              >
                <p className="text-ink-soft">
                  The FOIA code allows it only in exceptional cases, such as a
                  long or complex review (para 5.5). Tell the requester.
                </p>
                <textarea
                  name="reason"
                  rows={2}
                  required
                  placeholder="Why"
                  className={inputClass}
                />
              </RefusableForm>
            </Section>
          ) : null}
          <Section title="The requester withdrew it">
            <RefusableForm
              action={withdrawReviewAction.bind(null, requestId, review.id)}
              submit="Record it"
              className="space-y-3 p-4"
            >
              <textarea
                name="note"
                rows={2}
                required
                placeholder="How and when they withdrew it"
                className={inputClass}
              />
            </RefusableForm>
          </Section>
        </div>
      ) : null}
    </article>
  );
}

export function RegulatorSection({
  requestId,
  act,
  events,
  regulatorCase
}: {
  requestId: string;
  act: FoiAct;
  events: readonly InformationRequestRegulatorEvent[];
  regulatorCase: RegulatorCase;
}) {
  const rule = REGULATOR_APPLICATION[act];
  const appeal = APPEAL[act];
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold first-letter:uppercase">
        {REGULATOR[act]}
      </h2>
      <p className="max-w-prose text-sm text-ink-soft">
        The requester can apply to {REGULATOR[act]} ({rule.provision}){' '}
        {rule.reviewFirst === 'required'
          ? `once the review is decided, or its time has run out, ${rule.within}.`
          : `${rule.within}, normally after the review.`}{' '}
        Either side can appeal its decision notice to {appeal.to} (
        {appeal.provision}) within {appeal.days} days.
      </p>
      {regulatorCase.open ? (
        <ul className="space-y-1 rounded border border-line bg-surface px-4 py-3 text-sm">
          <li>
            Case open
            {regulatorCase.caseReference
              ? `, reference ${regulatorCase.caseReference}`
              : ''}
            .
          </li>
          {regulatorCase.complyBy ? (
            <li className="font-medium">
              Steps required by {longDate(regulatorCase.complyBy)}.
            </li>
          ) : null}
          {regulatorCase.appealBy ? (
            <li>
              The last day to appeal the decision notice is{' '}
              {longDate(regulatorCase.appealBy)}.
            </li>
          ) : null}
          {regulatorCase.appealPending ? (
            <li>
              An appeal is pending. Steps it affects need not be taken until it
              is decided.
            </li>
          ) : null}
        </ul>
      ) : null}
      {events.length > 0 ? (
        <ol className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="rounded border border-line bg-surface px-4 py-3 text-sm"
            >
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {EVENT_LABEL[e.kind]}
                  {typeof e.detail.finding === 'string'
                    ? `: ${FINDING_LABEL[e.detail.finding] ?? e.detail.finding}`
                    : ''}
                  {typeof e.detail.appellant === 'string'
                    ? ` by the ${e.detail.appellant}`
                    : ''}
                </span>
                <span className="text-xs text-ink-soft">
                  {longDate(e.occurredAt)}
                  {e.caseReference ? ` · ${e.caseReference}` : ''}
                </span>
              </p>
              <p className="mt-1 whitespace-pre-wrap">{e.note}</p>
              {typeof e.detail.complyBy === 'string' ? (
                <p className="mt-1 text-ink-soft">
                  Steps by {longDate(new Date(e.detail.complyBy))}.
                </p>
              ) : null}
              <p className="mt-1 text-xs text-ink-soft">
                Recorded by {e.recordedByLabel}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      <Section title="Record a step">
        <RefusableForm
          key={regulatorCase.open ? 'open' : 'none'}
          action={recordRegulatorEventAction.bind(null, requestId)}
          submit="Record it"
          pendingLabel="Recording…"
          className="space-y-3 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <Label text="What happened" />
              <select
                name="kind"
                className={inputClass}
                defaultValue={regulatorCase.open ? 'enquiry' : 'application'}
              >
                {Object.entries(EVENT_LABEL).map(([value, label]) => (
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
              <Label text="On" />
              <input
                type="date"
                name="occurredAt"
                required
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <Label
                text="Case reference"
                hint="The regulator's or the tribunal's."
              />
              <input
                name="caseReference"
                defaultValue={regulatorCase.caseReference ?? ''}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <Label
                text="Finding"
                hint="For a decision notice or an appeal decision."
              />
              <select
                name="finding"
                className={inputClass}
                defaultValue=""
              >
                <option value="">Not applicable</option>
                <option value="for_authority">For the authority</option>
                <option value="partly">Partly for the requester</option>
                <option value="against_authority">For the requester</option>
              </select>
            </label>
            <label className="block space-y-1">
              <Label
                text="Steps required by"
                hint="The date a notice or order sets."
              />
              <input
                type="date"
                name="complyBy"
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <Label
                text="Appealed by"
                hint="For an appeal."
              />
              <select
                name="appellant"
                className={inputClass}
                defaultValue=""
              >
                <option value="">Not applicable</option>
                <option value="authority">The authority</option>
                <option value="requester">The requester</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <Label
              text="What it says"
              hint="In a sentence or two. Keep the document where you keep correspondence."
            />
            <textarea
              name="note"
              rows={2}
              required
              className={inputClass}
            />
          </label>
        </RefusableForm>
      </Section>
    </section>
  );
}
