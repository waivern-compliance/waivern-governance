import { PRODUCT_NAME } from '@/lib/product';

import type { Email } from './resend';

/**
 * The emails that go with deleting a legal entity: the link that confirms it,
 * and word that it is done.
 *
 * Pure, so the wording can be tested. Both say plainly that the deletion
 * cannot be undone and should be agreed first, because an email is read on
 * its own, away from the page that said so.
 */

/** Said at every stage: on the page, in the email, and where it is confirmed. */
export const IRREVOCABLE =
  'Deleting a legal entity is permanent and cannot be undone. Every record held for it is deleted, with its files, and cannot be recovered, by you or by Waivern.';

export const AGREE_FIRST =
  'Only do this with the full understanding and agreement of the relevant stakeholders and decision-makers in your firm.';

/** How long deleted records may remain in backups, in days (terms 7.3). */
export const BACKUP_DAYS = 27;

export const BACKUPS = `Copies of the deleted records stay in the service's backups until those are overwritten, within ${BACKUP_DAYS} days. Backups are kept to recover the whole service from a failure and are never restored for one organisation.`;

/** The words to type, exactly, to confirm. */
export const CONFIRM_PHRASE = 'delete everything';

export function erasureLinkEmail(input: {
  entityName: string;
  organisationName: string;
  url: string;
  expiresAt: Date;
}): Omit<Email, 'to'> {
  const minutes = Math.max(
    1,
    Math.round((input.expiresAt.getTime() - Date.now()) / 60_000)
  );
  return {
    subject: `Confirm: permanently delete ${input.entityName} and all its records`,
    text: [
      `You asked to delete the legal entity ${input.entityName}, in ${input.organisationName}, and every record held for it.`,
      '',
      `IRREVOCABLE: ${IRREVOCABLE}`,
      '',
      AGREE_FIRST,
      '',
      'If you still want to go ahead, open this link, sign in as yourself, and type the confirmation it asks for:',
      input.url,
      '',
      `The link works once, for the next ${minutes} minutes. Until it is used nothing is deleted. If you did not ask for this, do not open it, and tell the organisation's owners.`,
      '',
      BACKUPS,
      '',
      '-',
      `Sent by ${PRODUCT_NAME} to the address it holds for you, because you asked to delete a legal entity.`
    ].join('\n'),
    tag: 'entity-erasure-link'
  };
}

export function erasureDoneEmail(input: {
  entityName: string;
  organisationName: string;
  deletedBy: string;
  records: number;
  completedAt: Date;
}): Omit<Email, 'to'> {
  return {
    subject: `${input.entityName} has been deleted`,
    text: [
      `The legal entity ${input.entityName}, in ${input.organisationName}, and every record held for it were deleted at ${input.completedAt.toISOString()}, at the request of ${input.deletedBy}.`,
      '',
      `${input.records} records were deleted from the live service, with their files. This cannot be undone.`,
      '',
      BACKUPS,
      '',
      '-',
      `Sent by ${PRODUCT_NAME} as written confirmation that the deletion is complete.`
    ].join('\n'),
    tag: 'entity-erasure-done'
  };
}
