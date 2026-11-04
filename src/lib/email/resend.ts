import { waivernHosted } from '@/lib/hosting';
import { log } from '@/lib/log';

/**
 * Transactional email, through Resend.
 *
 * Two kinds of mail go through here, each behind its own switch:
 *
 * - Alerts to Waivern's own operators (`emailConfig`), only on Waivern's
 *   hosted service: from anybody else's copy they would come from Waivern's
 *   account and go to Waivern's people.
 * - Alert and action emails to an organisation's own people
 *   (`lib/email/member.ts`), never on the shared hosted service, and only
 *   where the deployment and the person have both switched them on.
 *
 * Both need `RESEND_API_KEY` and `EMAIL_FROM`; without them sending is a quiet
 * no-op, as it is in development and tests.
 *
 * Sending never throws. An email is a nudge about something already saved, so
 * a Resend outage must not turn a successful request into an error page.
 * Failures are logged by shape (status, error name), never by content.
 */

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export type Email = {
  to: string[];
  subject: string;
  /** Plain text only: these are notices, not marketing. */
  text: string;
  /**
   * Resend's tag, for finding a kind of message in its dashboard. Letters,
   * digits, underscores and dashes only, which Resend requires.
   */
  tag: string;
};

export type EmailConfig = { apiKey: string; from: string };

/** The Resend key and sender, whatever the mail is for, or null without them. */
export function transportConfig(
  env: Record<string, string | undefined> = process.env
): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/** What alerts to Waivern's operators need, or null where they should not be sent. */
export function emailConfig(
  env: Record<string, string | undefined> = process.env
): EmailConfig | null {
  if (!waivernHosted(env)) return null;
  return transportConfig(env);
}

/**
 * Which settings sending still needs, by name — never their values — so an
 * operator can see why nothing is being sent.
 */
export function missingEmailSettings(
  env: Record<string, string | undefined> = process.env
): string[] {
  const missing: string[] = [];
  if (!waivernHosted(env)) missing.push('WAIVERN_HOSTED');
  if (!env.RESEND_API_KEY?.trim()) missing.push('RESEND_API_KEY');
  if (!env.EMAIL_FROM?.trim()) missing.push('EMAIL_FROM');
  return missing;
}

export type SendOutcome =
  | { sent: true; messageId: string }
  | { sent: false; reason: string };

/** Send one email. Resolves with what happened; never rejects. */
export async function sendEmail(
  email: Email,
  options: { config?: EmailConfig | null; fetch?: typeof fetch } = {}
): Promise<SendOutcome> {
  const config = options.config === undefined ? emailConfig() : options.config;
  if (!config) return { sent: false, reason: 'not_configured' };
  const to = [
    ...new Set(email.to.map((a) => a.trim().toLowerCase()).filter(Boolean))
  ];
  if (to.length === 0) return { sent: false, reason: 'no_recipients' };

  const started = Date.now();
  try {
    const response = await (options.fetch ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: config.from,
        to,
        subject: email.subject,
        text: email.text,
        tags: [{ name: 'kind', value: email.tag }]
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
    };
    if (!response.ok || !body.id) {
      log('warn', 'email.failed', {
        tag: email.tag,
        status: response.status,
        error: body.name ?? null,
        recipients: to.length,
        ms: Date.now() - started
      });
      return { sent: false, reason: `resend_${body.name ?? response.status}` };
    }
    log('info', 'email.sent', {
      tag: email.tag,
      recipients: to.length,
      ms: Date.now() - started
    });
    return { sent: true, messageId: body.id };
  } catch (cause) {
    log('warn', 'email.failed', {
      tag: email.tag,
      error: cause instanceof Error ? cause.name : 'unknown',
      recipients: to.length,
      ms: Date.now() - started
    });
    return { sent: false, reason: 'unreachable' };
  }
}
