import { EditForm } from '@/components/EditForm';
import {
  CLASSIFICATION_SCHEMES,
  type ClassificationScheme
} from '@/lib/assets/register';
import { savedKey } from '@/lib/saved-key';

import { setClassificationSchemeAction } from '../../assets/actions';

/**
 * The information asset register's classification scheme. Shown locked, with
 * the reason, once any asset is classified, as the risk scale is.
 */
export function ClassificationForm({
  current,
  classified
}: {
  current: ClassificationScheme;
  classified: number;
}) {
  const locked = classified > 0;
  return (
    <EditForm
      key={savedKey(current)}
      action={setClassificationSchemeAction}
      className="space-y-3 rounded border border-line bg-surface p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Asset classification</h2>
        <p className="max-w-prose text-sm text-ink-soft">
          The levels the information asset register classifies on. Use the
          Government Security Classifications if you mark information under
          them; otherwise the neutral set.
        </p>
      </div>
      <fieldset
        className="space-y-2"
        disabled={locked}
      >
        {(
          Object.entries(CLASSIFICATION_SCHEMES) as Array<
            [
              ClassificationScheme,
              (typeof CLASSIFICATION_SCHEMES)[ClassificationScheme]
            ]
          >
        ).map(([id, s]) => (
          <label
            key={id}
            className="flex items-start gap-3 rounded border border-line bg-ground px-3 py-2.5 text-sm"
          >
            <input
              type="radio"
              name="scheme"
              value={id}
              defaultChecked={id === current}
              className="mt-1 accent-brand"
            />
            <span className="space-y-0.5">
              <span className="block font-medium">{s.name}</span>
              <span className="block text-xs text-ink-soft">
                {s.description}
              </span>
              <span className="block font-mono text-[11px] text-ink-soft">
                {Object.values(s.levels).join(' · ')}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {locked ? (
        <p className="max-w-prose rounded border-l-2 border-line px-3 py-2 text-xs text-ink-soft">
          Fixed: {classified} asset{classified === 1 ? ' is' : 's are'}{' '}
          classified on this scheme. Reclassifying is a decision for people, not
          a conversion: clear the classifications first to change scheme.
        </p>
      ) : (
        <button
          type="submit"
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Use this scheme
        </button>
      )}
    </EditForm>
  );
}
