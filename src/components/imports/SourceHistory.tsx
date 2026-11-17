import type { SourceEvent } from '@/lib/import/types';

/** What the old platform recorded happening to a record, as it recorded it. */
export function SourceHistory({ events }: { events: SourceEvent[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-xs">
      {events.map((e, i) => (
        <li key={i}>
          {e.what}
          {e.by ? ` by ${e.by}` : ''}
          {e.at ? ` on ${e.at.slice(0, 10)}` : ''}
          {e.detail ? `. ${e.detail.replace(/\.$/, '')}` : ''}.
        </li>
      ))}
    </ul>
  );
}
