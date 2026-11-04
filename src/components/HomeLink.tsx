import Link from 'next/link';

/** A house, inline so it takes `currentColor` like the Waivern mark. */
function House({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

/**
 * The way back to the home page, in the top left of every page that has one.
 *
 * The wordmark beside it goes to the same place, but a logo being a link is a
 * convention plenty of people never learn. A house with the word "Home" needs
 * no learning. `tone` matches the surface: white on the navy masthead, navy on
 * a light page.
 */
export function HomeLink({
  href = '/app',
  tone = 'dark'
}: {
  href?: string;
  tone?: 'dark' | 'light';
}) {
  const colours =
    tone === 'dark'
      ? 'border-white/25 text-white hover:bg-white/10 focus-visible:outline-white'
      : 'border-line text-navy hover:bg-surface focus-visible:outline-navy';
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${colours}`}
    >
      <House />
      Home
    </Link>
  );
}
