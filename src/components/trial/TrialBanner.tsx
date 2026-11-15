'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { inRequestWindow, timeLeft } from '@/lib/trial-rules';

/**
 * The time a trial has left, on every page, counting down. When it reaches
 * the end the page is refreshed, and the session sends it to the page that
 * explains why access has stopped.
 */
export function TrialBanner({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt);
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => {
      const at = new Date();
      setNow(at);
      if (at.getTime() >= new Date(endsAt).getTime()) router.refresh();
    }, 30_000);
    return () => clearInterval(tick);
  }, [endsAt, router]);

  const closing = inRequestWindow(end, now);
  return (
    <div
      role="status"
      className={`border-b ${closing ? 'border-amber-700 bg-amber-50 text-amber-900' : 'border-line bg-surface text-ink'}`}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-2 text-sm">
        <p>
          <span className="font-semibold">Trial:</span> {timeLeft(end, now)}{' '}
          left. Fictional data only: no real personal data, and nothing here
          reaches anybody.
        </p>
        <Link
          href="/app/trial"
          className="font-medium text-brand underline"
        >
          {closing ? 'Ask for more time or a full account' : 'About your trial'}
        </Link>
      </div>
    </div>
  );
}
