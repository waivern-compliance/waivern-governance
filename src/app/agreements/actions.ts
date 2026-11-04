'use server';

import { redirect } from 'next/navigation';

import {
  acceptanceOrigin,
  entityAgreementFrom,
  formText,
  formTicked
} from '@/lib/legal/acceptance';
import { AGREEMENTS_PATH, getActiveSession } from '@/lib/session';
import {
  acceptForEntity,
  acceptTerms,
  AgreementRefused
} from '@/services/agreements';

export type AgreementResult = { ok: boolean; message: string } | null;

async function signedIn() {
  const active = await getActiveSession(undefined, { agreements: 'skip' });
  if (!active) redirect('/sign-in');
  return active;
}

async function refusable(
  work: () => Promise<unknown>
): Promise<AgreementResult> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AgreementRefused)
      return { ok: false, message: error.message };
    throw error;
  }
  // Back to the page, which shows what is still outstanding, or sends the
  // person on to their work once nothing is.
  redirect(AGREEMENTS_PATH);
}

export async function acceptTermsAction(
  _prev: AgreementResult,
  formData: FormData
): Promise<AgreementResult> {
  const active = await signedIn();
  return refusable(async () =>
    acceptTerms({
      userId: active.userId,
      email: active.email,
      name: active.name,
      accepted: formTicked(formData.get('acceptTerms')),
      termsVersion: formText(formData.get('termsVersion')),
      ...(await acceptanceOrigin())
    })
  );
}

export async function acceptForEntityAction(
  entityId: string,
  _prev: AgreementResult,
  formData: FormData
): Promise<AgreementResult> {
  const active = await signedIn();
  return refusable(async () =>
    acceptForEntity({
      ...(await entityAgreementFrom(formData)),
      organisationId: active.membership.organisationId,
      entityId,
      grants: active.membership.grants,
      user: { id: active.userId, email: active.email },
      actor: {
        actorKind: 'user',
        actorUserId: active.userId,
        actorLabel: active.email
      }
    })
  );
}
