import { Mark } from '@/components/Wordmark';
import { PRODUCT_VENDOR, VENDOR_URL } from '@/lib/product';

/**
 * The small line at the foot of a public form. It opens in a new tab, so a
 * click never takes the person away from the form, or out of the website
 * the form is shown on.
 */
export function PoweredBy() {
  return (
    <footer className="border-t border-line pt-4 text-xs text-ink-soft">
      <a
        href={VENDOR_URL}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
      >
        <Mark className="h-4 w-4" />
        Powered by {PRODUCT_VENDOR}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </footer>
  );
}
