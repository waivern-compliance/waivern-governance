'use client';

import { useActionState, useState } from 'react';

import { IE_BASES, IE_BASIS_KEYS } from '@/lib/ie-eprivacy/storage';
import {
  BASES,
  BASIS_KEYS,
  type BasisSpec,
  type StorageBasis
} from '@/lib/pecr/statutory';

import type { RequestResult } from '../requests/actions';

const input =
  'w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand';

/**
 * Record the basis for one item under one law: PECR's Schedule A1, or
 * regulation 5 of the Irish Regulations. The conditions shown follow the basis
 * chosen, so the person confirms exactly what that provision needs.
 */
export function BasisForm({
  action,
  current,
  suggested,
  law = 'uk'
}: {
  action: (prev: RequestResult, formData: FormData) => Promise<RequestResult>;
  current: StorageBasis | null;
  suggested: StorageBasis | null;
  law?: 'uk' | 'ie';
}) {
  const bases: Partial<Record<StorageBasis, BasisSpec>> =
    law === 'ie' ? IE_BASES : BASES;
  const keys: StorageBasis[] = law === 'ie' ? IE_BASIS_KEYS : BASIS_KEYS;
  const usable = (b: StorageBasis | null) => (b && b in bases ? b : null);
  const [result, run, pending] = useActionState<RequestResult, FormData>(
    action,
    null
  );
  const [basis, setBasis] = useState<StorageBasis>(
    usable(current) ?? usable(suggested) ?? 'consent'
  );
  const spec = bases[basis] ?? bases.consent!;

  return (
    <form
      action={run}
      className="space-y-3 border-t border-line pt-3"
    >
      <input
        type="hidden"
        name="law"
        value={law}
      />
      <label className="block space-y-1">
        <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
          Basis
          {usable(suggested) && !current ? (
            <span className="block font-normal normal-case tracking-normal">
              The scanner&apos;s category suggests{' '}
              {bases[suggested!]!.label.toLowerCase()}. Check it: a suggestion
              is not a decision.
            </span>
          ) : null}
        </span>
        <select
          name="basis"
          value={basis}
          onChange={(e) => setBasis(e.target.value as StorageBasis)}
          className={input}
        >
          {keys.map((b) => (
            <option
              key={b}
              value={b}
            >
              {bases[b]!.label} - {bases[b]!.citation}
            </option>
          ))}
        </select>
      </label>
      <p className="max-w-prose text-xs text-ink-soft">{spec.summary}</p>
      {spec.conditions.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">
            Confirm
          </legend>
          {spec.conditions.map((c) => (
            <label
              key={c.key}
              className="flex items-start gap-2.5 text-sm"
            >
              <input
                type="checkbox"
                name="conditions"
                value={c.key}
                className="mt-1 accent-brand"
              />
              <span>{c.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {spec.needsObjection ? (
        <p className="max-w-prose text-xs text-ink-soft">
          It also needs the website&apos;s information and a simple, free way to
          object, recorded once for the whole site above.
        </p>
      ) : null}
      <label className="block space-y-1">
        <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
          Why
        </span>
        <textarea
          name="rationale"
          required
          rows={2}
          className={input}
        />
      </label>
      {result ? (
        <p
          role="alert"
          className={`rounded border px-4 py-2.5 text-sm ${
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
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {pending ? 'Saving…' : 'Record the basis'}
      </button>
    </form>
  );
}
