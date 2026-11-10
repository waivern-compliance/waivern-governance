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
 * create frame the form. Plain HTTP only for localhost, for testing a page
 * before it goes live.
 *
 * The form sets no cookies, so browsers that block third-party cookies change
 * nothing about how it works in a frame.
 */

/** How many websites one form may be shown on. */
export const MAX_FRAME_ORIGINS = 10;

export class FrameOriginRefused extends Error {}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/** One website, as typed, made into the origin a browser compares, or refused. */
export function normaliseOrigin(input: string): string {
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
export function normaliseOrigins(input: string | readonly string[]): string[] {
  const items = (typeof input === 'string' ? input.split(/[\s,]+/) : input)
    .map((s) => s.trim())
    .filter(Boolean);
  const origins = [...new Set(items.map(normaliseOrigin))];
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

/** What an organisation pastes into its own page to show a form. */
export function embedSnippets(input: {
  appOrigin: string;
  slug: string;
  title: string;
}) {
  const src = `${input.appOrigin}/request/${input.slug}`;
  const title = input.title.replace(/"/g, '&quot;');
  const iframe = `<iframe src="${src}" title="${title}" style="width:100%;min-height:1000px;border:0" loading="lazy"></iframe>`;
  // Grows the frame to fit the form, so it never scrolls inside the page. It
  // only believes messages from the form's own origin, about this form.
  const script = `<script>
window.addEventListener('message', function (event) {
  var data = event.data;
  if (event.origin !== '${input.appOrigin}' || !data || data.type !== '${RESIZE_MESSAGE}' || data.form !== '${input.slug}') return;
  var frame = document.querySelector('iframe[src="${src}"]');
  if (frame && typeof data.height === 'number') frame.style.height = Math.ceil(data.height) + 'px';
});
</script>`;
  return { link: src, iframe, script };
}
