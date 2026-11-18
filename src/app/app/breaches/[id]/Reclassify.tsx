import { EditForm } from '@/components/EditForm';
import { inputClass } from '@/components/form-classes';
import { savedKey } from '@/lib/saved-key';
import type { Breach } from '@/services/breaches';

import { reclassifyBreachAction } from '../actions';

const stamp = (d: Date) =>
  d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * Breach or near miss, and the latest change between them.
 *
 * A near miss found to be a breach is asked when its seventy-two hours runs
 * from. Discovery comes first because that is where a regulator is likely to
 * count from: the facts were there to be seen from then, and a later date is
 * a judgement somebody may have to defend.
 */
export function Reclassify({
  breach,
  notified,
  mayEdit
}: {
  breach: Breach;
  /** Whether an authority or the people affected have already been told. */
  notified: boolean;
  mayEdit: boolean;
}) {
  const toBreach = breach.classification === 'near_miss';
  if (!mayEdit && !breach.reclassifiedAt) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Breach or near miss</h2>
      {breach.reclassifiedAt ? (
        <div className="space-y-1 rounded border border-line bg-surface px-4 py-3">
          <p className="text-sm">
            Reclassified as {toBreach ? 'a near miss' : 'a breach'} on{' '}
            {stamp(breach.reclassifiedAt)}.
          </p>
          <p className="max-w-prose text-sm text-ink-soft">
            {breach.reclassificationRationale}
          </p>
          {!toBreach ? (
            <p className="text-xs text-ink-soft">
              The seventy-two hours counts from{' '}
              {breach.awareAt
                ? `${stamp(breach.awareAt)}, when it became known to be a breach (discovered ${stamp(breach.discoveredAt)}).`
                : `its discovery, ${stamp(breach.discoveredAt)}.`}
            </p>
          ) : null}
        </div>
      ) : null}
      {mayEdit ? (
        <details className="rounded border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            {toBreach ? 'Reclassify as a breach' : 'Reclassify as a near miss'}
          </summary>
          <EditForm
            key={savedKey(breach)}
            action={reclassifyBreachAction.bind(null, breach.id)}
            className="space-y-3 border-t border-line p-4"
          >
            <input
              type="hidden"
              name="classification"
              value={toBreach ? 'breach' : 'near_miss'}
            />
            {toBreach ? (
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                  When the seventy-two hours runs from
                </legend>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="clockFrom"
                    value="discovery"
                    defaultChecked
                    className="mt-1 accent-brand"
                  />
                  <span>
                    From its discovery, {stamp(breach.discoveredAt)}
                    <span className="block text-xs text-ink-soft">
                      Where regulators are likely to count from: the facts were
                      there to be seen, and awareness under Article 33(1) is
                      when you could reasonably have known. It may already be
                      overdue, with the reasons for the delay owed.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="clockFrom"
                    value="later"
                    className="mt-1 accent-brand"
                  />
                  <span>
                    From when it became known to be a breach
                    <span className="block text-xs text-ink-soft">
                      Only where something new came to light then. Say what it
                      was below, as a regulator may ask why the clock started
                      late.
                    </span>
                  </span>
                </label>
                <input
                  name="awareAt"
                  type="datetime-local"
                  aria-label="When it became known to be a breach"
                  className={inputClass}
                />
              </fieldset>
            ) : (
              <p className="max-w-prose text-xs text-ink-soft">
                Its clocks stop and any open deadline tasks are retired.
                {notified
                  ? ' The notifications already made stay on the record.'
                  : ''}
              </p>
            )}
            <label className="block space-y-1">
              <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
                Why
                <span className="block font-normal normal-case tracking-normal">
                  {toBreach
                    ? 'What showed that personal data was compromised.'
                    : 'What showed that no personal data was compromised.'}
                </span>
              </span>
              <textarea
                name="rationale"
                required
                rows={3}
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              className="rounded border border-line px-3.5 py-1.5 text-sm font-medium hover:bg-ground focus-visible:outline-2 focus-visible:outline-brand"
            >
              {toBreach
                ? 'Reclassify as a breach'
                : 'Reclassify as a near miss'}
            </button>
          </EditForm>
        </details>
      ) : null}
    </section>
  );
}
