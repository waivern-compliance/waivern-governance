'use client';

import {
  EntityAgreementFields,
  KeyTerms,
  versionLabel
} from '@/components/legal/AgreementParts';
import {
  DATA_PROTECTION_LAWS,
  ukLawApplies,
  type DataProtectionLaw
} from '@/lib/dpa2018/applies';
import type { Establishment } from '@/lib/gdpr/establishment';
import { documentPath, type DocumentRef } from '@/lib/legal/shared';
import { savedKey } from '@/lib/saved-key';
import { useRefusableAction } from '@/lib/use-refusable-action';

import {
  addEntityAction,
  makeDefaultEntityAction,
  renameEntityAction,
  setCompetentAuthorityAction,
  setDataProtectionLawAction,
  setFreedomOfInformationAction,
  setIeEprivacyAction,
  setProviderAction,
  setPublicAuthorityAction,
  type AdminResult
} from '../actions';
import { EstablishmentForm } from './EstablishmentForm';
import { Outcome } from './Outcome';

type Entity = {
  id: string;
  name: string;
  legalEntityRef: string | null;
  isDefault: boolean;
  publicCommsProvider: boolean;
  /** S.I. 336/2011; null where nobody has answered. */
  ieEprivacy: boolean | null;
  /** Established in Ireland or led by the DPC, and not yet answered. */
  ieEprivacySuggested: boolean;
  publicAuthority: boolean;
  competentAuthority: boolean;
  defaultRegime: string;
  dataProtectionLaw: DataProtectionLaw;
  foiAct: 'foia' | 'foisa' | null;
  foiTimeProfile: string;
  foiCoveredFor: string | null;
  establishment: Establishment;
  /** The latest acceptance of the terms and agreement, on the hosted service. */
  agreement?: {
    acceptedByName: string;
    acceptedByPosition: string;
    acceptedAt: string;
    termsVersion: string;
    dpaVersion: string;
  } | null;
};

/** On the hosted service: what a new entity accepts as it is added. */
type AgreementTerms = {
  terms: DocumentRef;
  dpa: DocumentRef;
  defaultName: string;
} | null;

const input =
  'rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand';
const label =
  'block text-xs font-medium uppercase tracking-wider text-ink-soft';

/**
 * The legal entities within this organisation — for the BBC, BBC Public
 * Service and BBC Studios. An owner over the whole organisation adds and
 * renames them here; anyone else who reaches this page sees the list only.
 */
