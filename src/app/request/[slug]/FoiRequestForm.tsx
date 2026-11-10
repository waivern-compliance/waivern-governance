'use client';

import { useRefusableAction } from '@/lib/use-refusable-action';
import type { IntakeResult } from '@/services/dsr-intake';

import { submitInformationRequestAction } from './actions';
import { Confirmation } from './Confirmation';

const input = 'w-full rounded border border-line bg-surface px-3 py-2 text-sm';

/**
 * The public freedom of information request form. Asks only what a valid
 * request needs (FOIA s.8) and never why the information is wanted. A refusal
 * keeps everything typed.
 */
export function FoiRequestForm({
  slug,
  started,
  authorityName,
  limits,
  environmentalAsks
}: {
  slug: string;
  started: string;
  authorityName: string;
  limits: {
    name: number;
    address: number;
    description: number;
    preferredMeans: number;
  };
  environmentalAsks: Array<[string, string]>;
}) {
  const { result, pending, formProps } =
    useRefusableAction<IntakeResult | null>(
      submitInformationRequestAction.bind(null, slug)
    );

  if (result?.ok) {
    return (
      <Confirmation>
        <h2 className="text-lg font-semibold">Your request has been sent</h2>
        <p className="text-sm">
          Your reference is{' '}
          <strong className="font-mono">{result.reference}</strong>. Keep it:
          quote it in anything you send {authorityName} about this request.
        </p>
        <p className="text-sm">{result.dueWords}</p>
        <p className="text-sm">
          If they need more detail to find the information, or charge a fee,
          they will contact you, and the time can change. This page does not
          show the progress of your request; they will reply to the address you
          gave.
        </p>
      </Confirmation>
    );
  }

  return (
    <form
      {...formProps}
      className="space-y-6"
    >
      <input
        type="hidden"
        name="started"
        value={started}
      />
      {/* Left empty by people; filled by software that fills in every field it sees. */}
      <div
        aria-hidden="true"
        className="absolute -left-[10000px] h-px w-px overflow-hidden"
      >
        <label>
          Website
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Your full name</span>
          <span className="block text-xs text-ink-soft">
            Your real name: a request under a made-up name is not valid.
          </span>
          <input
            name="requesterName"
            required
            maxLength={limits.name}
            autoComplete="name"
            className={input}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Where should the reply go?</span>
          <span className="block text-xs text-ink-soft">
            An email address or a postal address.
          </span>
          <input
            name="correspondenceAddress"
            required
            maxLength={limits.address}
            autoComplete="email"
            className={input}
          />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">What information do you want?</span>
        <span className="block text-xs text-ink-soft">
          Describe it as clearly as you can: what it is about, and any dates or
          names that help them find it. You do not have to say why you want it.
        </span>
        <textarea
          name="description"
          required
          rows={6}
          maxLength={limits.description}
          className={input}
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Is it about the environment?
        </legend>
        <p className="text-xs text-ink-soft">
          For example air, water, land, wildlife, pollution, waste, planning or
          building works that affect them. Different rules apply, and they will
          check either way.
        </p>
        {environmentalAsks.map(([value, label], i) => (
          <label
            key={value}
            className="flex items-center gap-2 text-sm"
          >
            <input
              type="radio"
              name="environmental"
              value={value}
              defaultChecked={i === 0}
              className="accent-brand"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">
          How would you like to receive it?{' '}
          <span className="font-normal text-ink-soft">(optional)</span>
        </span>
        <span className="block text-xs text-ink-soft">
          For example a copy by email, a spreadsheet, a summary, or a chance to
          look at it in person.
        </span>
        <input
          name="preferredMeans"
          maxLength={limits.preferredMeans}
          className={input}
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="aboutThemselves"
          className="mt-1 accent-brand"
        />
        <span>
          I am asking for information about myself, such as my own records or
          correspondence.
        </span>
      </label>

      <p className="max-w-prose text-xs text-ink-soft">
        What you enter here is used only to handle this request.
      </p>

      {result && !result.ok ? (
        <p
          role="alert"
          className="rounded border border-amber-700 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
        >
          {result.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {pending ? 'Sending…' : 'Send the request'}
      </button>
    </form>
  );
}
