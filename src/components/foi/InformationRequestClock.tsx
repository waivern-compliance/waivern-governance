import type { InformationRequestClock as Clock } from '@/lib/foi/statutory';

/**
 * How the twenty working days stand, said in words as well as colour, like the
 * clocks on the other registers.
 */
export function InformationRequestClock({ clock }: { clock: Clock }) {
  const tone =
    clock.state === 'overdue' || clock.state === 'late'
      ? 'border-red-700 bg-red-50 text-red-900'
      : clock.state === 'due_soon'
        ? 'border-amber-700 bg-amber-50 text-amber-900'
        : clock.state === 'met'
          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
          : 'border-line bg-surface text-ink-soft';

  const heading = {
    waiting: 'Waiting for clarification',
    running: 'Time running',
    due_soon: 'Deadline approaching',
    overdue: 'Past the deadline',
    met: 'Answered in time',
    late: 'Answered late',
    closed: 'Closed'
  }[clock.state];

  return (
    <div className={`rounded border px-4 py-3 ${tone}`}>
      <p className="text-xs font-medium uppercase tracking-wider">{heading}</p>
      <p className="mt-1 max-w-prose text-sm">{clock.words}</p>
    </div>
  );
}
