import { appUrl } from '@/lib/app-url';
import { PRODUCT_NAME } from '@/lib/product';
import { LINK_MINUTES, RETENTION_DAYS, TRIAL_LENGTH } from '@/lib/trial';

import type { Email } from './resend';

/**
 * What a trial's emails say. Pure, so the wording can be tested without
 * sending.
 *
 * Whoever asks for a trial is sent exactly one email whatever the address
 * already has here, and the form says the same thing every time. What
 * differs is only in the email, which reaches nobody but the mailbox's owner:
 * that is how the form avoids telling a stranger whether an address is known.
 */

const footer = (url: string) =>
  `\n\n-\nSent by ${PRODUCT_NAME}${url ? ` (${url})` : ''} because somebody asked for a trial with this address. If it was not you, ignore this email: nothing happens unless the link is used.`;

/** The link to start a trial, or to sign back in to one. */
export function trialLinkEmail(
  link: string,
  url = appUrl()
): Omit<Email, 'to'> {
  return {
    subject: `Your ${PRODUCT_NAME} trial`,
    text:
      [
        `Open this link to start your ${TRIAL_LENGTH} trial, or to sign back in to the one you have:`,
        '',
        link,
        '',
        `It works once, for ${LINK_MINUTES} minutes. Nothing starts until you press the button on the page it opens.`,
        '',
        'A trial is text only: files cannot be uploaded, and it cannot invite anyone or send anything to anyone else. Use made-up or public information, not real personal data.'
      ].join('\n') + footer(url),
    tag: 'trial-link'
  };
}

/** Sent instead of a link to an address that already has a full account. */
export function trialHasAccountEmail(url = appUrl()): Omit<Email, 'to'> {
  return {
    subject: `You already have a ${PRODUCT_NAME} account`,
    text:
      [
        'Somebody asked for a trial with this address, but it already belongs to a full account, so no trial was started.',
        '',
        `Sign in as you usually do${url ? ` at ${url}/sign-in` : ''}.`
      ].join('\n') + footer(url),
    tag: 'trial-has-account'
  };
}

/** Sent instead of a link once a trial's records have been deleted. */
export function trialGoneEmail(url = appUrl()): Omit<Email, 'to'> {
  return {
    subject: `Your ${PRODUCT_NAME} trial has ended`,
    text:
      [
        `The trial for this address ended, and its records were deleted ${RETENTION_DAYS} days later. Each address has one trial.`,
        '',
        'To carry on with a full account, email info@waivern.com.'
      ].join('\n') + footer(url),
    tag: 'trial-gone'
  };
}

/** To the platform administrators, when a trial asks for more time or a full account. */
export function trialRequestEmail(
  request: {
    email: string;
    kind: 'extend' | 'convert';
    organisationName: string;
    message: string;
    endsAt: Date;
  },
  url = appUrl()
): Omit<Email, 'to'> {
  const asks =
    request.kind === 'convert'
      ? 'asked to convert their trial to a full account'
      : 'asked for more time on their trial';
  return {
    subject: `Trial request: ${request.email}`,
    text: [
      `${request.email} has ${asks}.`,
      '',
      `Organisation: ${request.organisationName}`,
      `Trial ${request.endsAt.getTime() > Date.now() ? 'ends' : 'ended'}: ${request.endsAt.toUTCString()}`,
      '',
      'Their message:',
      request.message,
      '',
      `Extend, convert or decline it at ${url}/platform`,
      `\n-\nSent by ${PRODUCT_NAME}${url ? ` (${url})` : ''} to the Waivern platform administrators.`
    ].join('\n'),
    tag: 'trial-request'
  };
}
