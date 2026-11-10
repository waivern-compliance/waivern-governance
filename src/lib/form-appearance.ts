/**
 * How a public request form looks: the organisation's accent colour, its page
 * background, its logo, and whether the small "Powered by Waivern" line shows.
 *
 * A form is a public service, often a public body's, and must stay readable
 * (the Public Sector Bodies Accessibility Regulations 2018 point to WCAG 2.2
 * AA). So a colour is accepted only if text on it, and it on the page, keeps
 * the contrast AA asks for: 4.5:1 for text. A transparent background shows the
 * host page through a frame, which Govern cannot see; the form's text stays
 * dark, so the host page behind it must be light.
 */

export class AppearanceRefused extends Error {}

/** The theme's own colours, in sRGB, as `globals.css` defines them in OKLCH. */
export const THEME = {
  ground: '#f7f9fc',
  ink: '#182029',
  inkSoft: '#5c646d',
  brand: '#1c4371'
} as const;

/** The background a form can have: the theme's, a colour, or the host page's when framed. */
export type Background = null | 'transparent' | `#${string}`;

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** `#abc`, `abc` or `#AABBCC` as `#aabbcc`, or null where it is not a colour. */
export function parseHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.2 AA for text (1.4.3). */
export const TEXT_CONTRAST = 4.5;

const ratio = (n: number) => `${(Math.floor(n * 10) / 10).toFixed(1)}:1`;

/**
 * The accent and background as typed, checked and made canonical, or refused
 * with what to change. Empty means the theme's own.
 */
export function checkAppearance(input: {
  accent: string;
  background: string;
}): { accentColour: string | null; background: Background } {
  const accentTyped = input.accent.trim();
  const accent = accentTyped ? parseHex(accentTyped) : null;
  if (accentTyped && !accent)
    throw new AppearanceRefused(
      `${accentTyped} is not a colour. Give it as a hex code, such as #1c4371.`
    );

  const backgroundTyped = input.background.trim().toLowerCase();
  let background: Background = null;
  if (backgroundTyped === 'transparent') background = 'transparent';
  else if (backgroundTyped) {
    const parsed = parseHex(backgroundTyped);
    if (!parsed)
      throw new AppearanceRefused(
        `${input.background.trim()} is not a colour. Give it as a hex code, such as #ffffff.`
      );
    background = parsed as Background;
  }

  // The page the form's text sits on: the colour given, or the theme's. A
  // transparent page is checked as white, the light host page it needs.
  const page =
    background === null
      ? THEME.ground
      : background === 'transparent'
        ? '#ffffff'
        : background;
  if (background !== null && background !== 'transparent') {
    for (const [name, text] of [
      ['text', THEME.ink],
      ['secondary text', THEME.inkSoft]
    ] as const) {
      const r = contrast(text, page);
      if (r < TEXT_CONTRAST)
        throw new AppearanceRefused(
          `The form's ${name} would be hard to read on ${page}: ${ratio(r)}, and at least 4.5:1 is needed. Choose a lighter background.`
        );
    }
  }
  if (accent) {
    const onButton = contrast('#ffffff', accent);
    if (onButton < TEXT_CONTRAST)
      throw new AppearanceRefused(
        `White text on the button would be hard to read on ${accent}: ${ratio(onButton)}, and at least 4.5:1 is needed. Choose a darker colour.`
      );
    const asLink = contrast(accent, page);
    if (asLink < TEXT_CONTRAST)
      throw new AppearanceRefused(
        `Links in ${accent} would be hard to read on the page (${page}): ${ratio(asLink)}, and at least 4.5:1 is needed.`
      );
  }
  return { accentColour: accent, background };
}

// ---------------------------------------------------------------------------
// The page

/**
 * The CSS a form's page needs for its background, or null for the standard
 * one. Transparent applies only in a frame. `framed` is what the server knows
 * from the request (`Sec-Fetch-Dest: iframe`), so the page is transparent from
 * its first paint; the `data-framed` rule covers browsers that do not say.
 * Only checked colours reach here, so they are safe to write into CSS.
 */
export function backgroundStyle(
  background: Background,
  framed: boolean
): string | null {
  if (background === 'transparent')
    return framed
      ? 'body{background:transparent}'
      : 'html[data-framed] body{background:transparent}';
  if (background && parseHex(background) === background)
    return `body{background:${background}}`;
  return null;
}

/**
 * The browser tab's title: with the "Powered by" line switched off, only the
 * form's, so nothing on the page names the product but its address.
 */
export function pageTitle(
  title: string,
  showPoweredBy: boolean
): string | { absolute: string } {
  return showPoweredBy ? title : { absolute: title };
}

// ---------------------------------------------------------------------------
// Logos

/** The largest logo accepted. A logo is a few kilobytes; this leaves room. */
export const LOGO_MAX_BYTES = 256 * 1024;

/**
 * The image types a logo may be, told apart by their first bytes rather than
 * by what the upload claims. No SVG: it can carry script.
 */
export function logoType(bytes: Uint8Array): string | null {
  const starts = (sig: number[], at = 0) =>
    sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  return null;
}

/** A logo upload checked, or refused with why. */
export function checkLogo(bytes: Uint8Array): string {
  if (bytes.byteLength === 0)
    throw new AppearanceRefused('The logo file is empty.');
  if (bytes.byteLength > LOGO_MAX_BYTES)
    throw new AppearanceRefused(
      `The logo is ${Math.ceil(bytes.byteLength / 1024)} KB. Keep it to ${LOGO_MAX_BYTES / 1024} KB: a logo on a form needs no more.`
    );
  const type = logoType(bytes);
  if (!type)
    throw new AppearanceRefused(
      'Give the logo as a PNG, JPEG or WebP image. SVG is not accepted, as it can carry script.'
    );
  return type;
}
