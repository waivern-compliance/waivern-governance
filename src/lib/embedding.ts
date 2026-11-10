/**
 * Showing a public request form inside another website's page.
 *
 * Every page refuses to be framed (`frame-ancestors 'none'` and
 * `X-Frame-Options: DENY`), so nobody can dress it up inside a page that
 * tricks people into clicking. The one exception is a public request form,
 * and only on the websites listed against it: the organisation's own, where
 * it wants people to make requests without leaving.
 *
 * A website is named by its origin, `https://` and a host, matched exactly.
 * No wildcards: `https://*.example.org` would let any subdomain anybody can
 * create frame the form. Plain HTTP only for localhost, and only outside
 * production, for testing a page before it goes live: in production a
 * localhost website would let any page on a visitor's own machine frame it.
 *
 * The form sets no cookies, so browsers that block third-party cookies change
 * nothing about how it works in a frame.
 */

/** How many websites one form may be shown on. */
export const MAX_FRAME_ORIGINS = 10;

export class FrameOriginRefused extends Error {}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether localhost may be listed: everywhere but production. */
const LOCAL_ALLOWED = process.env.NODE_ENV !== 'production';

/** One website, as typed, made into the origin a browser compares, or refused. */
export function normaliseOrigin(
  input: string,
  allowLocal = LOCAL_ALLOWED
): string {
  const typed = input.trim();
  if (!typed) throw new FrameOriginRefused('Give a website address.');
  if (typed.includes('*'))
    throw new FrameOriginRefused(
      `${typed}: name each website in full. Wildcards would let any site under that name show the form.`
    );
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`
    );
  } catch {
    throw new FrameOriginRefused(`${typed} is not a website address.`);
  }
  const local = LOCAL.has(url.hostname);
  if (local && !allowLocal)
    throw new FrameOriginRefused(
      `${typed}: a website on your own computer cannot show the live form. Use the address of the published page.`
    );
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new FrameOriginRefused(
      `${typed}: the website must use https, so the form cannot be tampered with on the way.`
    );
  if (url.username || url.password)
    throw new FrameOriginRefused(`${typed} is not a website address.`);
  if (!local && !url.hostname.includes('.'))
    throw new FrameOriginRefused(`${typed} is not a website address.`);
  // A path or query is not part of what the browser checks; leave it off
  // rather than suggest the form is limited to one page.
  return url.origin;
}

/** A list of websites, one per line or separated by commas or spaces, checked and de-duplicated. */
export function normaliseOrigins(
  input: string | readonly string[],
  allowLocal = LOCAL_ALLOWED
): string[] {
  const items = (typeof input === 'string' ? input.split(/[\s,]+/) : input)
    .map((s) => s.trim())
    .filter(Boolean);
  const origins = [
    ...new Set(items.map((i) => normaliseOrigin(i, allowLocal)))
  ];
  if (origins.length > MAX_FRAME_ORIGINS)
    throw new FrameOriginRefused(
      `A form can be shown on at most ${MAX_FRAME_ORIGINS} websites.`
    );
  return origins;
}

/** The `frame-ancestors` value for a page: `'none'` unless websites are listed. */
export function frameAncestors(origins: readonly string[]): string {
  return origins.length > 0 ? origins.join(' ') : "'none'";
}

/** The public form's path, which the proxy recognises. */
export const FORM_PATH = /^\/request\/([A-Za-z0-9_-]{8,64})\/?$/;

/** The message a framed form sends its parent page as its height changes. */
export const RESIZE_MESSAGE = 'waivern-form-height';

/** Text made safe inside a double-quoted HTML attribute. */
function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** What an organisation pastes into its own page to show a form. */
export function embedSnippets(input: {
  appOrigin: string;
  slug: string;
  title: string;
}) {
  const src = `${input.appOrigin}/request/${input.slug}`;
  const title = escapeAttribute(input.title);
  // A starting height, not a minimum: the resize script replaces it, and must
  // be able to shrink the frame when the form gives way to its confirmation.
  const iframe = `<iframe src="${src}" title="${title}" style="width:100%;height:1000px;border:0" loading="lazy"></iframe>`;
  // Grows the frame to fit the form, so it never scrolls inside the page. It
  // only believes messages from the form's own origin, about this form, and
  // finds the frame by the window that sent the message, so it still works if
  // the website rewrites the frame's address.
  const script = `<script>
window.addEventListener('message', function (event) {
  var data = event.data;
  if (event.origin !== '${input.appOrigin}' || !data || data.type !== '${RESIZE_MESSAGE}' || data.form !== '${input.slug}' || typeof data.height !== 'number') return;
  var frames = document.getElementsByTagName('iframe');
  for (var i = 0; i < frames.length; i++)
    if (frames[i].contentWindow === event.source) frames[i].style.height = Math.ceil(data.height) + 'px';
});
</script>`;
  return { link: src, iframe, script };
}
