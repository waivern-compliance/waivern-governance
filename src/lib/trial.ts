import { transportConfig } from '@/lib/email/resend';
import { requestsOpen } from '@/lib/platform';

export {
  FICTIONAL_ONLY,
  LINK_MINUTES,
  RETENTION_DAYS,
  hasEnded,
  isUndeliverable,
  SIMULATED_DOMAIN,
  TRIAL_DAYS,
  TRIAL_LENGTH,
  TRIAL_MS,
  inRequestWindow,
  REQUEST_WINDOW_HOURS,
  timeLeft,
  TRIAL_REFUSAL,
  TRIAL_WITHHELD,
  withheldDuringTrial
} from './trial-rules';

/**
 * Self-service trials: somebody gives an email address, proves it is theirs,
 * and has an organisation of their own for `TRIAL_DAYS`.
 *
 * A trial is text only and reaches nobody. Neither is a matter of hiding
 * buttons: the capabilities that would let it are withheld from every grant
 * in a trial organisation (`lib/rbac.ts`), the services refuse for a trial
 * whoever calls them (`services/trials.ts`), and the database lets a trial
 * organisation have no real member but the one (migration 0115).
 */

/** The longest one approval may extend a trial by. */
export const MAX_EXTENSION_DAYS = 30;

/** Sign-up limits, per hour unless named otherwise. */
export const LIMITS = {
  perEmail: 3,
  perAddress: 5,
  perAddressPerDay: 20,
  /** Across everybody: a ceiling on what one burst can cost in email. */
  overall: 100
} as const;

/** Quicker than this from opening the form, and it was not a person typing. */
export const MIN_FILL_SECONDS = 3;

/**
 * Whether people may start trials here: switched on with `TRIAL_SIGN_UP`, with
 * a platform administrator to ask for more time, and a way to send the link.
 * In development the link is written to the server log instead.
 */
export function trialsOpen(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.TRIAL_SIGN_UP !== 'true') return false;
  if (!requestsOpen()) return false;
  return transportConfig(env) !== null || env.NODE_ENV !== 'production';
}

/** Gmail ignores dots in the local part, and treats googlemail.com as gmail.com. */
const DOTLESS = new Set(['gmail.com', 'googlemail.com']);

/**
 * One mailbox, however it is spelt: lower case, without a `+tag`, and for
 * Gmail without dots. Used to stop one mailbox starting trial after trial;
 * mail is still sent to the address exactly as given.
 */
export function canonicalEmail(address: string): string {
  const email = address.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at).split('+')[0];
  let domain = email.slice(at + 1);
  if (DOTLESS.has(domain)) {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

/**
 * Where a trial can book a guided demo or an advisory session with Waivern,
 * from `TRIAL_BOOKING_URL`. Null, and no link shown, when it is unset or is
 * not an https address.
 */
export function bookingUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const value = env.TRIAL_BOOKING_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
