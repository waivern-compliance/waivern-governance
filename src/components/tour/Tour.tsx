'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition
} from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';

import { recordTourAction } from '@/app/app/actions';
import { Mark } from '@/components/Wordmark';
import {
  TOUR_BUDGET_SECONDS,
  type TourOutcome,
  type TourStep
} from '@/lib/tour/steps';

type Box = { top: number; left: number; width: number; height: number };

/** Space left around a highlighted element, so its border is not clipped. */
const PAD = 6;
/** Below this width the card sits along the bottom of the screen. */
const NARROW = 640;

const button =
  'rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60';
const primary = `${button} bg-brand text-white hover:opacity-90`;
const secondary = `${button} border border-line bg-surface hover:border-brand`;
const quiet = `${button} text-ink-soft underline underline-offset-2 hover:text-brand`;

const subscribeToNothing = () => () => {};

/** The tour's own node at the end of the body, marked so it can be found. */
function newHost() {
  const node = document.createElement('div');
  node.dataset.tourHost = '';
  return node;
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The first element on the page a step points at that is actually shown. */
function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const found = document.querySelectorAll<HTMLElement>(
    `[data-tour="${step.target}"]`
  );
  return Array.from(found).find((el) => el.getClientRects().length > 0) ?? null;
}

/**
 * The guided tour of the home page, and the offer of it.
 *
 * Offered in the page, not over it: somebody who wants to get on with their
 * work can scroll past it or say no. Once started it is a modal dialog, so the
 * page behind is inert and focus stays in the card until they finish or leave.
 */
export function Tour({
  steps,
  offer,
  start
}: {
  steps: TourStep[];
  /** Show the offer card: they have never answered it. */
  offer: boolean;
  /** Start straight away, as the replay links from Help and the profile page ask. */
  start: boolean;
}) {
  const [phase, setPhase] = useState<'offer' | 'running' | 'closed'>(
    start ? 'running' : offer ? 'offer' : 'closed'
  );
  const [index, setIndex] = useState(0);
  const [, startTransition] = useTransition();
  const returnFocus = useRef<HTMLElement | null>(null);

  // A replay link should not restart the tour on every reload. Through the
  // router rather than the history API, because recording the outcome
  // refreshes the page and the router would put its own address back.
  const router = useRouter();
  useEffect(() => {
    if (start) router.replace('/app', { scroll: false });
  }, [start, router]);

  const record = useCallback((outcome: TourOutcome) => {
    startTransition(async () => {
      // Not worth an error page: the tour has already closed, and if the
      // answer was not kept it is simply offered again next time.
      try {
        await recordTourAction(outcome);
      } catch {}
    });
  }, []);

  const begin = () => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setIndex(0);
    setPhase('running');
  };

  const close = useCallback(
    (outcome: TourOutcome) => {
      setPhase('closed');
      record(outcome);
      const back = returnFocus.current;
      requestAnimationFrame(() => {
        if (back?.isConnected && back !== document.body) return back.focus();
        // Started from a replay link, so nothing on this page had focus.
        const heading = document.querySelector<HTMLElement>('main h1');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus();
      });
    },
    [record]
  );

  if (phase === 'offer') {
    return (
      <Offer
        onStart={begin}
        onDecline={() => {
          setPhase('closed');
          record('dismissed');
        }}
      />
    );
  }
  if (phase === 'running') {
    return (
      <Overlay
        steps={steps}
        index={index}
        onMove={setIndex}
        onClose={close}
      />
    );
  }
  return null;
}

