import type { ReactNode } from 'react';
import Link from 'next/link';

import type { SourceEvent } from '@/lib/import/types';

import { KeptFields } from './KeptFields';
import { SourceHistory } from './SourceHistory';

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
          <SourceHistory events={history} />
        </div>
      ) : null}
      <KeptFields
        sourceName={sourceName}
        legacy={legacy}
      />
      {confirmed ? null : confirm}
    </section>
  );
}
