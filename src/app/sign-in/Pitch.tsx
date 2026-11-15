import Link from 'next/link';

import { CheckList } from '@/components/site/CheckList';
import { PageTag } from '@/components/site/PageTag';
import { EXPANSION_SURVEY_URL, SOURCE_CODE_URL } from '@/lib/product';
import { TRIAL_LENGTH } from '@/lib/trial-rules';

/**
 * Why somebody might want to sign in: the case for the hosted service.
 *
 * Shown only on Waivern's hosted service (`lib/hosting.ts`). "Free", "built by
 * us" and "starting in the UK and Ireland" are Waivern's promises, not the
 * code's, so a copy running on someone else's servers shows none of it.
 *
 * Where trials are open (`lib/trial.ts`) it also offers the demo company: a
 * sandbox to look around before signing up, not a time limit on the service.
 */

const REASONS = [
  {
    title: 'Free to use',
    body: 'No licence fee, no per-seat pricing, and your organisation never runs out of time. Good compliance should not depend on the size of your budget.'
  },
  {
    title: 'Open source, so you stay in control',
    body: 'The code is public under the AGPL. Read it, check it, export everything you keep in it, or run it on your own servers. Your compliance records stay yours, wherever you choose to keep them.'
  },
  {
    title: 'Built by people who do the work',
    body: 'Made by data protection, AI governance and information security professionals who have run these programmes themselves, so the forms follow the law and the workflow follows how the job is really done.'
  }
] as const;

const COVERS = [
  'Records of processing activities',
  'DPIAs and other assessments, with review and approval',
  'Data subject requests, with a public request form',
  'Personal data breaches and their deadlines',
  'Cookies and electronic marketing (PECR and the Irish ePrivacy Regulations)',
  'Third parties, sharing agreements and international transfers',
  'AI systems, risks and automated decisions',
  'Freedom of information requests and complaints',
  'Policies, evidence, training and a full audit trail'
] as const;

const secondaryCta =
  'inline-flex items-center gap-2 rounded-lg border-2 border-brand px-6 py-3.5 text-base font-semibold text-brand transition hover:bg-brand/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

const primaryCta =
  'inline-flex items-center gap-3 rounded-lg bg-brand px-8 py-4 text-lg font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:opacity-95 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function Hero({
  providers,
  open,
  trials
}: {
  providers: string[];
  /** Whether newcomers can ask for an organisation (`lib/platform.ts`). */
  open: boolean;
  /** Whether anybody may start a trial with the demo company (`lib/trial.ts`). */
  trials: boolean;
}) {
  return (
    <section className="space-y-6">
      <PageTag>Free and open source</PageTag>
      <h2 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-navy sm:text-5xl">
        Tech compliance, made easy.
      </h2>
      <p className="max-w-2xl text-lg text-ink-soft">
        Run your privacy, ePrivacy and AI governance in one place: the records,
        the assessments, the deadlines and the evidence a regulator will ask
        for. Free for every organisation, built by compliance professionals who
        think good tools should not depend on the size of your budget.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <a
          href="#sign-in"
          className={primaryCta}
        >
          Get started free <span aria-hidden>→</span>
        </a>
        {trials ? (
          <Link
            href="/trial"
            className={secondaryCta}
          >
            Explore a demo company
          </Link>
        ) : null}
      </div>
      <p className="text-sm text-ink-soft">
        No card needed.
        {providers.length > 0 ? ` Sign in with ${providers.join(' or ')}.` : ''}
        {open ? ' Then ask for your organisation, and we will set it up.' : ''}
        {trials
          ? ` Or look around a fictional company for ${TRIAL_LENGTH} first, with just an email address.`
          : ''}
      </p>
    </section>
  );
}

