import {
  SCC_MODULES,
  TRANSFER_MECHANISM_KEYS,
  TRANSFER_MECHANISMS,
  type RecordedMechanism
} from '@/lib/gdpr/transfers';

/**
 * The transfer mechanisms an agreement relies on, chosen from each law's
 * tools. The text field beside it stays as the note; where nothing is ticked,
 * text that names the mechanisms plainly is read instead.
 */
export function MechanismFields({
  recorded = []
}: {
  recorded?: readonly RecordedMechanism[];
}) {
  const chosen = new Set(recorded.map((r) => r.mechanism));
  const scc = recorded.find((r) => r.mechanism === 'eu_scc');
  return (
    <fieldset className="space-y-1.5">
      <input
        type="hidden"
        name="mechanismsAsked"
        value="yes"
      />
      <legend className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
        Transfer mechanisms
        <span className="block font-normal normal-case tracking-normal">
          Tick each the agreement relies on. A UK transfer needs a UK tool and
          an EU transfer an EU one: the EU clauses alone are not a UK safeguard.
        </span>
      </legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {TRANSFER_MECHANISM_KEYS.map((m) => (
          <label
            key={m}
            className="flex items-start gap-2 text-xs"
          >
            <input
              type="checkbox"
              name="transferMechanisms"
              value={m}
              defaultChecked={chosen.has(m)}
              className="mt-0.5 accent-brand"
            />
            <span>
              {TRANSFER_MECHANISMS[m].label}{' '}
              <span className="font-mono text-[11px] text-ink-soft">
                {TRANSFER_MECHANISMS[m].point}
              </span>
            </span>
          </label>
        ))}
      </div>
      <label className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="text-ink-soft">EU clauses module:</span>
        <select
          name="sccModule"
          defaultValue={scc?.module ? String(scc.module) : ''}
          className="rounded border border-line bg-surface px-2 py-1 text-xs"
        >
          <option value="">Not recorded</option>
          {Object.entries(SCC_MODULES).map(([k, label]) => (
            <option
              key={k}
              value={k}
            >
              {label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
