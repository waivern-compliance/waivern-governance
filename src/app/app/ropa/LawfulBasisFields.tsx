'use client';

import { useState } from 'react';

import {
  basesFor,
  LAWFUL_BASES,
  LAWFUL_BASIS_KEYS,
  RECOGNISED_CONDITION_KEYS,
  RECOGNISED_CONDITIONS,
  type LawfulBasis,
  type RecognisedCondition
} from '@/lib/gdpr/lawful-basis';

const label =
  'block text-xs font-medium uppercase tracking-wider text-ink-soft';

/**
 * The Article 6(1) bases an activity relies on, chosen rather than described.
 *
 * The Annex 1 condition is asked only once recognised legitimate interests is
 * ticked, because that basis means nothing without one. The free text stays,
 * as a note: it is where the basis used to be written, and where the Portal
 * still sends it.
 *
 * Under EU law only, recognised legitimate interests is not offered: it is the
 * UK's own basis. A record that already relies on it keeps the box, ticked,
 * with a notice, so the person sees it and chooses what replaces it.
 */
export function LawfulBasisFields({
  bases,
  condition,
  note,
  publicAuthority = false,
  outsidePublicTasks = false,
  ukLaw = true,
  euLaw = false,
  euPublicBody = false
}: {
  bases: readonly LawfulBasis[];
  condition: RecognisedCondition | null;
  note: string;
  /** The entity is a public authority: legitimate interests is not for its tasks. */
  publicAuthority?: boolean;
  outsidePublicTasks?: boolean;
  /** The record is under UK law, where recognised legitimate interests exists. */
  ukLaw?: boolean;
  /** The record is under EU law, which has the six original bases only. */
  euLaw?: boolean;
  /** The entity is a public authority or body under a member State's law. */
  euPublicBody?: boolean;
}) {
  const [recognised, setRecognised] = useState(
    bases.includes('recognised_legitimate_interests')
  );
  const [legitimate, setLegitimate] = useState(
    bases.includes('legitimate_interests')
  );
  const [others, setOthers] = useState(
    bases.some((b) => b !== 'recognised_legitimate_interests')
  );
  // Article 6(1), final subparagraph, under each law: a UK public authority
  // may rely on neither (f) nor (ea) for its tasks, an EU public body not on (f).
  const ukBarred = ukLaw && publicAuthority && (recognised || legitimate);
  const euBarred = euLaw && euPublicBody && legitimate;

  return (
    <fieldset className="space-y-3">
      <legend className={label}>
        Lawful basis
        <span className="block font-normal normal-case tracking-normal">
          Article 6(1) - each basis this processing relies on
        </span>
      </legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {LAWFUL_BASIS_KEYS.filter(
          (b) => basesFor(ukLaw).includes(b) || bases.includes(b)
        ).map((b) => (
          <label
            key={b}
            className="flex items-start gap-2.5 text-sm"
          >
            <input
              type="checkbox"
              name="lawfulBases"
              value={b}
              defaultChecked={bases.includes(b)}
              onChange={(e) => {
                const ticked = Array.from(
                  e.currentTarget.form?.querySelectorAll<HTMLInputElement>(
                    'input[name="lawfulBases"]:checked'
                  ) ?? []
                ).map((i) => i.value);
                setRecognised(
                  ticked.includes('recognised_legitimate_interests')
                );
                setLegitimate(ticked.includes('legitimate_interests'));
                setOthers(
                  ticked.some((t) => t !== 'recognised_legitimate_interests')
                );
              }}
              className="mt-1 accent-brand"
            />
            <span>
              {LAWFUL_BASES[b].label}{' '}
              <span className="font-mono text-[11px] text-ink-soft">
                {LAWFUL_BASES[b].point}
              </span>
            </span>
          </label>
        ))}
      </div>
      {ukBarred || euBarred ? (
        <div className="space-y-2 rounded border border-red-800 bg-red-50 px-3 py-2 text-xs text-red-900">
          <p>
            {ukBarred
              ? 'This entity is a public authority. UK GDPR Article 6(1) does not let a public authority rely on legitimate interests or recognised legitimate interests for processing in the performance of its tasks: those rest on public task (Article 6(1)(e)) or another basis.'
              : 'This entity is a public authority or body under the law of a member State. EU GDPR Article 6(1) does not let it rely on legitimate interests for processing in the performance of its tasks: those rest on public task (Article 6(1)(e)) or another basis.'}
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="outsidePublicTasks"
              defaultChecked={outsidePublicTasks}
              className="mt-0.5 accent-brand"
            />
            <span>
              This processing is not in the performance of the authority&apos;s
              tasks
            </span>
          </label>
        </div>
      ) : null}
      {!ukLaw && recognised ? (
        <p className="rounded border border-red-800 bg-red-50 px-3 py-2 text-xs text-red-900">
          This record is under EU law only. Recognised legitimate interests is a
          basis in UK law only (UK GDPR Article 6(1)(ea)); the EU GDPR has no
          equivalent. Untick it and choose the basis this processing rests on
          under EU law, such as legitimate interests with an assessment.
        </p>
      ) : null}
      {recognised && ukLaw && euLaw && !others ? (
        <p className="rounded border border-red-800 bg-red-50 px-3 py-2 text-xs text-red-900">
          This record is under the EU GDPR as well. Recognised legitimate
          interests answers for the UK side only; the EU GDPR has no such basis,
          so tick the basis this processing rests on under EU law too.
        </p>
      ) : null}
      {recognised && ukLaw ? (
        <label className="block space-y-1">
          <span className={label}>
            Annex 1 condition
            <span className="block font-normal normal-case tracking-normal">
              No balancing test is needed, but the right to object still
              applies, and a significant decision may not rest solely on
              automated processing under this basis (Article 22B).
            </span>
          </span>
          <select
            name="recognisedCondition"
            defaultValue={condition ?? ''}
            className="w-full rounded border border-line bg-ground px-3 py-2 text-sm"
          >
            <option value="">Not yet chosen</option>
            {RECOGNISED_CONDITION_KEYS.map((c) => (
              <option
                key={c}
                value={c}
              >
                {RECOGNISED_CONDITIONS[c].label} -{' '}
                {RECOGNISED_CONDITIONS[c].paragraph}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block space-y-1">
        <span className={label}>
          Note on the basis
          <span className="block font-normal normal-case tracking-normal">
            Optional. Which purpose rests on which basis, or the basis as the
            Portal sent it.
          </span>
        </span>
        <input
          name="lawfulBasis"
          defaultValue={note}
          className="w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand"
        />
      </label>
    </fieldset>
  );
}