export function Pitch({ trials }: { trials: boolean }) {
  return (
    <div className="space-y-14">
      {trials ? <DemoCompany /> : null}

      <section
        aria-labelledby="why"
        className="space-y-5"
      >
        <h2
          id="why"
          className="text-xl font-semibold tracking-tight"
        >
          Why we built it
        </h2>
        <ul className="grid gap-4 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {REASONS.map((r) => (
            <li
              key={r.title}
              className="space-y-2 rounded-lg border border-line bg-surface p-5"
            >
              <h3 className="font-semibold text-navy">{r.title}</h3>
              <p className="text-sm text-ink-soft">{r.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="how-free"
        className="flex flex-col gap-5 rounded-lg border border-brand/20 bg-brand/5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
      >
        <div className="max-w-xl space-y-2">
          <h2
            id="how-free"
            className="text-xl font-semibold tracking-tight text-navy"
          >
            How do we keep it free?
          </h2>
          <p className="text-ink-soft">
            Every feature is free, for everyone. We charge for the help around
            it: support at scale, user training, customisation, single-tenant
            hosting and compliance advice.
          </p>
        </div>
        <Link
          href="/services"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-navy px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          See our services <span aria-hidden>→</span>
        </Link>
      </section>

      <section
        aria-labelledby="covers"
        className="space-y-5"
      >
        <h2
          id="covers"
          className="text-xl font-semibold tracking-tight"
        >
          What it covers
        </h2>
        <CheckList
          items={COVERS}
          className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2"
        />
      </section>

      <section
        aria-labelledby="where"
        className="space-y-4 rounded-lg bg-navy p-6 text-white sm:p-8"
      >
        <h2
          id="where"
          className="text-xl font-semibold tracking-tight"
        >
          Starting with the UK and Ireland
        </h2>
        <p className="max-w-2xl text-white/80">
          Every form is written for UK GDPR, the Data Protection Act 2018 and
          PECR, with the EU GDPR and the Irish ePrivacy Regulations for
          organisations that need them. We would rather cover two places
          properly than many places loosely.
        </p>
        <p className="max-w-2xl text-white/80">
          Where should we go next? You decide. Tell us which countries and laws
          you need, and we will build them in the order you ask for them.
        </p>
        <a
          href={EXPANSION_SURVEY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded bg-white px-4 py-2.5 text-sm font-semibold text-navy hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Tell us where to go next <span aria-hidden>↗</span>
        </a>
      </section>

      <section
        aria-labelledby="open"
        className="space-y-3"
      >
        <h2
          id="open"
          className="text-xl font-semibold tracking-tight"
        >
          Sovereign compliance, in the open
        </h2>
        <p className="max-w-2xl text-ink-soft">
          Compliance tools hold some of the most sensitive records an
          organisation keeps. You should not have to trust a black box with
          them, or be locked into one. Use our hosted service, or take the code
          and run it yourself: the choice, and the data, stay with you.
        </p>
        <a
          href={SOURCE_CODE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-brand underline underline-offset-2"
        >
          See the source code on GitHub
        </a>
      </section>

      <section
        aria-labelledby="ready"
        className="space-y-4 rounded-lg border border-line bg-surface p-6 text-center sm:p-8"
      >
        <h2
          id="ready"
          className="text-2xl font-semibold tracking-tight text-navy"
        >
          Ready to make compliance easier?
        </h2>
        <p className="mx-auto max-w-xl text-ink-soft">
          Sign in with your work account to get started. It is free, and you can
          export everything you keep, whenever you like.
        </p>
        <a
          href="#sign-in"
          className={primaryCta}
        >
          Get started free <span aria-hidden>→</span>
        </a>
        {trials ? (
          <p className="text-sm text-ink-soft">
            Not ready yet?{' '}
            <Link
              href="/trial"
              className="font-medium text-brand underline underline-offset-2"
            >
              Explore the demo company for {TRIAL_LENGTH}
            </Link>
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}

const DEMO_INCLUDES = [
  'Processing activities, already recorded',
  'A personal data breach with its 72-hour clock running',
  'An AI system with its risks',
  'Suppliers with gaps in their agreements',
  'A subject access request and a complaint',
  'Simulated colleagues, so you can take a DPIA from draft to sign-off'
] as const;

/**
 * The trial, offered as what it is: a made-up company to look around, for
 * fictional data only, alongside the free organisation that never ends.
 */
function DemoCompany() {
  return (
    <section
      aria-labelledby="demo"
      className="space-y-5 rounded-lg border border-brand/20 bg-brand/5 p-6 sm:p-8"
    >
      <div className="max-w-2xl space-y-2">
        <h2
          id="demo"
          className="text-xl font-semibold tracking-tight text-navy"
        >
          See it working before you sign up
        </h2>
        <p className="text-ink-soft">
          Give an email address and, within a minute, you are inside a fictional
          retailer with its compliance already under way. Look around for{' '}
          {TRIAL_LENGTH}, with no work account and no card.
        </p>
      </div>
      <CheckList
        items={DEMO_INCLUDES}
        className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2"
      />
      <p className="max-w-2xl text-sm text-ink-soft">
        The demo is for fictional data only, so enter nothing real. It reaches
        nobody outside it and uploads nothing, and sample documents are there to
        attach. When you are ready, sign in with your work account for an
        organisation of your own, free and with no end date.
      </p>
      <Link
        href="/trial"
        className="inline-flex items-center gap-2 rounded-md bg-navy px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        Explore the demo company <span aria-hidden>→</span>
      </Link>
    </section>
  );
}
