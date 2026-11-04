'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/platform';
import { deleteFeedback, markFeedbackHandled } from '@/services/feedback';

/** An operator, or a 404: the page's existence is not advertised. */
async function operator() {
  const session = await auth();
  if (!isPlatformAdmin(session?.user?.email)) notFound();
}

export async function markHandledAction(id: string, handled: boolean) {
  await operator();
  await markFeedbackHandled(id, handled);
  revalidatePath('/platform/feedback');
}

/** Deletes it outright, its email address included. Only with the box ticked. */
export async function deleteFeedbackAction(id: string, formData: FormData) {
  await operator();
  if (formData.get('confirm') !== 'on') return;
  await deleteFeedback(id);
  revalidatePath('/platform/feedback');
}
