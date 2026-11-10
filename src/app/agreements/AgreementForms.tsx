'use client';

import { EntityAgreementFields } from '@/components/legal/AgreementParts';
import type { DocumentRef } from '@/lib/legal/shared';
import { useRefusableAction } from '@/lib/use-refusable-action';

import {
  acceptForEntityAction,
  acceptTermsAction,
  type AgreementResult
} from './actions';

const button =
  'rounded bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

function Refusal({ result }: { result: AgreementResult }) {
  if (!result || result.ok) return null;
  return (
    <p
      role="alert"
      className="text-sm text-red-800"
    >
      {result.message}
    </p>
  );
}

/** Accepting the terms for oneself. */
export function PersonalTermsForm({ terms }: { terms: DocumentRef }) {
  const accept = useRefusableAction<AgreementResult>(acceptTermsAction, {
    resetOnSuccess: false
  });
  return (
    <form
      {...accept.formProps}
      className="space-y-3"
    >
      <input
        type="hidden"
        name="termsVersion"
        value={terms.version}
      />
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          name="acceptTerms"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
        />
        <span>
          I have read the {terms.title} above and accept them personally, as a
          user of the service.
        </span>
      </label>
      <button
        type="submit"
        disabled={accept.pending}
        className={button}
      >
        {accept.pending ? 'Recording…' : 'I accept the Terms of Service'}
      </button>
      <Refusal result={accept.result} />
    </form>
  );
}

/** Accepting the terms and the agreement for one legal entity. */
export function EntityAgreementForm({
  entity,
  terms,
  dpa,
  defaultName
}: {
  entity: { id: string; name: string };
  terms: DocumentRef;
  dpa: DocumentRef;
  defaultName: string;
}) {
  const accept = useRefusableAction<AgreementResult>(
    acceptForEntityAction.bind(null, entity.id),
    { resetOnSuccess: false }
  );
  return (
    <form
      {...accept.formProps}
      className="space-y-4"
    >
      <EntityAgreementFields
        entityName={entity.name}
        terms={terms}
        dpa={dpa}
        defaultName={defaultName}
        idPrefix={`entity-${entity.id}`}
      />
      <button
        type="submit"
        disabled={accept.pending}
        className={button}
      >
        {accept.pending ? 'Recording…' : `Accept for ${entity.name}`}
      </button>
      <Refusal result={accept.result} />
    </form>
  );
}
