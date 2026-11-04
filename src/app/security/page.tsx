import type { Metadata } from "next";
import Link from "next/link";
import { HomeLink } from "@/components/HomeLink";
import { SESSION_HOURS } from "@/auth";
import { Mark } from "@/components/Wordmark";
import { MAX_BYTES } from "@/lib/documents/limits";
import { scanningEnabled } from "@/lib/documents/scan";
import { HOSTED, waivernHosted } from "@/lib/hosting";
import { MAX_CLOCK_SKEW_SECONDS } from "@/lib/integration/crypto";
import { PRODUCT_NAME, PRODUCT_SUFFIX, PRODUCT_VENDOR } from "@/lib/product";
import { RETAIN_DAYS } from "@/services/assistant";
import { DEFAULT_TTL_DAYS } from "@/services/contributor-links";
import { PER_ADDRESS_PER_HOUR, PER_FORM_PER_HOUR } from "@/services/dsr-intake";

export const metadata: Metadata = {
  title: "Security and backups",
  description: `How ${PRODUCT_NAME} protects the records kept in it, and how they are backed up.`,
};

// Whether this is Waivern's hosted service is read when the page is served,
// not when it is built, so one image can be deployed either way.
export const dynamic = "force-dynamic";

type Section = { id: string; heading: string; body: string[]; points?: string[] };

/**
 * What the code does, wherever it runs. Every figure here is read from the
 * constant that enforces it, so the page cannot promise a limit the code has
 * since changed.
 */
