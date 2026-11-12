# Architecture

Why the platform is built the way it is. The [README](../README.md) says what it
is for and how to run it; [design.html](design.html) has the full design.

## Design principles

**Everything time-based runs off the request path.** Materialising
recurring schedules, raising reviews for lapsed risk acceptances, chasing overdue
mitigations, recording service-level breaches and delivering outbound webhooks
all outlive a request, so none of them happen inside one. A route handler writes
state and stops; a scheduled job does the rest, on its own schedule, against the
database directly. That job is idempotent — running it twice, or retrying after
a partial failure, converges on the same state — which is most of what
durability buys and needs no queue to achieve.

Two ways to run it: `pnpm sweep` as a job (what the deployment uses), or
`/api/cron/sweep` behind a bearer token for a scheduler that can only make an
HTTP request. Nothing in the sweep makes a governance decision; it raises tasks
and a human decides.

**The application holds no opinion about where it runs.** No region is pinned in
code and no platform SDK is imported, so residency is settled by the deployment
rather than by the software. That is the right place for it — the requirement
differs by organisation, and a platform that decided it would be wrong for
somebody. What the software does insist on is that the decision be visible:
`/api/health` reports the database it is actually talking to, and the country
library records transfers as a fact rather than an assumption.

**One assessment engine, many types.** DPIA, UK TRA, EU TIA, AI risk assessment
and screening questionnaires are all published versions of a single template
object running through a single `assessment` record. This is what makes a shared
data model and consolidated reporting real rather than asserted, and it is why
adding breach management or policy attestation later is a new template kind
rather than a new subsystem.

**The audit chain is append-only and tamper-evident.** Each event carries the
hash of its predecessor, and the database refuses `UPDATE` and `DELETE` on the
table by trigger. Appends serialise behind a row lock on the chain head, so
concurrent writers cannot fork the chain or skip a sequence number.
`verifyAuditChain` recomputes the whole chain — the same routine an auditor runs
against an export, so a recipient does not have to take our word for it.
Each hash covers a SHA-256 digest of the event's contents (before, after,
metadata) rather than the contents, so `eraseAuditContents` can clear the
contents of events about records deleted for good while keeping the digest:
the event and the chain still verify. That erasure is the only update the
database allows, and it must name a declared `audit.contents_erased` event.
Chains begun before digests (scheme 1) keep their original hashes; one
declared `audit.scheme_changed` event commits to a digest of every older event.

**AI is advisory only.** Model output never writes to a decision field. It lands
in a suggestion record that a named human accepts or rejects, and the acceptance
is itself audited. Every suggestion biases toward escalation. Under UK GDPR
Article 35 the controller carries the assessment; a platform that lets a model
quietly set a residual risk score has moved accountability somewhere it cannot
legally sit.

**Contributors do not need accounts.** A contributor link grants access to one
assessment, optionally one section of it, and the scope is enforced at the write
rather than only reflected in what the page renders. The token is stored as a
SHA-256 hash and never in plain text. It is single-*purpose*, not
single-request: loading the page, saving and submitting are separate requests
and people come back to finish, so the link lives until it expires, is
completed, or is revoked — with every use counted and audited.

**Risk ratings are derived, never asserted.** Score is likelihood times impact
and tier is derived from score, enforced by database check constraints as well
as in code — a register where the rating and its inputs tell different stories
is worse than one with no rating at all.

**Accepting a risk is an act, not a status change.** It requires a residual
rating, a written rationale and an expiry date, it is refused to the person who
owns the risk, and it needs the approver role rather than an administrative one.
Acceptances are append-only: accepting again supersedes rather than edits, so
the register shows the succession of decisions. When one expires the risk stays
recorded as accepted and a prompt is raised — nothing overturns a person's
decision behind their back.

**Approvals are routed by what was answered, not by who started the work.** A
DPIA that scores low goes to one reviewer; the same DPIA touching special
category data, or sending data somewhere without adequacy, picks up the DPO.
Every stage of the workflow is recorded against the assessment — including the
ones whose condition did not hold, marked skipped with the reason, because a
gate that silently never appeared cannot be told apart from one somebody
removed.


**The dashboard counts honestly.** Numbers are derived from the records rather
than kept in a summary table, because a governance dashboard that can disagree
with the register it summarises is worse than none. A risk nobody has rated for
residual counts as *not within appetite* — an unmeasured risk is not a tolerable
one, and reporting it as fine is how a dashboard reassures an executive about
exposure nobody has looked at.

Chart colours are validated, not chosen by eye: the inherent/residual pair is
one hue in two steps (an ordinal ramp, all checks pass) and the service-level
trio uses the fixed status palette without "serious", because amber and orange
measure only 13.6 apart in normal vision and would be hard to separate side by
side. Risk tier is carried by the row label rather than by hue, and every status
mark ships a visible label and a count.

