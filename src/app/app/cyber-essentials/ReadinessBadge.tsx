import {
  READINESS_STATUS_LABEL,
  type ReadinessStatus
} from '@/lib/cyber-essentials/readiness';

const LOOK: Record<ReadinessStatus, string> = {
  met: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  not_met: 'border-red-700 bg-red-50 text-red-900',
  not_applicable: 'border-line text-ink-soft',
  unknown: 'border-dashed border-amber-700 text-amber-900',
  not_asked: 'border-dashed border-line text-ink-soft'
};

/** A requirement's status, in words as well as colour. */
export function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[11px] ${LOOK[status]}`}
    >
      {READINESS_STATUS_LABEL[status]}
    </span>
  );
}
