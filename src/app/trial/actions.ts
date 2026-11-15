'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';

import { auth, signIn, signOut } from '@/auth';
import { requestOrigin } from '@/lib/request-origin';
import { trialsOpen } from '@/lib/trial';
import {
  requestTrialChange,
  requestTrialLink,
  trialLinkState,
  TrialRefused,
  type TrialLinkState
} from '@/services/trials';

export type TrialResult = { ok: boolean; message: string } | null;

const CLOSED = {
  ok: false,
  message: 'Trials are not being offered here at the moment.'
};

/** The visitor's own address, for rate limiting alone; hashed before it is kept. */
async function visitorAddress() {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}

/** Ask for a trial. The answer is the same whether the address is known or not. */
export async function requestTrialLinkAction(
  _prev: TrialResult,
  formData: FormData
): Promise<TrialResult> {
  if (!trialsOpen()) return CLOSED;
  return requestTrialLink({
    email: String(formData.get('email') ?? ''),
    address: await visitorAddress(),
    started: String(formData.get('started') ?? ''),
    trap: String(formData.get('website') ?? ''),
    fictionalOnly: formData.get('fictionalOnly') === 'on',
    organisationName: String(formData.get('organisationName') ?? ''),
    origin: await requestOrigin()
  });
}

/** What the link is, without using it, so opening it (or a mail scanner fetching it) changes nothing. */
export async function checkTrialLinkAction(
  token: string
): Promise<TrialLinkState> {
  if (!trialsOpen()) return 'not_found';
  return trialLinkState(token);
}

/** Use the link: start the trial, or sign back in to it. */
export async function startTrialAction(
  _prev: TrialResult,
  formData: FormData
): Promise<TrialResult> {
  if (!trialsOpen()) return CLOSED;
  try {
    await signIn('trial', {
      token: String(formData.get('token') ?? ''),
      redirectTo: '/app'
    });
  } catch (error) {
    if (error instanceof AuthError)
      return {
        ok: false,
        message:
          'This link could not be used. It may have been used already or expired, or the address may already have a full account. Ask for a new link, or sign in as you usually do.'
      };
    throw error;
  }
  return null;
}

/**
 * Ask the platform administrators for more time or a full account. Read from
 * the signed-in person alone, so it works once the trial has ended too; which
 * trial is theirs is never taken from the form.
 */
export async function requestTrialChangeAction(
  _prev: TrialResult,
  formData: FormData
): Promise<TrialResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect('/sign-in');
  try {
    await requestTrialChange({
      userId: session.user.id,
      email: session.user.email,
      kind: formData.get('kind') === 'convert' ? 'convert' : 'extend',
      organisationName: String(formData.get('organisationName') ?? ''),
      message: String(formData.get('message') ?? '')
    });
  } catch (error) {
    if (error instanceof TrialRefused)
      return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath('/app/trial');
  revalidatePath('/trial/ended');
  return {
    ok: true,
    message:
      'Sent to the administrators. You will see their answer on this page.'
  };
}

export async function signOutOfTrialAction() {
  await signOut({ redirectTo: '/trial' });
}
