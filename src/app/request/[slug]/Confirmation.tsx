'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The message that replaces a form once it is sent. It takes focus, so a
 * screen reader reads it out and the page scrolls to it, which matters inside
 * a frame on somebody else's page, where the form may have been far below.
 */
export function Confirmation({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section
      ref={ref}
      role="status"
      tabIndex={-1}
      className="space-y-3 rounded border border-emerald-700 bg-emerald-50 p-5 text-emerald-950 focus:outline-none"
    >
      {children}
    </section>
  );
}
