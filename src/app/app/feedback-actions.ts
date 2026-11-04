'use server';

import { after } from 'next/server';

import {
  alertPlatformAdmins,
  feedbackEmail
} from '@/lib/email/platform-alerts';
import { FeedbackRefused } from '@/lib/feedback';
import { getActiveSession } from '@/lib/session';
import { submitFeedback } from '@/services/feedback';

export type FeedbackResult = { ok: boolean; message: string } | null;

/**
 * Send feedback to Waivern. Only a signed-in person can, but who they are is
 * passed on only when they ticked the box to share their email address.
 */
export async function sendFeedbackAction(
  _previous: FeedbackResult,
  formData: FormData
): Promise<FeedbackResult> {
  const active = await getActiveSession();
  if (!active) return { ok: false, message: 'Sign in to send feedback.' };
  const shareEmail = formData.get('shareEmail') === 'on';
  try {
    const saved = await submitFeedback({
      message: formData.get('message'),
      pathname: formData.get('pathname'),
      shareEmail,
      email: active.email
    });
    // After the response, so a slow mail service never holds up the thank-you.
    after(() => alertPlatformAdmins(feedbackEmail(saved)));
  } catch (error) {
    if (error instanceof FeedbackRefused)
      return { ok: false, message: error.message };
    throw error;
  }
  return {
    ok: true,
    message: shareEmail
      ? 'Thank you. We may email you about it.'
      : 'Thank you. It was sent anonymously.'
  };
}
