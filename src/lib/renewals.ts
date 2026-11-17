/**
 * Renewal dates: when something ends, and the last day to give notice on it.
 *
 * Shared by supplier contracts and by assets whose type carries an expiry
 * date (a domain, a certificate, a software licence). For anything that
 * renews automatically, missing the notice date commits the organisation to
 * another term, which is the failure the reminder exists for; for anything
 * that does not, missing it means the thing lapses.
 */

const DAY = 86_400_000;

/** How long before the notice date its owner is told. A quarter: long enough to decide and negotiate. */
export const NOTICE_LEAD_DAYS = 90;

export type RenewalDates = {
  endsAt: Date | null;
  noticeDays: number | null;
  autoRenews: boolean;
  /** Ended, or retired: nothing is owed on it any more. */
  endedAt: Date | null;
};

/** The last day to give notice, or null where there is no end date. */
export function noticeBy(dates: RenewalDates): Date | null {
  if (!dates.endsAt) return null;
  return new Date(dates.endsAt.getTime() - (dates.noticeDays ?? 0) * DAY);
}

export type NoticeState =
  | 'ended'
  | 'open_ended'
  | 'renewed'
  | 'expired'
  | 'passed'
  | 'due_soon'
  | 'later';

export const NOTICE_WORDS: Record<NoticeState, string> = {
  ended: 'Ended',
  open_ended: 'No end date',
  renewed: 'Renewed: record the new term',
  expired: 'Past its end date: record a new one, or close it',
  passed: 'Notice date passed',
  due_soon: 'Notice due soon',
  later: 'In term'
};

export function noticeState(
  dates: RenewalDates,
  now = new Date()
): NoticeState {
  if (dates.endedAt) return 'ended';
  const by = noticeBy(dates);
  if (!by) return 'open_ended';
  // Past its end and renewing automatically, it is in a new term whose end
  // nobody has recorded yet. Not "notice passed": that decision is behind us,
  // and what is wanted now is the new end date.
  // Past its end and not renewing, it has lapsed unless someone renewed it
  // by hand. Either way the notice date no longer matters: what is wanted is
  // the new end date, or the record closed (a contract ended, an asset retired).
  if (dates.endsAt!.getTime() < now.getTime())
    return dates.autoRenews ? 'renewed' : 'expired';
  if (by.getTime() < now.getTime()) return 'passed';
  if (by.getTime() - now.getTime() <= NOTICE_LEAD_DAYS * DAY) return 'due_soon';
  return 'later';
}

/** Whether a renewal needs somebody now: notice due or passed, or a new term to record. */
export function needsAttention(state: NoticeState): boolean {
  return (
    state === 'due_soon' ||
    state === 'passed' ||
    state === 'renewed' ||
    state === 'expired'
  );
}

/** Whether the notice date is still worth showing: not once the end date has gone by. */
export function noticeStillOpen(state: NoticeState): boolean {
  return state === 'due_soon' || state === 'passed' || state === 'later';
}

/** What a reminder is about, which prefixes its key. */
export type RenewalSubject = 'contract' | 'asset';

/**
 * The key of the one reminder a record should have open now, or null when it
 * needs none. Keyed on the date it is about, so a record re-dated gets a
 * fresh reminder and any other open reminder for it is out of date.
 */
export function reminderKey(
  subject: RenewalSubject,
  record: RenewalDates & { id: string },
  now = new Date()
): string | null {
  const state = noticeState(record, now);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (state === 'renewed' || state === 'expired')
    return `${subject}-${state}:${record.id}:${day(record.endsAt!)}`;
  if (state === 'due_soon' || state === 'passed')
    return `${subject}-notice:${record.id}:${day(noticeBy(record)!)}`;
  return null;
}

/** Every reminder key a record can have, for closing those out of date. */
export function reminderKeyPatterns(
  subject: RenewalSubject,
  id: string
): string[] {
  return [
    `${subject}-notice:${id}:%`,
    `${subject}-renewed:${id}:%`,
    `${subject}-expired:${id}:%`
  ];
}
