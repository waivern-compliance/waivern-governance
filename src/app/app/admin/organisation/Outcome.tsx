import type { AdminResult } from '../actions';

/** What a save on the Organisation page came to: a status, or the refusal as an alert. */
export function Outcome({ result }: { result: AdminResult }) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? 'status' : 'alert'}
      className={`text-xs ${result.ok ? 'text-emerald-800' : 'text-red-800'}`}
    >
      {result.message}
    </p>
  );
}