**Data goes both ways.** `GET /api/v1/export/context` returns the whole
governance picture as one versioned document — approved assessments with who
signed and why, the risk register with its acceptances, Article 30 records,
suppliers and DPAs, and an evidence index whose links resolve to references
rather than internal ids. `since` gives an incremental pull, `entity` narrows to
one legal entity. Only settled facts are exported: an assessment appears once it
is approved, because generating a compliance document from unfinished work would
put an unreviewed claim into something that reads as settled.

**Two systems push records in.** The Waivern Compliance Portal sends Article 30
records, suppliers, DPAs and evidence; the HAR Analyser sends scan runs. Both
authenticate with an HMAC signature over the raw body with the timestamp inside
the signed material, so a captured request cannot be replayed. Secrets are
encrypted at rest with a key held outside the database. Every record carries the
producing system's own identifier, so a nightly scan updates rather than piles
up. See [docs/integration-api.md](docs/integration-api.md).

**A scan finding never becomes a risk on its own.** The scanner's severity and
its suggestion are shown to a person and recorded for provenance; a named human
decides whether the finding belongs on the register and rates it themselves. The
audit trail keeps both, side by side, as separate facts. A scanner deciding what
constitutes a governance risk would be automation making the classification,
which is the one thing this platform must not do.

**An exported audit log can be verified by whoever receives it.** Tamper-evidence
only we can check is a claim, not evidence — so a complete export ships with a
manifest describing exactly how to recompute the chain from the columns in the
file, and a test reproduces that verification from the exported data alone. A
filtered extract says on its face that it cannot be verified, because the events
between the ones you kept are missing and the links will not join up. Exporting
is itself recorded: somebody took the register out of the building.

Free text in an export is neutralised before it reaches a spreadsheet. A risk
titled `=HYPERLINK(...)` is a working payload in whatever an auditor opens, and
governance exports are full of text somebody else typed.

**The country library treats staleness as a fact, not a hope.** Transfer
assessments read adequacy and transfer risk from it, so an entry nobody has
checked weakens every assessment citing it — quietly, because the assessment
still reads as evidenced. Every entry records who checked it and when, an
unchecked one says so on its face, and the scheduler turns a library falling out
of date into somebody's work.

Adequacy is not a boolean. The United States is adequate only for recipients
certified under the Data Privacy Framework or the UK Extension, and Canada only
for PIPEDA-regulated commercial activity; a yes/no field records both as "yes"
and excuses an assessment nobody did. Conditional adequacy therefore counts as
needing an Article 46 route, because the condition is about the recipient and
the platform cannot know it holds.

The shipped library arrives **explicitly unverified and due for review**. It is
a starting point for a privacy professional to confirm, not an authority, and
the two risk judgements are left open rather than filled with ratings nobody can
source.

**The AI register records what exists, not only what was assessed.** A register
that only holds assessed systems cannot answer the question an AI governance
lead actually has, which is what is running that nobody has looked at. So a
system can be added with no owner and no assessment — that is a reportable state,
not a validation error, and refusing to record it is how shadow AI stays
invisible. Gaps are computed rather than stored, because a gap is a fact about
the present: a system that moved into production yesterday is unmonitored today
whether or not anybody re-saved the record.

Risk facts — what consequence it has for people, what oversight is in place,
whether bias was assessed — live on the assessment and are read from it, never
copied into the register. A copy drifts from the judgement somebody signed.

**Four ways in, one set of permissions.** A membership carries a persona
alongside its roles: privacy governance, AI governance, engineering or product.
It decides what the home screen leads with and in whose words — a product
manager sees "With the privacy team" where a DPO sees "in review" — and it
decides nothing else. Roles answer what somebody may decide; personas answer how
they work, and the two are orthogonal: a privacy analyst and an AI lead hold
identical capabilities yet need different homes. Tests assert that no
authorisation path and no service ever reads a persona.

## Features in more depth

The five-phase spine is complete: tenancy and entity scoping, role-based
capabilities, OIDC sign-in, the tamper-evident audit chain, the template engine
with its shipped assessment library, the assessment runtime including no-account
contributor links, the risk register with mitigations and attested acceptance,
and the workflow layer — threshold-routed approvals, tasks, SLA breach recording
and recurring governance.

A first governance dashboard is in — attention tiles, risk posture before and
after treatment, the assessment pipeline, service levels and a per-entity table.

The integration surface is in, both directions: signed ingest for processing
activities, vendors, DPAs, evidence and scan runs; a findings queue where a
person converts an observation into a risk; signed export endpoints the Portal
can pull from incrementally; and outbound webhooks carrying approvals and risk
acceptances back to subscribers.

