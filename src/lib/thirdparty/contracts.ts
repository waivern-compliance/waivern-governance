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
  autoRenews: boolean;
  endedAt: Date | null;
};

/** The last day to give notice, or null where the contract has no end date. */
export function noticeBy(contract: ContractDates): Date | null {
  if (!contract.endsAt) return null;
  return new Date(contract.endsAt.getTime() - (contract.noticeDays ?? 0) * DAY);
}

export type NoticeState =
  'ended' | 'open_ended' | 'renewed' | 'passed' | 'due_soon' | 'later';

export const NOTICE_WORDS: Record<NoticeState, string> = {
  ended: 'Ended',
  open_ended: 'No end date',
  renewed: 'Renewed: record the new term',
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
  // Past its end and renewing automatically, it is in a new term whose end
  // nobody has recorded yet. Not "notice passed": that decision is behind us,
  // and what is wanted now is the new end date.
  if (contract.autoRenews && contract.endsAt!.getTime() < now.getTime())
    return 'renewed';
  if (by.getTime() < now.getTime()) return 'passed';
  if (by.getTime() - now.getTime() <= NOTICE_LEAD_DAYS * DAY) return 'due_soon';
  return 'later';
}

/**
 * The key of the one reminder a contract should have open now, or null when
 * it needs none. Keyed on the date it is about, so a contract re-dated gets a
 * fresh reminder and any other open reminder for it is out of date.
 */
export function reminderKey(
  contract: ContractDates & { id: string },
  now = new Date()
): string | null {
  const state = noticeState(contract, now);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (state === 'renewed')
    return `contract-renewed:${contract.id}:${day(contract.endsAt!)}`;
  if (state === 'due_soon' || state === 'passed')
    return `contract-notice:${contract.id}:${day(noticeBy(contract)!)}`;
  return null;
}

/** Every reminder key a contract can have, for closing those out of date. */
export function reminderKeyPatterns(contractId: string): string[] {
  return [
    `contract-notice:${contractId}:%`,
    `contract-renewed:${contractId}:%`
  ];
}

/** An ISO 4217 code: three capital letters. */
export function isCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}
