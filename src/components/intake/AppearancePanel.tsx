import { RefusableForm } from '@/components/foi/RefusableForm';
import { LOGO_MAX_BYTES, THEME } from '@/lib/form-appearance';
import { PRODUCT_VENDOR } from '@/lib/product';

type Result = { ok: boolean; message: string } | null;

const input = 'w-full rounded border border-line bg-surface px-3 py-2 text-sm';

function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 rounded-sm border border-line align-middle"
      style={{ background: colour }}
    />
  );
}

/**
 * How a public form looks: the organisation's logo and colours, whether it
 * shows the page behind it in a frame, and the "Powered by" line. Shared by
 * both registers.
 */
export function AppearancePanel({
  slug,
  link,
  setAppearance
}: {
  slug: string;
  link: {
    showPoweredBy: boolean;
    accentColour: string | null;
    background: string | null;
    logoSha256: string | null;
  };
  /** Null where this person may not change it. */
  setAppearance: ((prev: Result, formData: FormData) => Promise<Result>) | null;
}) {
  const mode =
    link.background === 'transparent'
      ? 'transparent'
      : link.background
        ? 'colour'
        : 'default';
  const summary = [
    link.logoSha256 ? 'logo' : null,
    link.accentColour ? 'own colour' : null,
    mode === 'transparent' ? 'blends into a frame' : null,
    link.showPoweredBy ? null : `no ${PRODUCT_VENDOR} line`
  ].filter(Boolean);

  return (
    <details className="rounded border border-line">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
        Appearance
        {summary.length ? ` (${summary.join(', ')})` : ''}
      </summary>
      <div className="space-y-3 border-t border-line p-3 text-xs">
        {!setAppearance ? (
          <p className="text-ink-soft">
            {summary.length
              ? `This form has: ${summary.join(', ')}.`
              : 'This form uses the standard look.'}{' '}
            An owner or administrator can change it.
          </p>
        ) : (
          <RefusableForm
            action={setAppearance}
            submit="Save the appearance"
            resetOnSuccess={false}
            className="space-y-3"
          >
            <p className="max-w-prose text-ink-soft">
              Make the form look like your own. Colours are checked so the form
              stays readable for everybody: text and buttons need a contrast of
              at least 4.5:1 (WCAG 2.2 AA, which public bodies must meet).
            </p>
            <label className="block space-y-1">
              <span className="font-medium">Logo</span>
              <span className="block text-ink-soft">
                PNG, JPEG or WebP, up to {LOGO_MAX_BYTES / 1024} KB. Shown at
                the top of the form, with your organisation&apos;s name as its
                text alternative.
              </span>
              {link.logoSha256 ? (
                // eslint-disable-next-line @next/next/no-img-element -- the form's own small logo
                <img
                  src={`/request/${slug}/logo?v=${link.logoSha256.slice(0, 16)}`}
                  alt="The current logo"
                  className="h-10 w-auto rounded border border-line bg-surface p-1"
                />
              ) : null}
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp"
                className="block text-xs"
              />
            </label>
            {link.logoSha256 ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="removeLogo"
                  className="accent-brand"
                />
                Remove the logo
              </label>
            ) : null}
            <label className="block space-y-1">
              <span className="font-medium">
                Accent colour{' '}
                <Swatch colour={link.accentColour ?? THEME.brand} />
              </span>
              <span className="block text-ink-soft">
                For links and the button, as a hex code such as #1c4371. Leave
                it empty for the standard blue. It must be dark enough for white
                text.
              </span>
              <input
                name="accent"
                defaultValue={link.accentColour ?? ''}
                placeholder={THEME.brand}
                className={`${input} font-mono`}
              />
            </label>
            <fieldset className="space-y-1">
              <legend className="font-medium">Background</legend>
              <select
                name="backgroundMode"
                defaultValue={mode}
                className={input}
                aria-label="Background"
              >
                <option value="default">The standard light grey</option>
                <option value="colour">A colour of your own</option>
                <option value="transparent">
                  Show the page behind it, when it is in a frame
                </option>
              </select>
              <input
                name="backgroundColour"
                defaultValue={mode === 'colour' ? (link.background ?? '') : ''}
                placeholder="#ffffff, for a colour of your own"
                aria-label="Background colour"
                className={`${input} font-mono`}
              />
              <span className="block text-ink-soft">
                Showing the page behind it makes a framed form look part of your
                page. Its text stays dark, so the page behind it must be light.
                Opened on its own, the form keeps the standard background.
              </span>
            </fieldset>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="showPoweredBy"
                defaultChecked={link.showPoweredBy}
                className="mt-0.5 accent-brand"
              />
              <span>
                Show &ldquo;Powered by {PRODUCT_VENDOR}&rdquo; at the foot
                <span className="block text-ink-soft">
                  A small line that opens {PRODUCT_VENDOR}&apos;s website in a
                  new tab. Switch it off to show only your own name.
                </span>
              </span>
            </label>
          </RefusableForm>
        )}
      </div>
    </details>
  );
}
