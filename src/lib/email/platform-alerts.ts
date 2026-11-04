import { platformAdmins } from "@/lib/platform";
import { PRODUCT_NAME } from "@/lib/product";
import { missingEmailSettings, sendEmail, type Email, type SendOutcome } from "./resend";

/**
 * Emails to Waivern's operators (PLATFORM_ADMINS) when something is waiting on
 * them. Each says what happened and links to the page where it is dealt with;
 * the page, not the email, is where it is decided.
 *
 * The builders are pure so the wording can be tested without sending.
 */

/** The deployment's own address, for links back into it. */
function appUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.AUTH_URL ?? "").replace(/\/+$/, "");
}

const footer = (url: string) =>
  `\n\n-\nSent by ${PRODUCT_NAME}${url ? ` (${url})` : ""} to the Waivern platform administrators.`;

export function organisationRequestEmail(
  request: { organisationName: string; entityName: string; requestedByEmail: string; note: string | null },
  url = appUrl(),
): Omit<Email, "to"> {
  const lines = [
    `${request.requestedByEmail} has asked for a new organisation.`,
    "",
    `Organisation: ${request.organisationName}`,
    `First legal entity: ${request.entityName}`,
  ];
  if (request.note) lines.push("", "Their note:", request.note);
  lines.push("", `Approve or decline it at ${url}/platform`);
  return {
    subject: `New organisation request: ${request.organisationName}`,
    text: lines.join("\n") + footer(url),
    tag: "organisation-request",
  };
}

export function feedbackEmail(
  feedback: { message: string; placeLabel: string; contactEmail: string | null },
  url = appUrl(),
): Omit<Email, "to"> {
  const from = feedback.contactEmail
    ? `${feedback.contactEmail} sent feedback and agreed to be emailed about it.`
    : "Someone sent feedback anonymously.";
  return {
    subject: `Feedback about ${feedback.placeLabel}`,
    text: [from, "", `About: ${feedback.placeLabel}`, "", feedback.message, "", `See all feedback at ${url}/platform/feedback`].join(
      "\n",
    ) + footer(url),
    tag: "feedback",
  };
}

/** A check that email works, asked for by one operator and sent to them all. */
export function testEmail(requestedBy: string, url = appUrl()): Omit<Email, "to"> {
  return {
    subject: "Test email",
    text: [
      `${requestedBy} sent this from the platform page to check that email works.`,
      "",
      "If you are reading it, alerts about new organisation requests and feedback will reach you too. There is nothing to do.",
    ].join("\n") + footer(url),
    tag: "test",
  };
}

/** What happened to a test email, in words an operator can act on. */
export function describeTestOutcome(
  outcome: SendOutcome,
  recipients: number,
  missing: string[] = missingEmailSettings(),
): { ok: boolean; message: string } {
  if (outcome.sent) {
    return {
      ok: true,
      message: `Sent to ${recipients} platform administrator${recipients === 1 ? "" : "s"}. Resend's message id is ${outcome.messageId}.`,
    };
  }
  switch (outcome.reason) {
    case "not_configured":
      return { ok: false, message: `Nothing was sent: email is not set up here. Missing: ${missing.join(", ")}.` };
    case "no_recipients":
      return { ok: false, message: "Nothing was sent: PLATFORM_ADMINS names nobody." };
    case "unreachable":
      return { ok: false, message: "Nothing was sent: Resend could not be reached. Try again shortly." };
    default: {
      const why = outcome.reason.replace(/^resend_/, "");
      const hint =
        why === "validation_error"
          ? " This usually means EMAIL_FROM is not at a domain verified in Resend."
          : why === "missing_api_key" || why === "invalid_api_key" || why === "restricted_api_key"
            ? " Check RESEND_API_KEY, and that the key may send email."
            : "";
      return { ok: false, message: `Resend refused it (${why}).${hint}` };
    }
  }
}

/** Send to every platform administrator. Never throws; see `sendEmail`. */
export async function alertPlatformAdmins(
  message: Omit<Email, "to">,
  options?: Parameters<typeof sendEmail>[1],
): Promise<SendOutcome> {
  return sendEmail({ ...message, to: platformAdmins() }, options);
}
