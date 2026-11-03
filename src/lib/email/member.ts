import { waivernHosted } from "@/lib/hosting";
import { PRODUCT_NAME } from "@/lib/product";
import { transportConfig, type Email, type EmailConfig } from "./resend";

/**
 * Alert and action emails to an organisation's own people: a task that names
 * them or their role, work of theirs gone overdue, a mention, a decision on an
 * assessment they own.
 *
 * Sent only when both hold:
 *
 * 1. the deployment has switched member email on, with `NOTIFICATION_EMAILS`
 *    set to "true" (and a Resend key and sender to send with); and
 * 2. the person has turned it on in their profile. It starts off.
 *
 * Never on Waivern's shared hosted service. There the choice is shown but
 * greyed out: email to an organisation's people comes with an instance of
 * its own, run by Waivern or by the organisation.
 *
 * What an email says is kept short on purpose. It names the work and links to
 * it; it does not carry a task's description or a comment's words, so records
 * stay in the tool rather than being copied into mailboxes and a mail
 * provider's logs.
 */

export type MemberEmailState =
  /** Waivern's shared service: never, whatever is set. */
  | "hosted"
  /** `NOTIFICATION_EMAILS` is not "true". */
  | "off"
  /** Switched on, but there is no Resend key or sender to send with. */
  | "not_configured"
  | "on";

type Env = Record<string, string | undefined>;

export function memberEmailState(env: Env = process.env): MemberEmailState {
  if (waivernHosted(env)) return "hosted";
  if (env.NOTIFICATION_EMAILS !== "true") return "off";
  return transportConfig(env) ? "on" : "not_configured";
}

/** What sending member email needs, or null where it should not be sent. */
export function memberEmailConfig(env: Env = process.env): EmailConfig | null {
  return memberEmailState(env) === "on" ? transportConfig(env) : null;
}

/**
 * How long a notification stays worth sending. Switching email on later must
 * not empty months of old notices into everybody's inbox at once.
 */
export const STALE_AFTER_HOURS = 48;

/** The kinds of notification that are emailed, and what each is called. */
export const EMAILED_KINDS = {
  "task.raised": "New work for you",
  "task.sla_breached": "Overdue work",
  mention: "Mentions",
  "assessment.decided": "Decisions on your assessments",
} as const;

export type EmailedKind = keyof typeof EMAILED_KINDS;

export function isEmailedKind(kind: string): kind is EmailedKind {
  return kind in EMAILED_KINDS;
}

export type MemberNotice = {
  kind: EmailedKind;
  /** The notification's own subject line, as recorded. */
  subject: string;
  organisationName: string;
  /** The task it is about, where there is one. */
  task?: { title: string; dueAt: Date | null } | null;
  /** Where to open it, relative to the deployment: "/app/tasks", "/app/ropa/…". */
  path: string;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The deployment's own address, for links back into it. */
function appUrl(env: Env = process.env): string {
  return (env.AUTH_URL ?? "").replace(/\/+$/, "");
}

/** One person's email about one notification. Pure, so the wording can be tested. */
export function memberEmail(notice: MemberNotice, url = appUrl()): Omit<Email, "to"> {
  const where = `in ${notice.organisationName}`;
  const due = notice.task?.dueAt ? ` It is due ${day(notice.task.dueAt)}.` : "";
  const lead = (() => {
    switch (notice.kind) {
      case "task.raised":
        return `There is new work for you ${where}: ${notice.task?.title ?? notice.subject}.${due}`;
      case "task.sla_breached":
        return `Work ${where} is overdue: ${notice.task?.title ?? notice.subject}.${due}`;
      case "mention":
        return `${notice.subject} ${where}.`;
      case "assessment.decided":
        return `${notice.subject} ${where}.`;
    }
  })();
  return {
    subject: notice.kind === "task.raised" ? `New task: ${notice.task?.title ?? notice.subject}` : notice.subject,
    text: [
      lead,
      "",
      `Open it: ${url}${notice.path}`,
      "",
      "—",
      `Sent by ${PRODUCT_NAME} because you asked for alert and action emails. To stop them, turn them off on your profile: ${url}/app/profile`,
    ].join("\n"),
    tag: notice.kind.replace(".", "-"),
  };
}
