import { TRIAL_REFUSAL, type TRIAL_WITHHELD } from '@/lib/trial-rules';

/** In place of a control a trial cannot use: what it would have done, and why not. */
export function TrialNotice({
  withheld,
  what
}: {
  withheld: (typeof TRIAL_WITHHELD)[number];
  /** The control's own name, such as "Contributors". */
  what?: string;
}) {
  return (
    <p className="max-w-prose rounded border border-dashed border-amber-700 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {what ? <span className="font-semibold">{what}: </span> : null}
      {TRIAL_REFUSAL[withheld]}
    </p>
  );
}
