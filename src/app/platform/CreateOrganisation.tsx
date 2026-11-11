'use client';

import { inputClass } from '@/components/form-classes';
import { useRefusableAction } from '@/lib/use-refusable-action';

import { createOrganisationAction, type DecisionResult } from './actions';

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
  const { result, pending, formProps } = useRefusableAction<DecisionResult>(
    createOrganisationAction,
    { resetOnSuccess: true }
  );
  return (
    <form
      {...formProps}
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
      {result ? (
        <p
          role="alert"
          className={`rounded border px-3 py-2 text-sm ${
            result.ok
              ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
              : 'border-amber-700 bg-amber-50 text-amber-900'
          }`}
        >
          {result.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {pending ? 'Setting up…' : 'Create the organisation'}
      </button>
    </form>
  );
}