function builtIn(scanning: boolean): Section[] {
  return [
    {
      id: "signing-in",
      heading: "Signing in",
      body: [
        "There are no passwords to steal or reuse. People sign in with their Google account, so two-step verification and password rules are Google's and, for a Google Workspace account, the ones your IT team already sets.",
      ],
      points: [
        "Signing in with a valid account is not enough on its own: the address must belong to someone invited to an organisation, or to an email domain the organisation has verified. Public domains such as gmail.com cannot be claimed.",
        "Google accounts whose email address Google has not verified are refused.",
        `A sign-in lasts ${SESSION_HOURS} hours, then the identity provider is asked again.`,
        "What a person may do is looked up afresh on every request, so removing somebody's access takes effect on their next click, not when their session ends.",
        "The no-password sign-in used for local development refuses to start in production.",
      ],
    },
    {
      id: "access",
      heading: "Who can see and do what",
      body: [
        "Access is given by role, and a role can cover the whole organisation or a single legal entity within it. Someone working for one company in a group sees that company's records and no other's.",
      ],
      points: [
        "Only approvers and owners can decide approvals or accept a risk.",
        "Every change is checked against the person's role on the server, whatever the screen in front of them shows.",
        "Organisations cannot remove their last owner, so an organisation is never left with nobody able to manage it.",
      ],
    },
    {
      id: "separation",
      heading: "Keeping organisations apart",
      body: [
        "Many organisations share the hosted service, so keeping their records apart is not left to the application remembering to filter. The database does it.",
      ],
      points: [
        "Every table holding an organisation's records has PostgreSQL row-level security. Work for an organisation runs as a restricted database role that can only reach that organisation's rows, so a query that forgot its filter still sees nothing else.",
        "An automated test attacks one organisation from another, reading, changing, linking and listing records, and fails if any function that touches an organisation's records is left out of it. It runs on every change before the change can be released.",
      ],
    },
    {
      id: "audit",
      heading: "A record that cannot be quietly changed",
      body: [
        "Every change is written to an audit trail in the same database transaction as the change itself, so there is no change without its record and no record of a change that did not happen.",
      ],
      points: [
        "The trail is append-only. The database refuses any attempt to edit or delete an entry; a mistake is put right by recording a correction, not by rewriting history. Assessment revisions, risk acceptances, incidents and training records are protected the same way.",
        "Entries are chained: each carries a SHA-256 hash of its contents and of the entry before it, so altering one entry breaks every entry after it.",
        "The exported trail carries instructions a recipient, such as an auditor or the ICO, can follow to check the chain for themselves.",
        "Exports and file downloads are themselves recorded.",
      ],
    },
    {
      id: "secrets",
      heading: "Keys and secrets",
      body: [
        "The credentials the tool holds for other systems are encrypted in the database with AES-256-GCM, using a key that is kept outside it. A copy of the database alone yields no working credentials.",
      ],
      points: [
        "This covers the keys for an organisation's chosen AI model, the secrets used to sign traffic with other tools, and Cookie Consent Analyser tokens.",
        `Links that let somebody without an account contribute to an assessment are stored only as a hash, open one assessment, and expire after ${DEFAULT_TTL_DAYS} days unless set otherwise. They can be withdrawn at any time.`,
      ],
    },
    {
      id: "files",
      heading: "Uploaded files",
      body: [
        `Signed agreements and other supporting files can be attached to records, up to ${MAX_BYTES / (1024 * 1024)} MB each.`,
      ],
      points: [
        "Only PDF, Word (.docx), Excel (.xlsx), plain text, CSV, PNG and JPEG are accepted. Nothing a browser would run, including HTML and SVG, is accepted, and nor are the pre-2007 Word and Excel formats (.doc and .xls), whose files are a common way of carrying macro viruses.",
        "Each file's fingerprint is recorded when it is uploaded and checked whenever it is downloaded; a file that has changed is refused.",
        "Files are always handed back as downloads, never opened in the page, and only to people allowed to read the record.",
        "A file's contents are checked against the type it claims to be, so a program renamed to look like a PDF is refused.",
        // Only what this deployment actually does: scanning is on only where
        // its operator runs a scanner, and the page must not claim it otherwise.
        ...(scanning
          ? [
              "Files are checked for viruses before they are stored, by a ClamAV scanner run by the operator of this service rather than sent to an outside scanning service. An infected file is refused, and the attempt is recorded against the record.",
              "Files stored before scanning was switched on are checked in the background. One found to be infected is held, cannot be downloaded, and is raised to the organisation's privacy administrators.",
            ]
          : ["Files are not scanned for viruses. Open them with the care you would give any attachment."]),
      ],
    },
    {
      id: "public-forms",
      heading: "Forms open to the public",
      body: [
        "An organisation can publish a form for people to make a data protection request. It is the one part of the tool open to anyone, so it carries its own protections.",
      ],
      points: [
        "Its address is random and can be withdrawn and replaced.",
        `Submissions are limited to ${PER_ADDRESS_PER_HOUR} an hour from one internet address and ${PER_FORM_PER_HOUR} an hour to one form, and forms filled in faster than a person could are refused.`,
        "Internet addresses are kept only in a scrambled form, for a day, to apply those limits.",
      ],
    },
    {
      id: "integrations",
      heading: "Connecting other tools",
      body: [
        "Other systems send records in and take approved facts out through a versioned API. Every request is signed with a secret unique to the connection.",
      ],
      points: [
        `A request whose signature is wrong, or more than ${MAX_CLOCK_SKEW_SECONDS / 60} minutes old, is refused.`,
        "Each connection can reach only the parts of the API its kind needs, and a batch is limited in size.",
      ],
    },
    {
      id: "assistant",
      heading: "The AI assistant",
      body: [
        "The assistant is off until an organisation's administrator turns it on, and then it uses the AI provider, model and account the organisation chooses. Waivern supplies no model and no fallback, so nothing is sent to an AI provider your organisation has not picked.",
      ],
      points: [
        "Email addresses, National Insurance numbers, card numbers, phone numbers and similar are removed from what people type before it is sent. This catches common patterns; it is not a guarantee, so do not paste personal data into it.",
        `Conversations are deleted after ${RETAIN_DAYS} days.`,
        "It drafts and explains. It cannot change a record or make a decision; a named person always does.",
      ],
    },
    {
      id: "code",
      heading: "Open, tested code",
      body: [
        `${PRODUCT_VENDOR} ${PRODUCT_SUFFIX} is open source under the AGPL-3.0 licence, so anyone can read exactly how it handles your records rather than taking our word for it.`,
      ],
      points: [
        "Every change is type-checked, linted, and run against the full automated test suite on a real PostgreSQL database, including the tests that keep organisations apart, before it can be merged.",
        "Logs record the shape of what happened, such as sizes, durations and counts, not the content of your records.",
        "Every page carries a Content-Security-Policy that lets only scripts the tool issued for that page run, and no other site may show the tool inside a frame. Browsers are also told not to guess at file types, to pass other sites only the tool's address rather than the page someone came from, that the camera, microphone and location are never used, and, in production, to reach the tool only over HTTPS.",
      ],
    },
  ];
}

