'use client';

import {
  requestTrialChangeAction,
  type TrialResult
} from '@/app/trial/actions';
import { useRefusableAction } from '@/lib/use-refusable-action';

const field =
  'w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand';
const label =
  'block text-xs font-medium uppercase tracking-wider text-ink-soft';

/** Ask the platform administrators for more time, or for a full account. */
export function ChangeRequestForm({
  organisationName = ''
}: {
  /** What they gave at sign-up, if anything, to start from. */
  organisationName?: string;
}) {
  const { result, pending, formProps } = useRefusableAction<TrialResult>(
    requestTrialChangeAction
  );
  return (
    <form
      {...formProps}
      className="space-y-4 rounded border border-line bg-surface p-5"
    >
      <fieldset className="space-y-2">
        <legend className={label}>What you would like</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="kind"
            value="convert"
            defaultChecked
          />
          A full account for my organisation
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="kind"
            value="extend"
          />
          More time to try it
        </label>
      </fieldset>
      <label className="block space-y-1">
        <span className={label}>Your organisation</span>
        <input
          name="organisationName"
          required
          maxLength={120}
          defaultValue={organisationName}
          placeholder="Example Ltd"
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className={label}>What you would use it for</span>
        <textarea
          name="message"
          required
          rows={4}
          maxLength={2000}
          placeholder="Who you are, what you want to manage in it, and how long you need"
          className={field}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send to the administrators'}
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
