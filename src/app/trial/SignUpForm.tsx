'use client';

import { FICTIONAL_ONLY } from '@/lib/trial-rules';
import { useRefusableAction } from '@/lib/use-refusable-action';

import { requestTrialLinkAction, type TrialResult } from './actions';

const field =
  'w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand';
const label =
  'block text-xs font-medium uppercase tracking-wider text-ink-soft';

export function SignUpForm({ started }: { started: string }) {
  const { result, pending, formProps } = useRefusableAction<TrialResult>(
    requestTrialLinkAction
  );
  return (
    <form
      {...formProps}
      className="space-y-4 rounded border border-line bg-surface p-5"
    >
      <input
        type="hidden"
        name="started"
        value={started}
      />
      {/* Hidden from people; anything in it, and it was not a person. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label>
          Website
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className={label}>Your work email</span>
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="you@yourcompany.example"
          className={field}
        />
        <span className="block text-xs text-ink-soft">
          A work address helps us follow up properly. A personal one works too.
        </span>
      </label>
      <label className="block space-y-1">
        <span className={label}>
          Your organisation{' '}
          <span className="font-normal normal-case tracking-normal">
            - optional
          </span>
        </span>
        <input
          name="organisationName"
          maxLength={120}
          autoComplete="organization"
          className={field}
        />
      </label>
      <div className="space-y-2 rounded border border-amber-700 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">Fictional data only</p>
        <p>{FICTIONAL_ONLY}</p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="fictionalOnly"
            required
            className="mt-1"
          />
          <span>
            I accept that this trial is for exploring with fictional data, and I
            will not enter real personal data.
          </span>
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Email me a link'}
      </button>
      {result ? (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`text-sm ${result.ok ? 'text-emerald-800' : 'text-red-800'}`}
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
