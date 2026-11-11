'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import {
  alertPlatformAdmins,
  describeTestOutcome,
  testEmail
} from '@/lib/email/platform-alerts';
import { log } from '@/lib/log';
import { isPlatformAdmin, platformAdmins } from '@/lib/platform';
import {
  approveRequest,
  createOrganisation,
  declineRequest,
  RequestRefused
} from '@/services/organisation-requests';

export type DecisionResult = { ok: boolean; message: string } | null;

/** The operator deciding, or a 404: the page's existence is not advertised. */
async function operator(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isPlatformAdmin(email)) notFound();
  return email;
}

async function decide(work: () => Promise<string>): Promise<DecisionResult> {
  try {
    const message = await work();
    revalidatePath('/platform');
    return { ok: true, message };
  } catch (error) {
    if (error instanceof RequestRefused)
      return { ok: false, message: error.message };
    throw error;
  }
}

export async function approveAction(
  requestId: string,
  _prev: DecisionResult
): Promise<DecisionResult> {
  const email = await operator();
  return decide(async () => {
    const { organisation } = await approveRequest({
      requestId,
      decidedByEmail: email
    });
    return `${organisation.name} is set up. Its owner can sign in now.`;
  });
}

export async function createOrganisationAction(
  _prev: DecisionResult,
  formData: FormData
): Promise<DecisionResult> {
  const email = await operator();
  return decide(async () => {
    const owner = String(formData.get('ownerEmail') ?? '');
    const organisation = await createOrganisation({
      organisationName: String(formData.get('organisationName') ?? ''),
      entityName: String(formData.get('entityName') ?? ''),
      ownerEmail: owner,
      createdByEmail: email
    });
    return owner.trim().toLowerCase() === email.toLowerCase()
      ? `${organisation.name} is set up, with you as its owner. Switch to it from the organisation menu.`
      : `${organisation.name} is set up. ${owner.trim()} becomes its owner when they sign in.`;
  });
}

export async function declineAction(
  requestId: string,
  _prev: DecisionResult,
  formData: FormData
): Promise<DecisionResult> {
  const email = await operator();
  return decide(async () => {
    const declined = await declineRequest({
      requestId,
      decidedByEmail: email,
      note: String(formData.get('note') ?? '')
    });
    return `Declined ${declined.organisationName}.`;
  });
}

/**
 * Send a test email to the platform administrators, and say what happened.
 * Only ever to that list, never to an address typed in, so it cannot be used
 * to send mail anywhere else.
 */
export async function sendTestEmailAction(): Promise<DecisionResult> {
  const email = await operator();
  const outcome = await alertPlatformAdmins(testEmail(email));
  log('info', 'email.test', {
    sent: outcome.sent,
    reason: outcome.sent ? null : outcome.reason
  });
  return describeTestOutcome(outcome, platformAdmins().length);
}
