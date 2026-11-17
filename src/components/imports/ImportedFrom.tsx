import type { ReactNode } from 'react';
import Link from 'next/link';

import type { SourceEvent } from '@/lib/import/types';

/**
 * Where an imported record came from, the source's fields Govern has no home
 * for, and, while it waits, a way for a person to confirm it. Imported
 * records wait for that confirmation (docs/migration-plan.md, decision 2).
 */
export function ImportedFrom({
  sourceName,
  batchId,
  confirmed,
  legacy,
  history,
  confirm
}: {
  sourceName: string;
  batchId: string | null;
  confirmed: boolean;
  legacy: Record<string, string> | null;
  /** What the old platform recorded happening to it: its account, not ours. */
  history?: SourceEvent[] | null;
  /** The confirm control, where this person may confirm it. */
  confirm?: ReactNode;
}) {
  const kept = Object.entries(legacy ?? {});
  return (
    <section
      className={`space-y-3 rounded border p-5 text-sm ${
        confirmed
          ? 'border-line bg-surface'
          : 'border-amber-700 bg-amber-50 text-amber-950'
      }`}
    >
      <h2 className="font-semibold">
        {confirmed
          ? `Imported from ${sourceName}`
          : `Imported from ${sourceName}, not yet confirmed`}
      </h2>
      {confirmed ? null : (
        <p className="max-w-prose text-xs">
          It says what {sourceName} held. Until a person here checks it and
          confirms it, it shows as not yet confirmed.
        </p>
      )}
      {batchId ? (
        <p className="text-xs">
          <Link
            href={`/app/admin/imports/${batchId}`}
            className="text-brand underline"
          >
            The import it came in
          </Link>
        </p>
      ) : null}
      {history && history.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs font-medium">History from {sourceName}</h3>
          <p className="max-w-prose text-xs">
            As {sourceName} recorded it. None of it was done here.
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {history.map((e, i) => (
              <li key={i}>
                {e.what}
                {e.by ? ` by ${e.by}` : ''}
                {e.at ? ` on ${e.at.slice(0, 10)}` : ''}
                {e.detail ? `. ${e.detail}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {kept.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium">
            From {sourceName}, with no field here ({kept.length})
          </summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
            {kept.map(([k, v]) => (
              <div
                key={k}
                className="contents"
              >
                <dt className="font-medium">{k}</dt>
                <dd className="whitespace-pre-wrap break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {confirmed ? null : confirm}
    </section>
  );
}
