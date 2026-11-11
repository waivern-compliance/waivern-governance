'use client';

import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import { EEA_STATES, SUPERVISORY_AUTHORITIES } from '@/lib/gdpr/authorities';
import {
  ESTABLISHMENT_GAP_WORDS,
  establishmentGaps,
  REPRESENTATIVE_EXEMPTIONS,
  suggestedLeadAuthority,
  type Establishment,
  type Representative,
  type RepresentativeExemption
} from '@/lib/gdpr/establishment';
import { savedKey } from '@/lib/saved-key';
import { useRefusableAction } from '@/lib/use-refusable-action';

import { setEstablishmentAction, type AdminResult } from '../actions';
import { Outcome } from './Outcome';

const field =
  'rounded border border-line bg-ground px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-brand';
const STATES = Object.entries(EEA_STATES).sort((a, b) =>
  a[1].localeCompare(b[1])
);
const EU_AUTHORITIES = SUPERVISORY_AUTHORITIES.filter((a) => a.law === 'eu');

/**
 * Where an entity is established, who represents it, and which EU authority
 * leads, asked only for the laws it is subject to. The main establishment and
 * the lead authority are judgements: Govern suggests the authority where the
 * home State has only one, and a person records it.
 */
export function EstablishmentForm({
  entityId,
  name,
  law,
  establishment
}: {
  entityId: string;
  name: string;
  law: DataProtectionLaw;
  establishment: Establishment;
}) {
  const action = useRefusableAction<AdminResult>(
    setEstablishmentAction.bind(null, entityId),
    { resetOnSuccess: false }
  );
  const uk = law !== 'eu';
  const eu = law !== 'uk';
  const gaps = establishmentGaps(law, establishment);
  const suggested = suggestedLeadAuthority(establishment);
  const e = establishment;

  return (
    <details
      className="rounded border border-line px-3 py-2 text-xs"
      open={gaps.length > 0}
    >
      <summary className="cursor-pointer text-ink-soft">
        Establishment and representation
        {gaps.length > 0 ? (
          <span className="ml-2 text-red-800">{gaps.length} to record</span>
        ) : null}
      </summary>
      {gaps.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-800">
          {gaps.map((g) => (
            <li key={g}>{ESTABLISHMENT_GAP_WORDS[g]}</li>
          ))}
        </ul>
      ) : null}
      <form
        key={savedKey(JSON.stringify(e))}
        {...action.formProps}
        className="mt-3 space-y-4"
      >
        {eu ? (
          <fieldset className="space-y-2">
            <legend className="font-medium">EU GDPR</legend>
            <div>
              <p className="text-ink-soft">
                Established in (Article 3(1)); leave all unticked if EU law
                applies only because it offers goods or services to, or
                monitors, people in the EU (Article 3(2)):
              </p>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-4">
                {STATES.map(([code, label]) => (
                  <label
                    key={code}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="checkbox"
                      name="euEstablishments"
                      value={code}
                      defaultChecked={e.euEstablishments.includes(code)}
                      className="accent-brand"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-soft">
                Main establishment, where there is more than one (Article
                4(16)):
              </span>
              <select
                name="euMainEstablishment"
                defaultValue={e.euMainEstablishment ?? ''}
                className={field}
              >
                <option value="">Not recorded</option>
                {STATES.map(([code, label]) => (
                  <option
                    key={code}
                    value={code}
                  >
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-soft">
                Lead supervisory authority (Article 56(1)):
              </span>
              <select
                name="euLeadAuthority"
                defaultValue={e.euLeadAuthority ?? ''}
                className={`${field} max-w-full`}
              >
                <option value="">Not recorded</option>
                {EU_AUTHORITIES.map((a) => (
                  <option
                    key={a.code}
                    value={a.code}
                  >
                    {EEA_STATES[a.country]}: {a.name}
                    {a.scope ? ` (${a.scope})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {suggested && e.euLeadAuthority !== suggested.code ? (
              <p className="text-ink-soft">
                Suggested from the main establishment: {suggested.name}. Choose
                it above to confirm it.
              </p>
            ) : null}
            <RepresentativeFields
              prefix="euRep"
              label="EU representative (Article 27), where there is no EU establishment"
              rep={e.euRepresentative}
              exemption={e.euRepresentativeExemption}
              withCountry
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="euPublicBody"
                defaultChecked={e.euPublicBody}
                className="accent-brand"
              />
              A public authority or body under the law of a member State
            </label>
          </fieldset>
        ) : null}
        {uk ? (
          <fieldset className="space-y-2">
            <legend className="font-medium">UK GDPR</legend>
            <label className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-soft">
                Established in the UK (Article 3(1))?
              </span>
              <select
                name="ukEstablishment"
                defaultValue={e.ukEstablishment ? 'yes' : 'no'}
                className={field}
              >
                <option value="yes">Yes</option>
                <option value="no">
                  No - UK law applies because it offers goods or services to, or
                  monitors, people in the UK
                </option>
              </select>
            </label>
            <RepresentativeFields
              prefix="ukRep"
              label="UK representative (Article 27), where there is no UK establishment"
              rep={e.ukRepresentative}
              exemption={e.ukRepresentativeExemption}
            />
          </fieldset>
        ) : null}
        <button
          type="submit"
          disabled={action.pending}
          className="rounded border border-line bg-surface px-3 py-1.5 hover:border-brand disabled:opacity-50"
        >
          {action.pending ? 'Saving…' : `Save for ${name}`}
        </button>
        <Outcome result={action.result} />
      </form>
    </details>
  );
}

function RepresentativeFields({
  prefix,
  label,
  rep,
  exemption,
  withCountry = false
}: {
  prefix: string;
  label: string;
  rep: Representative | null;
  exemption: RepresentativeExemption | null;
  withCountry?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-ink-soft">{label}:</p>
      <div className="flex flex-wrap gap-2">
        <input
          name={`${prefix}Name`}
          defaultValue={rep?.name ?? ''}
          placeholder="Name"
          aria-label={`${label}: name`}
          className={field}
        />
        <input
          name={`${prefix}Contact`}
          defaultValue={rep?.contact ?? ''}
          placeholder="Address or mailbox"
          aria-label={`${label}: contact`}
          className={`${field} w-64`}
        />
        {withCountry ? (
          <select
            name={`${prefix}Country`}
            defaultValue={rep?.country ?? ''}
            aria-label={`${label}: member State`}
            className={field}
          >
            <option value="">Member State</option>
            {STATES.map(([code, s]) => (
              <option
                key={code}
                value={code}
              >
                {s}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <label className="flex flex-wrap items-baseline gap-2">
        <span className="text-ink-soft">Or exempt:</span>
        <select
          name={`${prefix}Exemption`}
          defaultValue={exemption ?? ''}
          className={`${field} max-w-full`}
        >
          <option value="">Not exempt</option>
          {(
            Object.keys(REPRESENTATIVE_EXEMPTIONS) as RepresentativeExemption[]
          ).map((k) => (
            <option
              key={k}
              value={k}
            >
              {REPRESENTATIVE_EXEMPTIONS[k]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
