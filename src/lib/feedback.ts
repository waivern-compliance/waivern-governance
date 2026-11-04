/**
 * Feedback on the product, from anyone signed in, to Waivern.
 *
 * Pure. Feedback belongs to no organisation: it is about the product, and
 * Waivern's operators read it. It is anonymous unless the person ticks the
 * box to share their email address for a follow-up conversation, and then
 * only that address is kept — never a user id, a name or the organisation.
 *
 * Where it was given is kept as the page's route with its record ids taken
 * out, so "a processing record" is recorded, not which one: an id would tie
 * anonymous feedback to an organisation's records.
 */

export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 4000;

export class FeedbackRefused extends Error {}

/** Route prefixes and what a person would call the page, most specific first. */
const PLACES: Array<[RegExp, string]> = [
  [/^\/app$/, 'Home'],
  [/^\/app\/tasks/, 'Tasks'],
  [/^\/app\/dashboard/, 'Governance overview'],
  [/^\/app\/trends/, 'Trends'],
  [/^\/app\/assessments\/\[id\]/, 'An assessment'],
  [/^\/app\/assessments/, 'Assessments'],
  [/^\/app\/reviews/, 'Recurring reviews'],
  [/^\/app\/ropa\/\[id\]/, 'A processing record'],
  [/^\/app\/ropa/, 'Processing register'],
  [/^\/app\/policy-documents/, 'Appropriate policy documents'],
  [/^\/app\/sharing-agreements/, 'Data sharing agreements'],
  [/^\/app\/third-parties/, 'Third parties'],
  [/^\/app\/ai\/\[id\]/, 'An AI use case'],
  [/^\/app\/ai/, 'AI register'],
  [/^\/app\/breaches/, 'Breaches'],
  [/^\/app\/requests\/\[id\]/, 'A data subject request'],
  [/^\/app\/requests/, 'Data subject requests'],
  [/^\/app\/cookies/, 'Cookies and similar technologies'],
  [/^\/app\/marketing/, 'Electronic marketing'],
  [/^\/app\/complaints/, 'Data protection complaints'],
  [/^\/app\/risks/, 'Risk register'],
  [/^\/app\/findings/, 'Scan findings'],
  [/^\/app\/countries/, 'Country library'],
  [/^\/app\/exports/, 'Exports'],
  [/^\/app\/training/, 'AI learning'],
  [/^\/app\/templates/, 'Assessment templates'],
  [/^\/app\/help/, 'Help'],
  [/^\/app\/profile/, 'Your profile'],
  [/^\/app\/admin\/organisation/, 'Organisation'],
  [/^\/app\/admin\/people/, 'People and access'],
  [/^\/app\/admin\/workflows/, 'Approval workflows'],
  [/^\/app\/admin/, 'Settings']
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A record reference such as ROPA-2026-0002 or DSR-2026-0003. */
const REFERENCE = /^[A-Z]{2,6}-\d{4}-\d{3,}$/i;

/**
 * The page a person was on, as a route with its record ids replaced by
 * `[id]`, and its name. Anything outside the app is "Elsewhere".
 */
export function placeOf(pathname: string): { place: string; label: string } {
  const path = (pathname.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/';
  const place = path
    .split('/')
    .map((s) => (UUID.test(s) || REFERENCE.test(s) ? '[id]' : s))
    .join('/')
    .slice(0, 200);
  const label = PLACES.find(([re]) => re.test(place))?.[1] ?? 'Elsewhere';
  return { place, label };
}

export type Feedback = {
  message: string;
  place: string;
  placeLabel: string;
  /** Present only where the person agreed to be contacted. */
  contactEmail: string | null;
};

/**
 * The feedback as it will be kept. The email address is the signed-in
 * person's own, kept only when they agreed; it is never typed in, so it
 * cannot be somebody else's.
 */
export function cleanFeedback(input: {
  message: unknown;
  pathname: unknown;
  shareEmail: boolean;
  email: string | null | undefined;
}): Feedback {
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length < FEEDBACK_MIN)
    throw new FeedbackRefused('Say what you would like us to know.');
  if (message.length > FEEDBACK_MAX) {
    throw new FeedbackRefused(
      `That is ${message.length} characters; feedback can be up to ${FEEDBACK_MAX}.`
    );
  }
  const { place, label } = placeOf(
    typeof input.pathname === 'string' ? input.pathname : '/'
  );
  const email = input.email?.trim().toLowerCase() || null;
  if (input.shareEmail && !email)
    throw new FeedbackRefused(
      'We could not find your email address. Send it anonymously instead.'
    );
  return {
    message,
    place,
    placeLabel: label,
    contactEmail: input.shareEmail ? email : null
  };
}
