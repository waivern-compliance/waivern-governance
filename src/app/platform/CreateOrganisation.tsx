'use client';

import { RefusableForm } from '@/components/foi/RefusableForm';
import { inputClass } from '@/components/form-classes';

import { createOrganisationAction } from './actions';

/**
 * Set an organisation up without a request: a new client, or one of
 * Waivern's own. The owner defaults to the operator; name the client's
 * contact instead to hand it over.
 */
export function CreateOrganisation({
  operatorEmail
}: {
  operatorEmail: string;
}) {
  return (
    <RefusableForm
      action={createOrganisationAction}
      submit="Create the organisation"
      pendingLabel="Setting up…"
      className="space-y-3 rounded border border-line bg-surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Organisation</span>
          <input
            name="organisationName"
            required
            maxLength={120}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">
            First legal entity{' '}
            <span className="font-normal text-ink-soft">(if not the same)</span>
          </span>
          <input
            name="entityName"
            maxLength={120}
            className={inputClass}
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Owner&apos;s email</span>
        <span className="block text-xs text-ink-soft">
          Yours by default. Name the client&apos;s contact instead to hand it
          over: they become its owner when they first sign in, and accept the
          terms then. Either way, the owner can invite everybody else.
        </span>
        <input
          name="ownerEmail"
          type="email"
          required
          defaultValue={operatorEmail}
          className={inputClass}
        />
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          name="sameNameConfirmed"
          className="mt-0.5 accent-brand"
        />
        <span>
          Create it even so
          <span className="block text-ink-soft">
            Only if an organisation of the same name already exists and this is
            a different one.
          </span>
        </span>
      </label>
    </RefusableForm>
  );
}
