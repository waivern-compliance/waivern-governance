import type { trialRequests } from '@/db/schema';

type Request = typeof trialRequests.$inferSelect;

const day = (d: Date) => d.toUTCString();

/** Where the trial's request to the administrators has got to. */
export function RequestStatus({
  pending,
  lastDecided
}: {
  pending: Request | null;
  lastDecided: Request | null;
}) {
  if (pending)
    return (
      <section className="space-y-1 rounded border border-amber-700 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">Waiting for an administrator</p>
        <p>
          You asked for{' '}
          {pending.kind === 'convert' ? 'a full account' : 'more time'} on{' '}
          {day(pending.createdAt)}. The answer will appear here.
        </p>
      </section>
    );
  if (lastDecided?.status === 'declined')
    return (
      <section className="space-y-1 rounded border border-line bg-surface p-5 text-sm">
        <p className="font-semibold">Your last request was declined</p>
        {lastDecided.decisionNote ? <p>{lastDecided.decisionNote}</p> : null}
      </section>
    );
  if (lastDecided?.status === 'approved' && lastDecided.extendedDays)
    return (
      <section className="space-y-1 rounded border border-emerald-700 bg-emerald-50 p-5 text-sm text-emerald-900">
        <p className="font-semibold">
          Extended by {lastDecided.extendedDays} day
          {lastDecided.extendedDays === 1 ? '' : 's'}
        </p>
      </section>
    );
  return null;
}
