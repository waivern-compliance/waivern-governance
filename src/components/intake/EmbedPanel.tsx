import { RefusableForm } from '@/components/foi/RefusableForm';
import { embedSnippets, MAX_FRAME_ORIGINS } from '@/lib/embedding';

type Result = { ok: boolean; message: string } | null;

const code =
  'w-full rounded border border-line bg-ground px-3 py-2 font-mono text-xs';

/**
 * How to put a public form on the organisation's own website: the link, or a
 * frame on the websites listed here. Shared by both registers.
 */
export function EmbedPanel({
  appOrigin,
  slug,
  title,
  frameOrigins,
  setOrigins
}: {
  appOrigin: string;
  slug: string;
  /** The frame's title, which screen readers announce. */
  title: string;
  frameOrigins: readonly string[];
  /** Null where this person may not change the list. */
  setOrigins: ((prev: Result, formData: FormData) => Promise<Result>) | null;
}) {
  const { iframe, script } = embedSnippets({ appOrigin, slug, title });
  return (
    <details className="rounded border border-line">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
        Show it on your website
        {frameOrigins.length > 0
          ? ` (${frameOrigins.length} website${frameOrigins.length === 1 ? '' : 's'})`
          : ''}
      </summary>
      <div className="space-y-3 border-t border-line p-3 text-xs">
        <p className="max-w-prose text-ink-soft">
          Link to the address above, or show the form inside a page of your own.
          A frame works only on the websites listed here: every other site is
          refused, so nobody can show your form inside a page made to look like
          yours.
        </p>
        {setOrigins ? (
          <RefusableForm
            action={setOrigins}
            submit="Save the websites"
            resetOnSuccess={false}
            className="space-y-2"
          >
            <label className="block space-y-1">
              <span className="font-medium">Websites that may show it</span>
              <span className="block text-ink-soft">
                One per line, such as https://www.example.gov.uk. Each must use
                https, with no wildcards. At most {MAX_FRAME_ORIGINS}. Leave it
                empty to allow none.
              </span>
              {/* Keyed on the saved list, so a save shows the websites as
                  stored (origins only), while a refusal keeps what was typed. */}
              <textarea
                key={frameOrigins.join('\n')}
                name="origins"
                rows={3}
                defaultValue={frameOrigins.join('\n')}
                className={code}
              />
            </label>
          </RefusableForm>
        ) : (
          <p>
            {frameOrigins.length > 0
              ? `Allowed on: ${frameOrigins.join(', ')}.`
              : 'Not allowed on any website yet.'}
          </p>
        )}
        <label className="block space-y-1">
          <span className="font-medium">The frame</span>
          <span className="block text-ink-soft">
            Paste it where the form should appear. Keep the title: screen
            readers announce it, and public bodies must make their websites
            accessible.
          </span>
          <textarea
            readOnly
            rows={3}
            value={iframe}
            className={code}
          />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">
            The resize script{' '}
            <span className="font-normal text-ink-soft">(optional)</span>
          </span>
          <span className="block text-ink-soft">
            Paste it once on the same page. It grows the frame to fit the form,
            and only listens to this form.
          </span>
          <textarea
            readOnly
            rows={6}
            value={script}
            className={code}
          />
        </label>
      </div>
    </details>
  );
}
