/** The label above a public page's headline, saying what the page is about. */
export function PageTag({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-block rounded-full bg-brand px-5 py-2 text-sm font-bold uppercase tracking-wider text-white shadow-md sm:text-base">
      {children}
    </p>
  );
}
