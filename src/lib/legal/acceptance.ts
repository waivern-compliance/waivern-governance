import { headers } from 'next/headers';

import type { EntityAgreementInput } from '@/services/agreements';

/**
 * Where an acceptance came from: the address and browser that sent it. Part of
 * the evidence that the person named, and nobody else, ticked the boxes.
 *
 * Behind the hosting provider's proxy the client's address is the first in
 * `x-forwarded-for`; the proxy sets the header, so a client cannot put an
 * address in front of its own.
 */
export async function acceptanceOrigin(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ipAddress: forwarded || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent')
  };
}

function ticked(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true';
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

/** What the entity agreement fields sent, plus where they came from. */
export async function entityAgreementFrom(
  formData: FormData
): Promise<EntityAgreementInput> {
  return {
    acceptTerms: ticked(formData.get('acceptTerms')),
    acceptDpa: ticked(formData.get('acceptDpa')),
    confirmAuthority: ticked(formData.get('confirmAuthority')),
    signatoryName: text(formData.get('signatoryName')),
    signatoryPosition: text(formData.get('signatoryPosition')),
    termsVersion: text(formData.get('termsVersion')),
    dpaVersion: text(formData.get('dpaVersion')),
    ...(await acceptanceOrigin())
  };
}

export { ticked as formTicked, text as formText };
