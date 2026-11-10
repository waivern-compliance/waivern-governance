import { RefusableForm } from '@/components/foi/RefusableForm';
import { inputClass } from '@/components/form-classes';
import { LOGO_MAX_BYTES, THEME } from '@/lib/form-appearance';
import { PRODUCT_VENDOR } from '@/lib/product';
import type { Appearance, AppearanceSource } from '@/services/form-appearance';

type Result = { ok: boolean; message: string } | null;

function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 rounded-sm border border-line align-middle"
      style={{ background: colour }}
    />
  );
}

function describe(a: Appearance): string[] {
  return [
    a.logoSha256 ? 'logo' : null,
    a.accentColour ? 'own colour' : null,
    a.background === 'transparent'
      ? 'blends into a frame'
      : a.background
        ? 'own background'
        : null,
    a.showPoweredBy ? null : `no ${PRODUCT_VENDOR} line`
  ].filter((x): x is string => x !== null);
}

/**
 * How public forms look. With `scope` 'organisation', the appearance every
 * form uses; with 'form', one form's, which can follow the organisation's or
 * be its own. Shared by both registers.
 */
export function AppearancePanel({
  scope,
  appearance,
  source = 'organisation',
  previewSlug,
  setAppearance
}: {
  scope: 'organisation' | 'form';
  appearance: Appearance;
  /** For a form: whether what it shows is its own, or inherited. */
  source?: AppearanceSource;
  /** A form showing this appearance, to preview the logo from. */
  previewSlug?: string | null;
  /** Null where this person may not change it. */
  setAppearance: ((prev: Result, formData: FormData) => Promise<Result>) | null;
}) {
  const a = appearance;
  const own = scope === 'organisation' || source === 'form';
  const mode =
    a.background === 'transparent'
      ? 'transparent'
      : a.background
        ? 'colour'
        : 'default';
  const summary = describe(a);
  const heading =
    scope === 'organisation'
      ? 'Appearance of your forms'
      : own
        ? 'Appearance: its own'
        : "Appearance: the organisation's";

  return (
    <details className="rounded border border-line">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
        {heading}
        {summary.length ? ` (${summary.join(', ')})` : ''}
      </summary>
      <div className="space-y-3 border-t border-line p-3 text-xs">
        {!setAppearance ? (
          <p className="text-ink-soft">
            {summary.length
              ? `It has: ${summary.join(', ')}.`
              : 'It uses the standard look.'}{' '}
            An owner or administrator can change it.
          </p>
        ) : (
          <RefusableForm
            action={setAppearance}
            submit="Save the appearance"
            resetOnSuccess={false}
            className="space-y-3"
          >
            {/* Remounted with what was stored, so a save shows the colours
                as kept and clears the file and the remove tick, while the
                form keeps its message. */}
            <div
              key={JSON.stringify([a, source])}
              className="space-y-3"
            >
              {scope === 'organisation' ? (
                <p className="max-w-prose text-ink-soft">
                  Every public form uses this, data protection and freedom of
                  information alike, unless it has its own. Set it once: a new
                  form starts with it.
                </p>
              ) : (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="inherit"
                    defaultChecked={!own}
                    className="mt-0.5 accent-brand"
                  />
                  <span>
                    Use the organisation&apos;s appearance
                    <span className="block text-ink-soft">
                      Untick to give this form its own, for an entity with a
                      brand of its own. The settings below start from what it
                      shows now.
                    </span>
                  </span>
                </label>
              )}
              <p className="max-w-prose text-ink-soft">
                Colours are checked so the form stays readable for everybody:
                text and buttons need a contrast of at least 4.5:1 (WCAG 2.2 AA,
                which public bodies must meet).
              </p>
              <label className="block space-y-1">
                <span className="font-medium">Logo</span>
                <span className="block text-ink-soft">
                  PNG, JPEG or WebP, up to {LOGO_MAX_BYTES / 1024} KB. Shown at
                  the top of the form.
                </span>
                {a.logoSha256 && previewSlug ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the form's own small logo
                  <img
                    src={`/request/${previewSlug}/logo?v=${a.logoSha256.slice(0, 16)}`}
                    alt="The current logo"
                    className="h-10 w-auto rounded border border-line bg-surface p-1"
                  />
                ) : a.logoSha256 ? (
                  <span className="block">A logo is set.</span>
                ) : null}
                <input
                  type="file"
                  name="logo"
                  accept="image/png,image/jpeg,image/webp"
                  className="block text-xs"
                />
              </label>
              {a.logoSha256 ? (
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
                  <Swatch colour={a.accentColour ?? THEME.brand} />
                </span>
                <span className="block text-ink-soft">
                  For links and the button, as a hex code such as #1c4371. Leave
                  it empty for the standard blue. It must be dark enough for
                  white text.
                </span>
                <input
                  name="accent"
                  defaultValue={a.accentColour ?? ''}
                  placeholder={THEME.brand}
                  className={`${inputClass} font-mono`}
                />
              </label>
              <fieldset className="space-y-1">
                <legend className="font-medium">Background</legend>
                <select
                  name="backgroundMode"
                  defaultValue={mode}
                  className={inputClass}
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
                  defaultValue={mode === 'colour' ? (a.background ?? '') : ''}
                  placeholder="#ffffff, for a colour of your own"
                  aria-label="Background colour"
                  className={`${inputClass} font-mono`}
                />
                <span className="block text-ink-soft">
                  Showing the page behind it makes a framed form look part of
                  your page. Its text stays dark, so the page behind it must be
                  light, and must not ask for a dark colour scheme: browsers put
                  a solid backdrop behind a frame whose colour scheme differs
                  from the page&apos;s, which keeps the form readable in dark
                  mode. Opened on its own, the form keeps the standard
                  background.
                </span>
              </fieldset>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="showPoweredBy"
                  defaultChecked={a.showPoweredBy}
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
            </div>
          </RefusableForm>
        )}
      </div>
    </details>
  );
}
