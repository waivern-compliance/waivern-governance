import type { Capability } from './rbac';

/**
 * A trial's rules and clock, for the server and the browser alike: kept
 * apart from `lib/trial.ts`, which reads the environment.
 */

/**
 * How long a trial lasts from the moment the address is proved. The one
 * place it is said: every page, email, help topic and test reads it here.
 */
export const TRIAL_DAYS = 7;

/** The same, for arithmetic. */
export const TRIAL_MS = TRIAL_DAYS * 24 * 3_600_000;

/** "7 days", as copy says it. */
export const TRIAL_LENGTH = `${TRIAL_DAYS} days`;

/** How long the emailed sign-up link works. */
export const LINK_MINUTES = 30;

/**
 * How long a trial's records are kept after it ends, so an administrator can
 * still extend or convert it, before the sweep deletes them.
 */
export const RETENTION_DAYS = 30;

/**
 * How close to the end a trial may ask to be extended or converted: the last
 * two days of seven. Earlier, and the request would be decided before the
 * person knows whether they want it; any later, and an administrator might
 * not see it in time.
 */
export const REQUEST_WINDOW_HOURS = 48;

/**
 * Where a trial's simulated colleagues' addresses are. `.invalid` is reserved
 * (RFC 6761) and can never receive mail, and sending refuses it as well.
 */
export const SIMULATED_DOMAIN = 'simulated.invalid';

/** What every trial is told, at sign-up and on every page. */
export const FICTIONAL_ONLY =
  'A trial is for exploring with fictional data only. Do not enter real personal data about anyone, and above all no special category data: health, ethnicity, religion, sexual orientation, biometrics, trade union membership or criminal records. The demo company and its colleagues are made up.';

/** Whether an address belongs to a simulated colleague, or to nobody at all. */
export function isUndeliverable(address: string): boolean {
  return /\.invalid$/i.test(address.trim());
}

/** Whether a trial that ends at `endsAt` has ended. */
export function hasEnded(endsAt: Date, now = new Date()): boolean {
  return endsAt.getTime() <= now.getTime();
}

/** Whether a trial that ends at `endsAt` may now ask for more time. */
export function inRequestWindow(endsAt: Date, now = new Date()): boolean {
  return endsAt.getTime() - now.getTime() <= REQUEST_WINDOW_HOURS * 3_600_000;
}

/** "2 days 4 hours", "3 hours 12 minutes", "8 minutes": never more precise than it needs to be. */
export function timeLeft(endsAt: Date, now = new Date()): string {
  const ms = endsAt.getTime() - now.getTime();
  if (ms <= 0) return 'no time';
  const minutes = Math.ceil(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (days > 0)
    return hours > 0
      ? `${unit(days, 'day')} ${unit(hours, 'hour')}`
      : unit(days, 'day');
  if (hours > 0)
    return mins > 0
      ? `${unit(hours, 'hour')} ${unit(mins, 'minute')}`
      : unit(hours, 'hour');
  return unit(mins, 'minute');
}

/**
 * What a trial may never do. Withheld from every grant in a trial
 * organisation, whatever its role, until an administrator converts it.
 *
 * - `member.manage`: invitations, roles and handing over: nobody else joins.
 * - `file.upload`: documents, evidence, agreements, imports, cookie reports,
 *   logos. Only typed text goes in.
 * - `contact.outside`: anything that reaches somebody or something outside
 *   the organisation: contributor links, public request forms, joining by
 *   domain, an AI provider, the Consent Analyser, fetching a page.
 */
export const TRIAL_WITHHELD = [
  'member.manage',
  'file.upload',
  'contact.outside'
] as const satisfies readonly Capability[];

export function withheldDuringTrial(capability: Capability): boolean {
  return (TRIAL_WITHHELD as readonly Capability[]).includes(capability);
}

/** What a trial is told when it reaches for something it cannot do. */
export const TRIAL_REFUSAL: Record<(typeof TRIAL_WITHHELD)[number], string> = {
  'member.manage':
    'A trial is for one person: nobody else can be invited or given a role. Ask for a full account to bring your team in.',
  'file.upload':
    'Files cannot be uploaded during a trial. Type what you need instead, or ask for a full account.',
  'contact.outside':
    'A trial cannot reach anyone outside it: no links, forms, invitations or outside services. Ask for a full account to use them.'
};