export function EntitiesPanel({
  entities,
  mayManage,
  agreementTerms
}: {
  entities: Entity[];
  mayManage: boolean;
  agreementTerms: AgreementTerms;
}) {
  const add = useRefusableAction<AdminResult>(addEntityAction);

  return (
    <section className="space-y-4 rounded border border-line bg-surface p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          Legal entities ({entities.length})
        </h2>
        <p className="max-w-prose text-sm text-ink-soft">
          The companies or bodies within this organisation that records are
          classified, reported and access-scoped by. Not services, products or
          departments. Records arriving with no entity named land in the
          default.
        </p>
      </div>

      <ul className="divide-y divide-line rounded border border-line">
        {entities.map((e) =>
          mayManage ? (
            <EntityRow
              key={e.id}
              entity={e}
              showAgreement={agreementTerms !== null}
            />
          ) : (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2.5 text-sm"
            >
              <span className="font-medium">{e.name}</span>
              <span className="font-mono text-[11px] text-ink-soft">
                {e.legalEntityRef ?? 'no reference'}
                {e.isDefault ? ' · default' : ''}
                {e.publicCommsProvider
                  ? ' · public communications provider'
                  : ''}
                {e.publicAuthority ? ' · public authority' : ''}
                {e.competentAuthority ? ' · competent authority (Part 3)' : ''}
              </span>
              {agreementTerms ? <AgreementRecord entity={e} /> : null}
            </li>
          )
        )}
      </ul>

      {mayManage ? (
        <>
          <form
            {...add.formProps}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="block space-y-1">
              <span className={label}>Add a legal entity</span>
              <input
                name="name"
                required
                minLength={2}
                placeholder="BBC Studios Distribution Limited"
                className={`${input} w-72`}
              />
            </label>
            <label className="block space-y-1">
              <span className={label}>Reference (optional)</span>
              <input
                name="legalEntityRef"
                placeholder="Company number or code"
                className={`${input} w-48 font-mono`}
              />
            </label>
            {agreementTerms ? (
              <div className="w-full space-y-3 rounded border border-line bg-ground p-4">
                <p className="max-w-prose text-sm">
                  A new legal entity is a new controller, and Waivern holds its
                  records as its processor. Adding it accepts the{' '}
                  <a
                    href={documentPath(agreementTerms.terms)}
                    target="_blank"
                    rel="noopener"
                    className="text-brand underline underline-offset-2"
                  >
                    Terms of Service
                  </a>{' '}
                  and the{' '}
                  <a
                    href={documentPath(agreementTerms.dpa)}
                    target="_blank"
                    rel="noopener"
                    className="text-brand underline underline-offset-2"
                  >
                    Data Processing Agreement
                  </a>{' '}
                  for it. Read both before you tick the boxes.
                </p>
                <KeyTerms />
                <EntityAgreementFields
                  entityName="the new legal entity"
                  terms={agreementTerms.terms}
                  dpa={agreementTerms.dpa}
                  defaultName={agreementTerms.defaultName}
                  idPrefix="new-entity"
                />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={add.pending}
              className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand disabled:opacity-50"
            >
              {add.pending
                ? 'Adding…'
                : agreementTerms
                  ? 'Accept and add'
                  : 'Add'}
            </button>
          </form>
          <Outcome result={add.result} />
          <p className="max-w-prose text-xs text-ink-soft">
            Renaming keeps every record with its entity. The Portal and any
            script that names an entity by its name or reference will need the
            new one. Entities cannot be removed: records and their history point
            at them.
          </p>
        </>
      ) : (
        <p className="max-w-prose text-xs text-ink-soft">
          Only an owner of the whole organisation can add or rename legal
          entities.
        </p>
      )}
    </section>
  );
}

function EntityRow({
  entity,
  showAgreement
}: {
  entity: Entity;
  showAgreement: boolean;
}) {
  const rename = useRefusableAction<AdminResult>(
    renameEntityAction.bind(null, entity.id),
    { resetOnSuccess: false }
  );
  const makeDefault = useRefusableAction<AdminResult>(
    makeDefaultEntityAction.bind(null, entity.id),
    {
      resetOnSuccess: false
    }
  );
  const provider = useRefusableAction<AdminResult>(
    setProviderAction.bind(null, entity.id, !entity.publicCommsProvider),
    { resetOnSuccess: false }
  );

  const authority = useRefusableAction<AdminResult>(
    setPublicAuthorityAction.bind(null, entity.id, !entity.publicAuthority),
    { resetOnSuccess: false }
  );
  const competent = useRefusableAction<AdminResult>(
    setCompetentAuthorityAction.bind(null, entity.id),
    {
      resetOnSuccess: false
    }
  );
  const foi = useRefusableAction<AdminResult>(
    setFreedomOfInformationAction.bind(null, entity.id),
    { resetOnSuccess: false }
  );
  const law = useRefusableAction<AdminResult>(
    setDataProtectionLawAction.bind(null, entity.id),
    {
      resetOnSuccess: false
    }
  );
  const uk = ukLawApplies(entity.dataProtectionLaw);
  const eu = entity.dataProtectionLaw !== 'uk';
  const irishYes = useRefusableAction<AdminResult>(
    setIeEprivacyAction.bind(null, entity.id, true),
    { resetOnSuccess: false }
  );
  const irishNo = useRefusableAction<AdminResult>(
    setIeEprivacyAction.bind(null, entity.id, false),
    { resetOnSuccess: false }
  );

  return (
    <li className="space-y-2 px-4 py-3">
      {showAgreement ? <AgreementRecord entity={entity} /> : null}
      {/* Keyed on the saved values, so a save rebuilds the fields from them; the
          row itself is not, so the message saying it saved survives. */}
      <form
        key={savedKey(entity.name, entity.legalEntityRef, entity.isDefault)}
        {...rename.formProps}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="block space-y-1">
          <span className="sr-only">Name of {entity.name}</span>
          <input
            name="name"
            required
            minLength={2}
            defaultValue={entity.name}
            className={`${input} w-72 font-medium`}
          />
        </label>
        <label className="block space-y-1">
          <span className="sr-only">Reference of {entity.name}</span>
          <input
            name="legalEntityRef"
            defaultValue={entity.legalEntityRef ?? ''}
            placeholder="no reference"
            className={`${input} w-48 font-mono`}
          />
        </label>
        <button
          type="submit"
          disabled={rename.pending}
          className="rounded border border-line bg-surface px-3 py-2 text-xs hover:border-brand disabled:opacity-50"
        >
          {rename.pending ? 'Saving…' : 'Save'}
        </button>
        {entity.isDefault ? (
          <span className="rounded border border-emerald-700 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-900">
            default
          </span>
        ) : null}
      </form>
      {entity.isDefault ? null : (
        <form {...makeDefault.formProps}>
          <button
            type="submit"
            disabled={makeDefault.pending}
            className="text-xs text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
          >
            Make this the default
          </button>
        </form>
      )}
      <Outcome result={rename.result} />
      <Outcome result={makeDefault.result} />
      <form
        key={savedKey(entity.dataProtectionLaw)}
        {...law.formProps}
        className="flex flex-wrap items-baseline gap-2 text-xs"
      >
        <label className="flex flex-wrap items-baseline gap-2">
          <span className="text-ink-soft">
            Data protection law it is subject to:
          </span>
          <select
            name="dataProtectionLaw"
            defaultValue={entity.dataProtectionLaw}
            className="rounded border border-line bg-ground px-2 py-1 text-xs"
          >
            {(Object.keys(DATA_PROTECTION_LAWS) as DataProtectionLaw[]).map(
              (k) => (
                <option
                  key={k}
                  value={k}
                >
                  {DATA_PROTECTION_LAWS[k]}
                </option>
              )
            )}
          </select>
        </label>
        <button
          type="submit"
          disabled={law.pending}
          className="text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
        >
          Save
        </button>
      </form>
      <Outcome result={law.result} />
      <EstablishmentForm
        entityId={entity.id}
        name={entity.name}
        law={entity.dataProtectionLaw}
        establishment={entity.establishment}
      />
      {eu ? (
        <div className="space-y-1 text-xs">
          {entity.ieEprivacySuggested ? (
            <p className="rounded border border-amber-700 bg-amber-50 px-2 py-1 text-amber-900">
              {entity.name} is established in Ireland or led by the Data
              Protection Commission. Say whether the Irish ePrivacy Regulations
              apply to it.
            </p>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-ink-soft">
              Irish ePrivacy Regulations (S.I. 336/2011):
            </span>
            <span className="rounded border border-line px-2 py-0.5 font-mono text-[11px]">
              {entity.ieEprivacy === true
                ? 'subject to them'
                : entity.ieEprivacy === false
                  ? 'not subject to them'
                  : 'not answered'}
            </span>
            {entity.ieEprivacy === true ? null : (
              <form {...irishYes.formProps}>
                <button
                  type="submit"
                  disabled={irishYes.pending}
                  className="text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
                >
                  Subject to them
                </button>
              </form>
            )}
            {entity.ieEprivacy === false ? null : (
              <form {...irishNo.formProps}>
                <button
                  type="submit"
                  disabled={irishNo.pending}
                  className="text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
                >
                  Not subject to them
                </button>
              </form>
            )}
          </div>
          <Outcome result={irishYes.result} />
          <Outcome result={irishNo.result} />
        </div>
      ) : null}
      {uk ? (
        <>
          <form
            {...provider.formProps}
            className="flex flex-wrap items-baseline gap-2 text-xs"
          >
            {entity.publicCommsProvider ? (
              <span className="rounded border border-line px-2 py-0.5 font-mono text-[11px]">
                public communications provider
              </span>
            ) : null}
            <button
              type="submit"
              disabled={provider.pending}
              className="text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
            >
              {entity.publicCommsProvider
                ? 'Not a public communications provider'
                : 'Mark as a public communications provider (PECR reg 5A)'}
            </button>
          </form>
          <form
            {...authority.formProps}
            className="flex flex-wrap items-baseline gap-2 text-xs"
          >
            {entity.publicAuthority ? (
              <span className="rounded border border-line px-2 py-0.5 font-mono text-[11px]">
                public authority
              </span>
            ) : null}
            <button
              type="submit"
              disabled={authority.pending}
              className="text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
            >
              {entity.publicAuthority
                ? 'Not a public authority'
                : 'Mark as a public authority (Data Protection Act 2018 s.7)'}
            </button>
          </form>
          <Outcome result={provider.result} />
          <form
            key={savedKey(entity.competentAuthority, entity.defaultRegime)}
            {...competent.formProps}
            className="flex flex-wrap items-baseline gap-2 text-xs"
          >
            <label className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-soft">
                Law enforcement (Data Protection Act 2018 Part 3, s.30):
              </span>
              <select
                name="competentAuthority"
                defaultValue={
                  !entity.competentAuthority
                    ? 'no'
                    : entity.defaultRegime === 'dpa_part3'
                      ? 'part3'
                      : 'yes'
                }
                className="rounded border border-line bg-ground px-2 py-1 text-xs"
              >
                <option value="no">Not a competent authority</option>
                <option value="yes">
                  A competent authority; new records start under the UK GDPR
                </option>
                <option value="part3">
                  A competent authority; new records start under Part 3
                </option>
              </select>
            </label>
            <button
              type="submit"
              disabled={competent.pending}
              className="text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
            >
              Save
            </button>
          </form>
          <Outcome result={authority.result} />
          <Outcome result={competent.result} />
          <form
            key={savedKey(
              entity.foiAct,
              entity.foiTimeProfile,
              entity.foiCoveredFor
            )}
            {...foi.formProps}
            className="flex flex-wrap items-baseline gap-2 text-xs"
          >
            <label className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-soft">Freedom of information:</span>
              <select
                name="foiAct"
                defaultValue={entity.foiAct ?? 'none'}
                className="rounded border border-line bg-ground px-2 py-1 text-xs"
              >
                <option value="none">Does not answer FOI requests</option>
                <option value="foia">
                  Freedom of Information Act 2000 and the EIR
                </option>
                <option value="foisa">
                  Freedom of Information (Scotland) Act 2002 and the EI(S)R
                </option>
              </select>
            </label>
            <label className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-soft">Time limits:</span>
              <select
                name="foiTimeProfile"
                defaultValue={entity.foiTimeProfile}
                className="rounded border border-line bg-ground px-2 py-1 text-xs"
              >
                <option value="standard">Standard</option>
                <option value="school">A school or academy</option>
                <option value="archive">An archive</option>
              </select>
            </label>
            <label className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-soft">
                Covered only for (leave blank if for everything):
              </span>
              <input
                name="foiCoveredFor"
                defaultValue={entity.foiCoveredFor ?? ''}
                className="rounded border border-line bg-ground px-2 py-1 text-xs"
              />
            </label>
            <button
              type="submit"
              disabled={foi.pending}
              className="text-ink-soft underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
            >
              Save
            </button>
          </form>
          <Outcome result={foi.result} />
        </>
      ) : (
        <p className="text-xs text-ink-soft">
          The public authority, competent authority and PECR settings are UK
          law, so are not offered for an entity subject to EU law only.
        </p>
      )}
    </li>
  );
}

/** Who accepted the terms and agreement for an entity, and when. */
function AgreementRecord({ entity }: { entity: Entity }) {
  const a = entity.agreement;
  if (!a)
    return (
      <p className="w-full text-xs text-red-800">
        The Terms of Service and Data Processing Agreement have not been
        accepted for this entity.
      </p>
    );
  return (
    <p className="w-full text-xs text-ink-soft">
      Terms ({versionLabel(a.termsVersion)}) and Data Processing Agreement (
      {versionLabel(a.dpaVersion)}) accepted by {a.acceptedByName},{' '}
      {a.acceptedByPosition}, on{' '}
      {new Date(a.acceptedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })}
      .
    </p>
  );
}