function Offer({
  onStart,
  onDecline
}: {
  onStart: () => void;
  onDecline: () => void;
}) {
  const minutes = Math.ceil(TOUR_BUDGET_SECONDS / 60);
  return (
    <section
      aria-labelledby="tour-offer-heading"
      className="flex flex-wrap items-center gap-4 rounded border border-brand/40 bg-surface p-5 motion-safe:animate-[tour-in_200ms_ease-out]"
    >
      <span className="tour-draw text-navy">
        <Mark className="h-10 w-10" />
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <h2
          id="tour-offer-heading"
          className="text-sm font-semibold"
        >
          New here?
        </h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-soft">
          A {minutes}-minute tour shows how the tool is meant to be used: set it
          up, assess, then keep up with what comes round.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onStart}
          className={primary}
        >
          Start the tour
        </button>
        <button
          type="button"
          onClick={onDecline}
          className={secondary}
        >
          No thanks
        </button>
      </div>
    </section>
  );
}

function Overlay({
  steps,
  index,
  onMove,
  onClose
}: {
  steps: TourStep[];
  index: number;
  onMove: (index: number) => void;
  onClose: (outcome: TourOutcome) => void;
}) {
  const step = steps[index];
  const last = index === steps.length - 1;
  // Rendered on the client only: a replay link starts the tour on the first
  // render, which the server has no body to put a portal in.
  const client = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
  const [host] = useState(() =>
    typeof document === 'undefined' ? null : newHost()
  );
  const [box, setBox] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({
    width: 0,
    height: 0,
    scrollX: 0,
    scrollY: 0
  });
  const [cardHeight, setCardHeight] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  // Its own node at the end of the body, so everything else can be made inert.
  useLayoutEffect(() => {
    const node = host;
    if (!node) return;
    document.body.appendChild(node);
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el !== node && el instanceof HTMLElement
    );
    const wasInert = new Map(others.map((el) => [el, el.inert]));
    others.forEach((el) => (el.inert = true));
    // Whatever arrives while the tour is open - a toast, a portal, a node
    // React re-creates - joins the page behind rather than escaping the modal.
    const arrivals = new MutationObserver((records) => {
      for (const r of records) {
        for (const added of Array.from(r.addedNodes)) {
          if (added === node || !(added instanceof HTMLElement)) continue;
          if (!wasInert.has(added)) wasInert.set(added, added.inert);
          added.inert = true;
        }
      }
    });
    arrivals.observe(document.body, { childList: true });
    return () => {
      arrivals.disconnect();
      wasInert.forEach((was, el) => (el.inert = was));
      node.remove();
    };
  }, [host]);

  // Bring the step's element into view and follow it as the page moves.
  useLayoutEffect(() => {
    const target = findTarget(step);
    const measure = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      });
      if (!target) return setBox(null);
      const r = target.getBoundingClientRect();
      // In page coordinates, so the highlight scrolls with the page natively
      // and only glides when the step changes, never behind a scroll.
      setBox({
        top: r.top + window.scrollY - PAD,
        left: r.left + window.scrollX - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2
      });
    };
    if (target) {
      const r = target.getBoundingClientRect();
      const narrow = window.innerWidth < NARROW;
      // On a phone the card covers the lower part of the screen, so the
      // element goes to the top; elsewhere to the middle, unless it is taller
      // than the screen, when its top is what matters.
      const top =
        narrow || r.height > window.innerHeight * 0.6
          ? r.top + window.scrollY - 24
          : r.top + window.scrollY - (window.innerHeight - r.height) / 2;
      window.scrollTo({
        top: Math.max(0, top),
        behavior: reducedMotion() ? 'auto' : 'smooth'
      });
    }
    measure();
    // Measured on every event rather than once a frame: a background tab
    // throttles frames, and a highlight left behind mid-scroll points at the
    // wrong thing. `scrollend` settles it where smooth scrolling stops.
    const events = ['scroll', 'scrollend', 'resize'] as const;
    events.forEach((e) =>
      window.addEventListener(e, measure, { passive: true })
    );
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    return () => {
      events.forEach((e) => window.removeEventListener(e, measure));
      observer.disconnect();
    };
  }, [step]);

  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight);
  }, [step, client, viewport.width]);

  // Each step starts on the button that moves it on.
  useEffect(() => {
    if (client) next.current?.focus();
  }, [client, index]);

  const back = () => onMove(Math.max(0, index - 1));
  const forward = () => (last ? onClose('finished') : onMove(index + 1));

  // On the document rather than the overlay, so the keys still work when a
  // click on the dimmed page behind has taken focus off the card.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose('dismissed');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        forward();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      } else if (e.key === 'Tab') {
        // The page behind is inert; this keeps Tab cycling inside the card
        // rather than escaping to the browser's own controls and back.
        const focusable = Array.from(
          card.current?.querySelectorAll<HTMLElement>('button') ?? []
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const end = focusable[focusable.length - 1];
        const inside = focusable.includes(
          document.activeElement as HTMLElement
        );
        if (!inside || (e.shiftKey && document.activeElement === first)) {
          e.preventDefault();
          (e.shiftKey ? end : first).focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!client || !host) return null;

  const narrow = viewport.width < NARROW;
  const cardWidth = Math.min(384, viewport.width - 32);
  let placement: React.CSSProperties;
  if (narrow) {
    placement = { left: 16, right: 16, bottom: 16 };
  } else if (!box) {
    placement = {
      left: (viewport.width - cardWidth) / 2,
      top: Math.max(16, (viewport.height - cardHeight) / 2),
      width: cardWidth
    };
  } else {
    const onScreen = box.top - viewport.scrollY;
    const below = onScreen + box.height + 12;
    const above = onScreen - 12 - cardHeight;
    const top =
      below + cardHeight <= viewport.height - 16
        ? below
        : above >= 16
          ? above
          : viewport.height - cardHeight - 16;
    const left = Math.min(
      Math.max(16, box.left - viewport.scrollX),
      viewport.width - cardWidth - 16
    );
    placement = { top, left, width: cardWidth };
  }

  return createPortal(
    <>
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-50 rounded-md ring-2 ring-brand motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out"
          style={{
            ...box,
            boxShadow: '0 0 0 9999px rgb(10 37 64 / 0.55)'
          }}
        />
      ) : null}
      <div className="fixed inset-0 z-50">
        {/* Catches clicks on the page behind, which is not part of the tour,
            without taking focus off the card. */}
        <div
          aria-hidden
          onMouseDown={(e) => e.preventDefault()}
          className={`absolute inset-0 ${box ? '' : 'bg-navy/55'}`}
        />
        <div
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-step-title"
          aria-describedby="tour-step-body"
          key={step.id}
          className="fixed space-y-3 rounded-md border border-line bg-surface p-5 text-ink shadow-xl motion-safe:animate-[tour-in_200ms_ease-out]"
          style={placement}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-ink-soft">
              {step.stage ? (
                <span className="mr-2 rounded border border-line px-1.5 py-0.5 uppercase tracking-wider">
                  {step.stage}
                </span>
              ) : null}
              Step {index + 1} of {steps.length}
            </p>
            {step.target === null ? (
              <span className="tour-draw text-navy">
                <Mark className="h-8 w-8" />
              </span>
            ) : null}
          </div>
          <div aria-live="polite">
            <h2
              id="tour-step-title"
              className="text-base font-semibold"
            >
              {step.title}
            </h2>
            <p
              id="tour-step-body"
              className="mt-1 text-sm text-ink-soft"
            >
              {step.body}
            </p>
          </div>
          <ol
            aria-hidden
            className="flex gap-1"
          >
            {steps.map((s, i) => (
              <li
                key={s.id}
                className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-brand' : 'bg-line'}`}
              />
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onClose('dismissed')}
              className={quiet}
            >
              Skip the tour
            </button>
            <div className="flex gap-2">
              {index > 0 ? (
                <button
                  type="button"
                  onClick={back}
                  className={secondary}
                >
                  Back
                </button>
              ) : null}
              <button
                ref={next}
                type="button"
                onClick={forward}
                className={primary}
              >
                {last ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    host
  );
}
