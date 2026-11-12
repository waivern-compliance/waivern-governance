/** The label above a public page's headline, saying what the page is about. */
export function PageTag({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-bold uppercase tracking-wider text-white shadow-md sm:text-base">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full bg-white"
      />
      {children}
    </p>
  );
}
