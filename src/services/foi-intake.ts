import { eq, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { dsrIntakeLinks } from '@/db/schema';
import { requestDeadline } from '@/lib/foi/statutory';

import { admit, TOO_MANY, withinLimits, type IntakeResult } from './dsr-intake';
import {
  InformationRequestRefused,
  recordInformationRequest
} from './information-requests';
import { raiseTask } from './workflow';

/**
 * The public web form for freedom of information requests.
 *
 * It shares the data protection form's machinery: a random address per form,
 * withdrawable, rate limited by a keyed hash of the visitor's address, a
 * minimum fill time and a hidden field for software. It shows nothing back
 * but a reference and the date a response is due.
 *
 * It asks only what FOIA s.8 needs for a valid request (a name, an address for
 * correspondence, and a description of the information), and never why the
 * information is wanted: the law is applicant-blind.
 */

export const FOI_FIELD_LIMITS = {
  name: 200,
  address: 300,
  description: 5000,
  preferredMeans: 300
} as const;

/** Whether it is about the environment, in the words somebody would use. */
export const ENVIRONMENTAL_ASKS: Array<[string, string]> = [
  ['no', 'No'],
  ['yes', 'Yes, it is about the environment'],
  ['some', 'Partly'],
  ['unsure', 'Not sure']
];

const clip = (value: string, max: number) => value.trim().slice(0, max);

const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

export async function submitInformationRequestIntake(input: {
  slug: string;
  started: string;
  /** Filled only by software that fills in every field it finds. */
  trap?: string;
  address: string;
  requesterName: string;
  correspondenceAddress: string;
  description: string;
  preferredMeans?: string;
  environmental?: string;
  /** They said it is about themselves: their own personal data. */
  aboutThemselves?: boolean;
  now?: Date;
}): Promise<IntakeResult> {
  const now = input.now ?? new Date();
  const admitted = await admit(
    input.slug,
    input.started,
    input.trap,
    now,
    'foi'
  );
  if ('refused' in admitted) return { ok: false, message: admitted.refused };
  const { form } = admitted;

  // FOIA s.40(1), FOI(S)A s.38(1)(a): their own personal data is a subject
  // access request, not freedom of information. Turned back before anything
  // is recorded, with the way to ask.
  if (input.aboutThemselves)
    return {
      ok: false,
      message: form.otherFormSlug
        ? 'Information about yourself is a request under data protection law, not freedom of information. Use the data protection request form instead: the link is above this form.'
        : 'Information about yourself is a request under data protection law, not freedom of information. Ask the organisation for it by email or post: that is a subject access request, and it counts just the same.'
    };

  const requesterName = clip(input.requesterName, FOI_FIELD_LIMITS.name);
  const correspondenceAddress = clip(
    input.correspondenceAddress,
    FOI_FIELD_LIMITS.address
  );
  const description = clip(input.description, FOI_FIELD_LIMITS.description);
  const preferredMeans = clip(
    input.preferredMeans ?? '',
    FOI_FIELD_LIMITS.preferredMeans
  );
  // Checked here, in words for the public, before the register's own checks.
  if (!requesterName)
    return {
      ok: false,
      message:
        'Give your name. A freedom of information request needs your real name to be valid.'
    };
  if (!correspondenceAddress)
    return {
      ok: false,
      message: 'Give an email or postal address, so the response can reach you.'
    };
  if (!description)
    return {
      ok: false,
      message: 'Describe the information you want, as clearly as you can.'
    };
  // "Not sure" is recorded as general information: the handler corrects it if
  // it turns out to be environmental, which changes the rules, not the request.
  const kind =
    input.environmental === 'yes'
      ? ('environmental' as const)
      : input.environmental === 'some'
        ? ('both' as const)
        : ('general' as const);

  return withOrganisation(form.organisationId, async () => {
    if (!(await withinLimits(form, input.address, now)))
      return { ok: false as const, message: TOO_MANY };

    let request;
    try {
      request = await recordInformationRequest({
        organisationId: form.organisationId,
        entityId: form.entityId,
        kind,
        channel: 'web_form',
        receivedAt: now,
        description,
        requesterName,
        correspondenceAddress,
        preferredMeans: preferredMeans || null,
        intakeLinkId: form.linkId,
        actor: {
          actorKind: 'public_form',
          actorUserId: null,
          actorLabel: `web form: ${form.label}`
        }
      });
    } catch (error) {
      if (error instanceof InformationRequestRefused)
        return { ok: false as const, message: error.message };
      throw error;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(dsrIntakeLinks)
        .set({
          submissions: sql`${dsrIntakeLinks.submissions} + 1`,
          lastSubmittedAt: now
        })
        .where(eq(dsrIntakeLinks.id, form.linkId));
      // Nobody is watching a web form. The twenty working days run from now.
      await raiseTask(tx, {
        organisationId: form.organisationId,
        entityId: form.entityId,
        type: 'foi_intake',
        title: `${request.reference} arrived through ${form.label}`,
        description:
          'A freedom of information request from the public web form. Check what is asked for, whether it is environmental, and whether it is really for their own personal data, and pick it up.',
        subjectType: 'information_request',
        subjectId: request.id,
        assigneeRole: 'privacy_admin',
        idempotencyKey: `foi-intake:${request.id}`,
        actor: {
          actorKind: 'system',
          actorUserId: null,
          actorLabel: 'request form'
        }
      });
    });

    const dueAt = requestDeadline({
      regimes: request.regimes,
      startsAt: request.receivedAt,
      profile: request.timeProfile
    });
    return {
      ok: true as const,
      reference: request.reference,
      receivedAt: request.receivedAt,
      dueWords:
        request.timeProfile === 'school'
          ? `They must respond promptly, within twenty school days, and by ${longDate(dueAt)} at the latest.`
          : `They must respond promptly, and by ${longDate(dueAt)} at the latest.`
    };
  });
}