const linkClass = "text-brand underline underline-offset-2 hover:opacity-80";

/**
 * Security and backups, for anyone deciding whether to trust the tool with
 * their records — so it is open without signing in.
 */
export default function Security() {
  const hosted = waivernHosted();
  const BUILT_IN = builtIn(scanningEnabled());
  const contents = [
    ...(hosted ? [{ id: "hosting", heading: "Hosting and backups" }] : []),
    ...BUILT_IN,
    ...(hosted ? [{ id: "dedicated", heading: "A dedicated instance of your own" }] : []),
    { id: "reporting", heading: "Reporting a security problem" },
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-4">
        <HomeLink href="/" tone="light" />
        <Link href="/" title="Home" className="flex w-fit items-center gap-3 text-ink hover:text-brand">
          <Mark className="h-9 w-9 text-navy" />
          <span className="text-lg font-semibold tracking-tight">
            {PRODUCT_VENDOR} <span className="font-normal text-ink-soft">{PRODUCT_SUFFIX}</span>
          </span>
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Security and backups</h1>
        <p className="text-ink-soft">
          {hosted
            ? `What protects the records you keep in ${PRODUCT_VENDOR} ${PRODUCT_SUFFIX}, how they are backed up on our free hosted service, and what changes if you ask us to run an instance for you alone.`
            : `What protects the records you keep in ${PRODUCT_VENDOR} ${PRODUCT_SUFFIX}. These protections are built into the software. How this copy is hosted and backed up is decided by the organisation that runs it; ask them.`}
        </p>
        <nav aria-label="On this page" className="rounded border border-line bg-surface p-4 text-sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-soft">On this page</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {contents.map((c) => (
              <li key={c.id}>
                <a href={`#${c.id}`} className={linkClass}>
                  {c.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {hosted ? <Hosting /> : null}

      {BUILT_IN.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="scroll-mt-6 space-y-3">
          <h2 id={`${s.id}-heading`} className="text-xl font-semibold tracking-tight">
            {s.heading}
          </h2>
          {s.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {s.points ? (
            <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-soft">
              {s.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      {hosted ? <Dedicated /> : null}

      <section id="reporting" aria-labelledby="reporting-heading" className="scroll-mt-6 space-y-3">
        <h2 id="reporting-heading" className="text-xl font-semibold tracking-tight">
          Reporting a security problem
        </h2>
        {hosted ? (
          <p>
            If you think you have found a weakness, please email{" "}
            <a href={`mailto:${HOSTED.contact}`} className={linkClass}>
              {HOSTED.contact}
            </a>{" "}
            rather than raising it in public, so we can fix it before it can be used. Tell us what you found and
            how to see it; we will reply and keep you told what we are doing about it.
          </p>
        ) : (
          <p>
            Tell the organisation that runs this copy. If the weakness is in the software itself, the maintainers
            can be reached through the project&rsquo;s repository.
          </p>
        )}
      </section>

      <footer className="border-t border-line pt-6 text-sm text-ink-soft">
        <Link href="/sign-in" className={linkClass}>
          Sign in
        </Link>
      </footer>
    </main>
  );
}

function Hosting() {
  return (
    <section id="hosting" aria-labelledby="hosting-heading" className="scroll-mt-6 space-y-3">
      <h2 id="hosting-heading" className="text-xl font-semibold tracking-tight">
        Hosting and backups
      </h2>
      <p>
        The free service is run by Waivern on {HOSTED.provider}, in its {HOSTED.region} region. The application
        and its PostgreSQL database are shared by the organisations that use it, kept apart as described below.
      </p>
      <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-soft">
        <li>
          The database is backed up {HOSTED.backups}, on a schedule run by {HOSTED.provider}, so after a failure
          it can be brought back to the most recent backup.
        </li>
        <li>
          Because the database is shared, a restore brings back every organisation&rsquo;s records together. It
          is there to recover from a failure, not to undo one organisation&rsquo;s change; the audit trail and
          version history are how a change is understood and put right.
        </li>
        <li>
          The application reaches its database over the hosting provider&rsquo;s private network, and you reach
          the application over HTTPS.
        </li>
        <li>
          The records are held in the EU, not the UK. That is lawful - the EU holds UK adequacy, so the
          transfer needs no further safeguard - but if your organisation needs its records kept in the UK,
          a dedicated instance can be.
        </li>
        <li>
          The tool is built to hold decisions about processing rather than the personal data being processed.
          Some registers, such as data protection requests, complaints and breaches, do hold details of the
          people involved; they are protected in the same way as everything else.
        </li>
      </ul>
    </section>
  );
}

const DEDICATED: Array<[string, string]> = [
  [
    "Your own servers and database",
    "Your organisation's records alone, on an application and database that no other organisation uses.",
  ],
  [
    "Where it is held",
    "A region you choose, including the UK, for organisations that need their records to stay there.",
  ],
  [
    "Backups to your requirements",
    "How often the database is backed up and how long backups are kept, agreed with you, with restores that bring back your records alone.",
  ],
  [
    "Your sign-in only",
    "Sign-in limited to your own Google Workspace, so nobody outside it can even ask for access, and an address of your own if you want one.",
  ],
  [
    "Your own keys",
    "An encryption key for stored credentials that belongs to your instance alone.",
  ],
  [
    "Updates when you are ready",
    "New versions applied on a timetable agreed with you, rather than as they are released.",
  ],
  [
    "Email alerts for your people",
    "Alert and action emails to the people who ask for them: new work, overdue work, mentions and decisions. They are not offered on the shared service.",
  ],
  [
    "Help when you need it",
    "Technical support, training for your staff, and changes to fit how your organisation works, if you want them.",
  ],
];

function Dedicated() {
  return (
    <section id="dedicated" aria-labelledby="dedicated-heading" className="scroll-mt-6 space-y-4">
      <h2 id="dedicated-heading" className="text-xl font-semibold tracking-tight">
        A dedicated instance of your own
      </h2>
      <p>
        Everything above comes free with the shared service, and nothing in the software is held back for paying
        customers. If your organisation needs more control over where and how its records are kept, we can set
        up and run a separate instance for you alone. It is the same software; what changes is how it is
        hosted, and that is agreed with you.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        {DEDICATED.map(([term, detail]) => (
          <div key={term} className="space-y-1 rounded border border-line bg-surface p-4">
            <dt className="font-semibold">{term}</dt>
            <dd className="text-sm text-ink-soft">{detail}</dd>
          </div>
        ))}
      </dl>
      <p>
        The arrangements are set out in writing before anything is moved. To talk about it, email{" "}
        <a href={`mailto:${HOSTED.contact}`} className={linkClass}>
          {HOSTED.contact}
        </a>
        .
      </p>
    </section>
  );
}
