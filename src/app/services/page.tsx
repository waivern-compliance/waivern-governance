import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CheckList } from '@/components/site/CheckList';
import { PageTag } from '@/components/site/PageTag';
import { headerAction, PublicHeader } from '@/components/site/PublicHeader';
import { HOSTED, waivernHosted } from '@/lib/hosting';
import {
  PRODUCT_NAME,
  VENDOR_BOOKING_URL,
  VENDOR_CONTACT_URL
} from '@/lib/product';

export const metadata: Metadata = {
  title: 'Services from Waivern',
  description: `${PRODUCT_NAME} is free. What Waivern charges for: support, training, customisation, dedicated hosting and compliance advice.`
};

// Whether this is Waivern's hosted service is read when the page is served,
// not when it is built, so one image can be deployed either way.
export const dynamic = 'force-dynamic';

/**
 * What Waivern charges for, around a tool that is free to use.
 *
 * Waivern's offer, not the code's: a copy of the open-source code running on
 * someone else's servers has no such page.
 */

const SERVICES = [
  {
    id: 'support',
    title: 'Support at scale',
    lead: 'For organisations that rely on the tool every day.',
    points: [
      'Agreed response times and a named contact',
      'Help bringing in many users, entities and existing records',
      'Help connecting the tool to the systems you already run'
    ]
  },
  {
    id: 'training',
    title: 'User training',
    lead: 'So everyone who uses it, uses it well.',
    points: [
      'Sessions for privacy teams, approvers and record owners',
      'Built around your own records, forms and approval routes',
      'Remote or on site, live or recorded for new starters'
    ]
  },
  {
    id: 'customisation',
    title: 'Software customisation',
    lead: 'The tool, shaped around how you work.',
    points: [
      'Your own templates, forms, workflows and reports',
      'Integrations with your HR, IT, procurement or ticketing systems',
      'Where a change would help everyone, we can build it into the open-source code, so you are not left maintaining a private copy'
    ]
  },
  {
    id: 'hosting',
    title: 'Single-tenant hosting',
    lead: 'Your own instance, kept apart from everyone else.',
    points: [
      'A dedicated application and database for your organisation alone',
      'Hosted where you need it, with backups, updates and access agreed with you',
      'Easier to fit to your security reviews and procurement requirements'
    ]
  },
  {
    id: 'advisory',
    title: 'Compliance advisory',
    lead: 'Practitioners beside you, not just software.',
    points: [
      'Data protection, ePrivacy and AI governance advice from people who do the work',
      'DPIAs, AI risk assessments, records of processing and policies, prepared or reviewed',
      'Readiness for ISO 27001, and help when a breach or a regulator writes'
    ]
  }
] as const;

const FREE = [
  'Every feature of the tool, for every organisation',
  `Our hosted service, backed up ${HOSTED.backups}`,
  'The help pages and guidance built into the tool',
  'Exporting everything you keep, any time',
  'The source code, to read, check or run yourself'
] as const;

const cta =
  'inline-flex items-center justify-center gap-3 rounded-lg px-8 py-4 text-lg font-semibold shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2';

/** The two ways to start a conversation with us, as the page's calls to action. */
function ContactButtons({ tone }: { tone: 'light' | 'dark' }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <a
          href={VENDOR_BOOKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${cta} ${
            tone === 'dark'
              ? 'bg-white text-navy hover:bg-white/90 focus-visible:outline-white'
              : 'bg-brand text-white shadow-sm hover:opacity-90 focus-visible:outline-brand'
          }`}
        >
          Book a call <span aria-hidden>→</span>
        </a>
        <a
          href={VENDOR_CONTACT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${cta} border ${
            tone === 'dark'
              ? 'border-white/40 text-white hover:bg-white/10 focus-visible:outline-white'
              : 'border-brand/30 bg-surface text-brand hover:border-brand focus-visible:outline-brand'
          }`}
        >
          Talk to us <span aria-hidden>→</span>
        </a>
      </div>
      <p
        className={`text-sm ${tone === 'dark' ? 'text-white/70' : 'text-ink-soft'}`}
      >
        No obligation. Pick a time that suits you, or send us a message and we
        will come back to you.
      </p>
    </div>
  );
}

export default function Services() {
  if (!waivernHosted()) notFound();

  return (
    <div>
      <PublicHeader
        action={
          <Link
            href="/sign-in#sign-in"
            className={headerAction}
          >
            Get started<span className="hidden sm:inline"> free</span>
          </Link>
        }
      />

      <main className="mx-auto max-w-6xl space-y-16 px-4 py-10 sm:px-6 lg:py-16">
        <section className="max-w-3xl space-y-6">
          <PageTag>Services from Waivern</PageTag>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-navy sm:text-5xl">
            The software is free. The expertise is here when you need it.
          </h1>
          <p className="text-lg text-ink-soft">
            We built {PRODUCT_NAME} so that every organisation can run its
            compliance properly, whatever its budget. We pay for that by helping
            the organisations that want more: support at scale, training, a tool
            shaped around them, an instance of their own, or compliance experts
            working alongside their team.
          </p>
          <ContactButtons tone="light" />
        </section>

        <section
          aria-labelledby="what-we-charge-for"
          className="space-y-6"
        >
          <h2
            id="what-we-charge-for"
            className="text-2xl font-semibold tracking-tight"
          >
            What we charge for
          </h2>
          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => (
              <li
                key={s.id}
                id={s.id}
                className="scroll-mt-6 space-y-3 rounded-lg border border-line bg-surface p-6"
              >
                <h3 className="text-lg font-semibold text-navy">{s.title}</h3>
                <p className="text-sm font-medium">{s.lead}</p>
                <CheckList
                  items={s.points}
                  className="space-y-2 text-sm text-ink-soft"
                />
              </li>
            ))}
            <li className="flex flex-col justify-between gap-4 rounded-lg border border-dashed border-brand/40 bg-brand/5 p-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-navy">
                  Something else?
                </h3>
                <p className="text-sm text-ink-soft">
                  If you need help that is not listed here, ask. We would rather
                  hear what you need than make you fit a package.
                </p>
              </div>
              <a
                href={VENDOR_CONTACT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-brand underline underline-offset-4 hover:no-underline"
              >
                Talk to us <span aria-hidden>↗</span>
              </a>
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="always-free"
          className="grid gap-8 rounded-lg border border-line bg-surface p-6 sm:p-8 md:grid-cols-[1fr_1.2fr]"
        >
          <div className="space-y-3">
            <h2
              id="always-free"
              className="text-2xl font-semibold tracking-tight"
            >
              What stays free
            </h2>
            <p className="text-ink-soft">
              Nothing in the tool is kept back for paying customers. What we
              charge for is our time and our infrastructure, so you can start
              today and only talk to us when you want more.
            </p>
            <Link
              href="/sign-in#sign-in"
              className="inline-block text-sm font-semibold text-brand underline underline-offset-4 hover:no-underline"
            >
              Get started free <span aria-hidden>→</span>
            </Link>
          </div>
          <CheckList
            items={FREE}
            className="space-y-2 self-center text-sm"
          />
        </section>

        <section
          aria-labelledby="talk"
          className="space-y-4 rounded-lg bg-navy p-6 text-white sm:p-10"
        >
          <h2
            id="talk"
            className="text-2xl font-semibold tracking-tight"
          >
            Want to know more?
          </h2>
          <p className="max-w-2xl text-white/80">
            Tell us about your organisation and what you need. We will tell you
            honestly whether we can help, and how.
          </p>
          <ContactButtons tone="dark" />
        </section>
      </main>
    </div>
  );
}