The Article 30 register is in, checked against what Article 30 actually
requires rather than against whether a form was filled in — unqualified
elements are reported as non-compliance, while retention and security measures,
which the Regulation qualifies with "where possible", are reported without
being called a breach.

The third-party register is in alongside it: processors, the agreement in
force, sub-processor disclosure and transfer mechanism, with expiry watched by
the sweep. It separates a third party a scanner noticed from one a person has
confirmed, because a tracker on a page is a processor whether or not anybody
procured it, and a register that cannot tell those apart cannot be triaged.

Discussion is attached to every record, with mentions that resolve against
organisation membership and refuse to guess between two people of the same
name. Being mentioned surfaces on the tasks page rather than only queueing a
notification, since nothing delivers those yet.

The AI assurance chain draws each system through to what was done about it —
assessment, the risks it raised, whether anything treated them. It is drawn
from foreign keys rather than the link table, which only ever holds what an
integration declared, and it reports where a chain stops: a system running
with nothing assessing it, an assessment that never finished, a severe risk
nobody treated, an acceptance that quietly expired. A gap counts as serious
only once the system is live — a proposal nobody has assessed is a queue.

Trend reporting closes the set. Posture is reconstructed month by month from
the timestamps already on each record — `opened_at` and `closed_at` answer
"was this open in March" exactly — rather than from a sampling job, so a
deployment has history from the day it started rather than from the day
somebody remembered to start sampling.

What it deliberately does not chart is a stock broken down by an attribute
that changes. Open risks by tier would apply today's severity to last spring
and call it history; flows are exact, and that would be a guess in the same
clothes. Rendered documents
are not planned here — a formatted DPIA is generated by the Waivern Compliance
Portal from the facts this platform publishes.

Templates can be read and authored in the interface: every question, its
conditional logic rendered in English rather than as JSON, the scoring bands and
the version history. A draft is edited as a validated definition and cannot be
published while the validator has anything to say about it.

The home page carries an optional step-by-step guide for people who are not
privacy professionals — a founder, an office manager, the engineer who drew the
short straw. It has two stages, setting up and keeping current, and each step
says what to do in ordinary words first, why the law cares second, and how you
know it is finished third. Progress is measured against the registers rather
than remembered from clicks, and the count it was judged on sits beside each
step so the judgement can be checked rather than trusted. Three steps are never
ticked — treating risks, breach readiness, taking an export — because those are
ongoing judgements, not tasks that finish. It explains and never decides:
whether a DPIA is required, and on what basis, remains a named person's call.

An in-product help system covers every screen and the reasoning behind it,
searchable, with a short contextual version folded into each page. Settings
carries the two administrative screens — who may sign in and as what, and the
optional assistant.

The assistant is off unless an organisation points the platform at a model it
controls and switches on a surface; there is no default endpoint. It drafts and
explains and never decides: it is given an assessment's questions rather than
its answers, help answers are retrieved from the shipped documentation rather
than recalled, identifiers are stripped from a question before it is sent and
the person is told what was removed, and conversations are deleted on a stated
schedule. `docs/ai-assistance.html` sets out where such a thing belongs and
where it must not go.

One surface goes further than drafting: with it switched on, a model can be
asked to read the agreements attached to a third party and report the transfer
mechanism and sub-processors they name. Text is pulled out of PDF, .docx, .xlsx
and plain files in-process — no conversion service, no additional dependency,
including the ToUnicode maps that subset fonts need — and a scan is refused by
name rather than answered thinly. Every finding carries the sentence it came
from and the file or page that sentence is in, hashed; findings citing a source
that was never sent are dropped rather than kept with unknown provenance.
Nothing reaches the register until a person accepts it, and rejected proposals
are retained, because a reviewer disagreeing is evidence of review.

Every exchange with a model writes two JSON lines to stdout — one for the
request, one for the response — carrying sizes, durations, stop reasons and
counts, and no content. The same shape is kept on the extraction run itself,
because the person looking at a failed reading is in the interface rather than
in a log aggregator, and by the time they ask the line has rotated away. That
is what makes "it didn't work" answerable: a request that was too large, an
answer that was cut off, and one that was never JSON need different fixes and
used to look identical. `ASSISTANT_DEBUG_BODIES=true` adds an excerpt of the
model's reply, off by default and documented as unfit for production, because a
reply quotes the document it read.

Agreements usually do not list sub-processors — they point at a page that does.
Those addresses are reported, not followed. Fetching one is a separate act
requiring a person, since the URL came out of a supplier's document rather than
from the customer: private address space is refused, so are redirects into it,
and what comes back is stored with its hash and retrieval time, because a
sub-processor list is a page that changes.

`pnpm seed:demo` loads a plausible portfolio — fourteen assessments at every
stage, nine risks treated to varying degrees, some work already late — because a
dashboard reviewed against a single record tells you nothing about whether it
works.
