import Link from 'next/link';

import { RETIRE_REASON_WORDS, type RetireReason } from '@/lib/retirement';

/**
 * A register's retired records, kept out of the working list but one click
 * away: retiring takes a record off the register, it does not hide it.
 */
export function RetiredList({
  items
}: {
  items: ReadonlyArray<{
    id: string;
    href: string;
    reference?: string | null;
    name: string;
    retiredAt: Date;
    reason: RetireReason | null;
  }>;
}) {
  if (items.length === 0) return null;
  return (
    <details className="rounded border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Retired ({items.length})
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {items.map((r) => (
          <li key={r.id}>
            <Link
              href={r.href}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-ink-soft hover:bg-ground focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span className="flex items-baseline gap-3">
                {r.reference ? (
                  <span className="font-mono text-xs">{r.reference}</span>
                ) : null}
                <span>{r.name}</span>
              </span>
              <span className="font-mono text-[11px]">
                retired {r.retiredAt.toISOString().slice(0, 10)}
                {r.reason ? ` · ${RETIRE_REASON_WORDS[r.reason]}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
