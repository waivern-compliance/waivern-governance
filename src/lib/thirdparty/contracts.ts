/**
 * Commercial contracts with suppliers: their dates, and when notice is due.
 *
 * Separate from the Article 28 terms on `dpa`. A processor agreement is about
 * what a supplier may do with personal data; a contract is about what we pay
 * and for how long, and its date that matters is the last day to give notice.
 * For a contract that renews automatically, missing that date commits the
 * organisation to another term, which is the failure the reminder exists for.
 */

const DAY = 86_400_000;

/** How long before the notice date its owner is told. A quarter: long enough to decide and negotiate. */
export const NOTICE_LEAD_DAYS = 90;

export type ContractDates = {
  endsAt: Date | null;
  noticeDays: number | null;
  endedAt: Date | null;
};

/** The last day to give notice, or null where the contract has no end date. */
export function noticeBy(contract: ContractDates): Date | null {
  if (!contract.endsAt) return null;
  return new Date(contract.endsAt.getTime() - (contract.noticeDays ?? 0) * DAY);
}

export type NoticeState =
  'ended' | 'open_ended' | 'passed' | 'due_soon' | 'later';

export const NOTICE_WORDS: Record<NoticeState, string> = {
  ended: 'Ended',
  open_ended: 'No end date',
  passed: 'Notice date passed',
  due_soon: 'Notice due soon',
  later: 'In term'
};

export function noticeState(
  contract: ContractDates,
  now = new Date()
): NoticeState {
  if (contract.endedAt) return 'ended';
  const by = noticeBy(contract);
  if (!by) return 'open_ended';
  if (by.getTime() < now.getTime()) return 'passed';
  if (by.getTime() - now.getTime() <= NOTICE_LEAD_DAYS * DAY) return 'due_soon';
  return 'later';
}

/** An ISO 4217 code: three capital letters. */
export function isCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}
