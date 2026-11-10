import type { ReactNode } from 'react';

import { RefusableForm } from '@/components/foi/RefusableForm';
import {
  allowsPublicInterestExtension,
  costLimit,
  exemptionsFor,
  OWN_DATA_PROVISIONS,
  REGIME,
  type FoiRegime
} from '@/lib/foi/statutory';
import type { InformationRequestDecision } from '@/services/information-requests';

import { recordDecisionAction } from '../actions';
import { inputClass, Label } from '../fields';

const KIND_LABEL: Record<InformationRequestDecision['kind'], string> = {
  held: 'Whether it is held',
  neither_confirm_nor_deny: 'Neither confirm nor deny',
  exemption: 'Exemption or exception',
  public_interest_extension: 'More time for the public interest test',
  complexity_extension: 'Extended for complexity and volume',
  fees_notice: 'Fees notice',
  fee_paid: 'Fee paid',
  fee_lapsed: 'Fee not paid in time',
  cost_limit: 'Over the cost limit',
  vexatious: 'Vexatious',
  repeated: 'Repeated',
  transferred: 'Transferred',
  advice: 'Advice and assistance'
};

const HELD_LABEL: Record<string, string> = {
  held: 'held',
  not_held: 'not held',
  part_held: 'held in part'
};

const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

function Rationale({ hint }: { hint?: string }) {
  return (
    <label className="block space-y-1">
      <Label
        text="Why"
        hint={hint ?? 'The reason, as you would give it to a reviewer.'}
      />
      <textarea
        name="rationale"
        rows={2}
        required
        className={inputClass}
      />
    </label>
  );
}

function When({ text = 'On' }: { text?: string }) {
  return (
    <label className="block space-y-1">
      <Label
        text={text}
        hint="Leave blank for today."
      />
      <input
        type="date"
        name="effectiveAt"
        className={inputClass}
      />
    </label>
  );
}

