'use server';

import { headers } from 'next/headers';

import {
  submitComplaintIntake,
  submitIntake,
  type IntakeResult
} from '@/services/dsr-intake';
import { submitInformationRequestIntake } from '@/services/foi-intake';

const text = (v: FormDataEntryValue | null) => String(v ?? '');

/**
 * The public form's one action. No session is read; the address in the URL
 * is the only authority, and the visitor's own address is used for rate
 * limiting alone, hashed, and forgotten after a day.
 */
async function visitorAddress() {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}

/** The freedom of information form's action, on the same terms as the other. */
export async function submitInformationRequestAction(
  slug: string,
  _prev: IntakeResult | null,
  formData: FormData
): Promise<IntakeResult> {
  return submitInformationRequestIntake({
    slug,
    started: text(formData.get('started')),
    trap: text(formData.get('website')),
    address: await visitorAddress(),
    requesterName: text(formData.get('requesterName')),
    correspondenceAddress: text(formData.get('correspondenceAddress')),
    description: text(formData.get('description')),
    preferredMeans: text(formData.get('preferredMeans')),
    environmental: text(formData.get('environmental')),
    aboutThemselves: formData.get('aboutThemselves') === 'on'
  });
}

export async function submitRequestAction(
  slug: string,
  _prev: IntakeResult | null,
  formData: FormData
): Promise<IntakeResult> {
  const address = await visitorAddress();
  if (formData.get('kind') === 'complaint') {
    return submitComplaintIntake({
      slug,
      started: text(formData.get('started')),
      trap: text(formData.get('website')),
      address,
      forSomeoneElse: formData.get('forSomeoneElse') === 'yes',
      complainantName: text(formData.get('requesterName')),
      representativeName: text(formData.get('representativeName')),
      contact: text(formData.get('contact')),
      subject: text(formData.get('subject')),
      earlierReference: text(formData.get('earlierReference')),
      description: text(formData.get('description'))
    });
  }
  return submitIntake({
    slug,
    started: text(formData.get('started')),
    trap: text(formData.get('website')),
    address,
    forSomeoneElse: formData.get('forSomeoneElse') === 'yes',
    requesterName: text(formData.get('requesterName')),
    representativeName: text(formData.get('representativeName')),
    contact: text(formData.get('contact')),
    relationship: text(formData.get('relationship')),
    rights: formData.getAll('rights').map(String),
    description: text(formData.get('description'))
  });
}
