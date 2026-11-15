import { headers } from 'next/headers';

import { visitorAddress } from '@/lib/visitor-address';
import type { EntityAgreementInput } from '@/services/agreements';

/**
 * Where an acceptance came from: the address and browser that sent it. Part of
 * the evidence that the person named, and nobody else, ticked the boxes.
 */
export async function acceptanceOrigin(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  return {
    ipAddress: await visitorAddress(),
    userAgent: (await headers()).get('user-agent')
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