function RegimeField({ regimes }: { regimes: readonly FoiRegime[] }) {
  if (regimes.length === 1)
    return (
      <input
        type="hidden"
        name="regime"
        value={regimes[0]}
      />
    );
  return (
    <label className="block space-y-1">
      <Label text="Under" />
      <select
        name="regime"
        className={inputClass}
      >
        {regimes.map((r) => (
          <option
            key={r}
            value={r}
          >
            {REGIME[r].label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Kind({ kind }: { kind: InformationRequestDecision['kind'] }) {
  return (
    <input
      type="hidden"
      name="kind"
      value={kind}
    />
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

/** One form per kind of decision, each refused by the service where the law does not allow it. */
export function DecisionForms({
  requestId,
  regimes,
  feesAwaited
}: {
  requestId: string;
  regimes: readonly FoiRegime[];
  /** The regimes under which a fee has been asked for and not yet paid. */
  feesAwaited: readonly FoiRegime[];
}) {
  const chargeable = regimes.filter((r) => !feesAwaited.includes(r));
  const action = recordDecisionAction.bind(null, requestId);
  const environmental = regimes.filter((r) => r === 'eir' || r === 'eisr');
  const written = regimes.filter((r) => r === 'foia' || r === 'foisa');
  const piRegimes = regimes.filter(allowsPublicInterestExtension);

  const formClass = 'space-y-3 p-4';

  return (
    <div className="space-y-2">
      <Section title="Whether the information is held">
        <RefusableForm
          action={action}
          submit="Record it"
          className={formClass}
        >
          <Kind kind="held" />
          <RegimeField regimes={regimes} />
          <label className="block space-y-1">
            <Label text="It is" />
            <select
              name="held"
              className={inputClass}
            >
              <option value="held">Held</option>
              <option value="part_held">Held in part</option>
              <option value="not_held">Not held</option>
            </select>
          </label>
          <Rationale hint="Where you searched and how, especially if not held." />
        </RefusableForm>
      </Section>

      <Section title="Apply an exemption or exception">
        {regimes.map((regime) => (
          <RefusableForm
            key={regime}
            action={action}
            submit={`Apply under ${REGIME[regime].short}`}
            className={formClass}
          >
            <Kind kind="exemption" />
            <input
              type="hidden"
              name="regime"
              value={regime}
            />
            <label className="block space-y-1">
              <Label
                text={`${REGIME[regime].label}`}
                hint={
                  regime === 'eir' || regime === 'eisr'
                    ? 'Every exception needs the public interest test, with a presumption in favour of disclosure.'
                    : 'Absolute exemptions need no public interest test; the rest do.'
                }
              />
              <select
                name="provision"
                className={inputClass}
              >
                {exemptionsFor(regime)
                  .filter((e) => !OWN_DATA_PROVISIONS.includes(e.provision))
                  .map((e) => (
                    <option
                      key={e.provision}
                      value={e.provision}
                    >
                      {e.provision} {e.title}
                      {e.absolute ? ' (absolute)' : ''}
                    </option>
                  ))}
              </select>
            </label>
            {regime === 'eir' || regime === 'eisr' ? (
              <label className="block space-y-1">
                <Label
                  text="Is it information on emissions?"
                  hint="If so, the exceptions for confidentiality, a supplier's interests and the environment cannot be used."
                />
                <select
                  name="emissions"
                  className={inputClass}
                  defaultValue=""
                >
                  <option value="">Not considered</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
            ) : null}
            <label className="block space-y-1">
              <Label
                text="Does it withhold anything?"
                hint="Where the public interest in disclosure wins, record the weighing anyway: nothing is withheld under it, and it does not count as a refusal."
              />
              <select
                name="applied"
                className={inputClass}
                defaultValue="yes"
              >
                <option value="yes">Yes: withheld under it</option>
                <option value="no">
                  No: engaged, but the public interest favours release
                </option>
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label text="Public interest in disclosure" />
                <textarea
                  name="factorsFor"
                  rows={3}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <Label text="Public interest in withholding" />
                <textarea
                  name="factorsAgainst"
                  rows={3}
                  className={inputClass}
                />
              </label>
            </div>
            <Rationale hint="Why it applies, and for a qualified exemption why the balance falls where it does." />
          </RefusableForm>
        ))}
      </Section>

      {piRegimes.length > 0 ? (
        <Section title="Take more time to weigh the public interest (FOIA s.10(3))">
          <RefusableForm
            action={action}
            submit="Record it"
            className={formClass}
          >
            <Kind kind="public_interest_extension" />
            <input
              type="hidden"
              name="regime"
              value="foia"
            />
            <p className="text-sm text-ink-soft">
              The refusal notice saying the test is still being weighed, with
              the exemption and an estimated date, is due by the ordinary
              deadline. The code of practice expects no more than twenty further
              working days.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label text="Qualified exemption" />
                <select
                  name="provision"
                  className={inputClass}
                >
                  {exemptionsFor('foia')
                    .filter((e) => !e.absolute)
                    .map((e) => (
                      <option
                        key={e.provision}
                        value={e.provision}
                      >
                        {e.provision} {e.title}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block space-y-1">
                <Label text="Decision expected by" />
                <input
                  type="date"
                  name="estimatedDate"
                  required
                  className={inputClass}
                />
              </label>
              <When text="Notice sent on" />
            </div>
            <Rationale />
          </RefusableForm>
        </Section>
      ) : null}

      {environmental.length > 0 ? (
        <Section title="Extend to forty working days (reg 7)">
          <RefusableForm
            action={action}
            submit="Record it"
            className={formClass}
          >
            <Kind kind="complexity_extension" />
            <input
              type="hidden"
              name="regime"
              value={environmental[0]}
            />
            <p className="text-sm text-ink-soft">
              Only where the request is both complex and voluminous, and the
              requester is told within the first twenty working days.
            </p>
            <When text="Requester told on" />
            <Rationale hint="What makes it both complex and voluminous." />
          </RefusableForm>
        </Section>
      ) : null}

      <Section title="Fees">
        {feesAwaited.length > 0 ? (
          <div className="grid gap-0 sm:grid-cols-2">
            <RefusableForm
              action={action}
              submit="Record it paid"
              className={formClass}
            >
              <Kind kind="fee_paid" />
              <RegimeField regimes={feesAwaited} />
              <When text="Paid on" />
              <Rationale hint="How it was paid." />
            </RefusableForm>
            <RefusableForm
              action={action}
              submit="Record it lapsed"
              className={formClass}
            >
              <Kind kind="fee_lapsed" />
              <RegimeField regimes={feesAwaited} />
              <When text="Lapsed on" />
              <Rationale hint="Nothing more is owed on that part. A request with no other part closes." />
            </RefusableForm>
          </div>
        ) : null}
        {chargeable.length > 0 ? (
          <RefusableForm
            action={action}
            submit="Record the fees notice"
            className={formClass}
          >
            <Kind kind="fees_notice" />
            <RegimeField regimes={chargeable} />
            <p className="text-sm text-ink-soft">
              The days from the notice to payment do not count. Under the Acts
              the fee must be paid within three months; under the environmental
              regulations, sixty working days.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label text="Amount (£)" />
                <input
                  type="number"
                  name="amount"
                  min="0.01"
                  step="0.01"
                  required
                  className={inputClass}
                />
              </label>
              <When text="Notice sent on" />
            </div>
            <Rationale hint="How the amount was worked out." />
          </RefusableForm>
        ) : null}
      </Section>

      {written.length > 0 ? (
        <Section title="Refuse: over the cost limit, vexatious or repeated">
          <RefusableForm
            action={action}
            submit="Record over the cost limit"
            className={formClass}
          >
            <Kind kind="cost_limit" />
            <input
              type="hidden"
              name="regime"
              value={written[0]}
            />
            <p className="text-sm text-ink-soft">
              {written[0] === 'foia'
                ? `£${costLimit('foia', { centralGovernment: true })?.pounds} for central government, £${costLimit('foia')?.pounds} for everyone else, at £25 an hour: ${costLimit('foia', { centralGovernment: true })?.hours} or ${costLimit('foia')?.hours} hours.`
                : `£600 at £15 an hour: ${costLimit('foisa')?.hours} hours.`}{' '}
              Count only determining whether it is held, locating, retrieving
              and extracting it. Advise how the request could be narrowed.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <Label text="Estimated hours" />
                <input
                  type="number"
                  name="estimatedHours"
                  min="0.5"
                  step="0.5"
                  required
                  className={inputClass}
                />
              </label>
              <div className="space-y-2 pt-5 text-sm">
                {written[0] === 'foia' ? (
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      name="centralGovernment"
                      className="mt-1 accent-brand"
                    />
                    <span>A Schedule 1 Part I body (central government)</span>
                  </label>
                ) : null}
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    name="aggregated"
                    className="mt-1 accent-brand"
                  />
                  <span>
                    Costs added together with similar requests from the same
                    person in sixty working days
                  </span>
                </label>
              </div>
            </div>
            <Rationale hint="How the estimate was reached." />
          </RefusableForm>
          <div className="grid gap-0 border-t border-line sm:grid-cols-2">
            <RefusableForm
              action={action}
              submit="Record as vexatious"
              className={formClass}
            >
              <Kind kind="vexatious" />
              <input
                type="hidden"
                name="regime"
                value={written[0]}
              />
              <Rationale hint="The request, not the requester: its burden against its value." />
            </RefusableForm>
            <RefusableForm
              action={action}
              submit="Record as repeated"
              className={formClass}
            >
              <Kind kind="repeated" />
              <input
                type="hidden"
                name="regime"
                value={written[0]}
              />
              <Rationale hint="Which earlier request it repeats, and why no reasonable interval has passed." />
            </RefusableForm>
          </div>
        </Section>
      ) : null}

      <Section title="Neither confirm nor deny, transfer, or advice given">
        <RefusableForm
          action={action}
          submit="Record neither confirm nor deny"
          className={formClass}
        >
          <Kind kind="neither_confirm_nor_deny" />
          <RegimeField regimes={regimes} />
          <label className="block space-y-1">
            <Label
              text="Provision"
              hint="The subsection removing the duty to confirm or deny, such as s.31(3)."
            />
            <input
              name="provision"
              required
              className={inputClass}
            />
          </label>
          <Rationale />
        </RefusableForm>
        <div className="grid gap-0 border-t border-line sm:grid-cols-2">
          <RefusableForm
            action={action}
            submit="Record a transfer"
            className={formClass}
          >
            <Kind kind="transferred" />
            <When text="Transferred on" />
            <Rationale hint="To whom, and that the requester agreed or was told." />
          </RefusableForm>
          <RefusableForm
            action={action}
            submit="Record advice given"
            className={formClass}
          >
            <Kind kind="advice" />
            <When text="Given on" />
            <Rationale hint="What advice and assistance was given (s.16)." />
          </RefusableForm>
        </div>
      </Section>
    </div>
  );
}

/** What has been decided, oldest first, each with its reason. */
export function DecisionHistory({
  decisions
}: {
  decisions: readonly InformationRequestDecision[];
}) {
  if (decisions.length === 0)
    return <p className="text-sm text-ink-soft">Nothing decided yet.</p>;
  return (
    <ol className="space-y-2">
      {decisions.map((d) => {
        const detail = d.detail as Record<string, unknown>;
        return (
          <li
            key={d.id}
            className="space-y-1 rounded border border-line bg-surface px-4 py-3 text-sm"
          >
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {KIND_LABEL[d.kind]}
                {d.provision ? ` · ${d.provision}` : ''}
                {typeof detail.title === 'string' ? ` ${detail.title}` : ''}
                {d.kind === 'exemption' && detail.applied === false
                  ? ': engaged, but the public interest favours release'
                  : ''}
                {d.kind === 'held' && typeof detail.held === 'string'
                  ? `: ${HELD_LABEL[detail.held] ?? detail.held}`
                  : ''}
              </span>
              <span className="font-mono text-[11px] text-ink-soft">
                {d.regime ? `${REGIME[d.regime].short} · ` : ''}
                {longDate(d.effectiveAt)} · {d.decidedByLabel}
              </span>
            </p>
            {d.kind === 'public_interest_extension' &&
            typeof detail.estimatedDate === 'string' ? (
              <p>
                Decision expected by {longDate(new Date(detail.estimatedDate))}.
              </p>
            ) : null}
            {d.kind === 'cost_limit' ? (
              <p>
                Estimated {String(detail.estimatedHours)} hours
                {detail.aggregated ? ', with similar requests added' : ''}.
              </p>
            ) : null}
            {d.kind === 'fees_notice' ? (
              <p>
                £{String(detail.amount)}, to be paid by{' '}
                {longDate(new Date(String(detail.lapsesAt)))}.
              </p>
            ) : null}
            {typeof detail.factorsFor === 'string' ? (
              <p>
                <span className="text-ink-soft">For disclosure: </span>
                {detail.factorsFor}
                <br />
                <span className="text-ink-soft">For withholding: </span>
                {String(detail.factorsAgainst)}
              </p>
            ) : null}
            <p className="whitespace-pre-wrap text-ink-soft">{d.rationale}</p>
          </li>
        );
      })}
    </ol>
  );
}
