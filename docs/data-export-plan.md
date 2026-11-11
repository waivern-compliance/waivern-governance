# Plan: export all of an organisation's data

Status: draft for decision. Written 11 November 2026. Nothing is built yet.

## Why

The terms (section 11.5) and the DPA (clause 5(h)) promise that a client can take its
data with it when it leaves, and that return is by the Controller exporting its data
with the Service's export functions. Today those functions cover the registers and a
few summaries, not the whole organisation:

- Twelve CSV datasets (`src/services/exports.ts`, `/app/exports`) and five integration
  API exports (`src/app/api/v1/export/`).
- Attached files only one at a time (`/api/documents/[id]`).
- No export of evidence, complaints, PECR scans and storage items, policies, sharing
  agreements, marketing activities, retention profiles, training records, tasks,
  comments, approvals, entities or members.
- The DSR CSV leaves out the requester's details and what was asked for or sent. That
  is right for a spreadsheet passed around day to day; on exit the controller is owed
  that personal data back.

The schema has 87 tables. 78 carry `organisation_id`; 9 hang off a parent that does
(answers, revisions, mitigations, approvals, workflow stages and similar) or are
platform-level. The aim is one export, run by an owner, that is **provably** complete:
a new table cannot be added without someone deciding whether it leaves with the client.

## What the owner gets

One download, `govern-export-<organisation-slug>-<yyyy-mm-dd>.zip`:

```
manifest.json            what is in the archive, how it was made, how to check it
README.txt               the same in plain words, plus how to verify the audit chain
data/<table>.jsonl       every row of every exported table, one JSON object per line
files/<document-id>/<filename>    each attached file, byte for byte as uploaded
files/imports/<batch-id>/<filename>   source files uploaded for imports
files/form-logos/<id>.<ext>       request form logos
csv/<dataset>.csv        the existing twelve spreadsheets, for people without a JSON reader
audit/audit-log.csv      the complete audit log, with its verification manifest
audit/manifest.txt       the hash-chain verification instructions on their own
```

- **JSON Lines** rather than one JSON array per table, so large tables stream in and out
  without being held in memory, and a reader can process them line by line. Each line
  is the row as the database holds it: column names as in `src/db/schema`, dates as
  ISO 8601, enums as their stored values. A bytea column is replaced by a reference to
  its file in `files/` and its SHA-256.
- **`manifest.json`** lists, per table, the row count and the SHA-256 of its `.jsonl`
  file; per file, its path, size and the SHA-256 recorded at upload; the schema version
  (last applied migration); when and by whom the export was made; and every table and
  column deliberately left out, with the reason (see the appendix). A reader can check
  the archive against its manifest without trusting us.
- **Files** are checked against the SHA-256 recorded at upload as they are written. A
  mismatch does not stop the export; it is listed in the manifest under `fileWarnings`,
  because silently handing back a different file from the one uploaded is worse than
  saying so.
- **The CSVs** are the existing exports run organisation-wide, so the spreadsheet a
  client already knows comes with it. They are a convenience; the JSON is the record.

## Who may run it

**An owner with an organisation-wide grant, and nobody else.** The same test as
`mayManageEntities` in `src/lib/rbac.ts`, as a new `mayExportOrganisation(grants)`. Not
a privacy administrator, and not an owner confined to one entity: the archive holds
every entity's records, DSR requesters' personal data, breach details and complaints,
which no other role sees all of.

Two further guards, for decision:

1. **Tell the other owners.** When an export is made, email every other organisation
   owner (who, when, row and file counts). Taking everything out of the building is
   the act a second owner most wants to know about. *Recommended.*
2. **Confirm before starting.** The page asks the owner to type the organisation's name
   before the download starts, as for other irreversible or wide-reaching actions.
   *Recommended*; cheap and it stops a stray click.

### When access has already ended

Section 11.5 allows an export window after access ends, and an owner may have lost
access (their account removed, or the organisation suspended). For that case Waivern
runs the same export from the command line: `pnpm export:organisation <slug> <file>`,
which writes the same archive and the same audit event with `actorKind: 'system'` and
the operator recorded in the metadata. Same code path, so the two cannot drift.

## Every export is audited

- `organisation.export_started`, written **before** the first byte is sent, in its own
  transaction: who, from where, what was requested. If the stream fails half way, the
  attempt is still on record.
- `organisation.exported`, written when the archive has been fully written: row counts
  per table, file count, total bytes, the SHA-256 of `manifest.json`, and any file
  warnings. The client can later prove which archive it was given by its manifest hash.
- The audit log inside the archive is read after `export_started` is written, so the
  export records itself. The completion event is necessarily not in the archive.
- The existing `data.exported` event for single CSVs is unchanged.

## Size and timing

What we are dealing with: files are capped at 10 MB each (`src/lib/documents/limits.ts`)
and held in Postgres; most organisations will have tens to hundreds of megabytes of
files and a few hundred thousand rows at most.

**Recommended: stream it, store nothing.** The route builds the zip as it sends it:
tables are read in pages (keyset on primary key, inside `withOrganisation`, so
row-level security still applies), files are read one at a time, and nothing is held
in memory or written to disk or to the database. ZIP64 so the archive can exceed 4 GB.
Files are stored uncompressed (most are PDFs and Office files, already compressed);
JSON and CSV are deflated.

The reason not to build it asynchronously by default: an async export has to be kept
somewhere until it is collected, and that somewhere would hold a second, complete copy
of every requester's personal data, outside the audit trail's control, with its own
retention to manage and its own deletion to prove under clause 5(h). Streaming avoids
creating that copy at all.

Limits and fallbacks:

- **Ceiling.** Before streaming, the route sums row counts and file bytes. Above a
  configured limit (`EXPORT_MAX_BYTES`, default 2 GB) it refuses with a message saying
  the export will be run by Waivern via the command line, which has no request time
  limit. *For decision: whether 2 GB is right, or whether to have no ceiling and rely on
  the platform's request timeout.*
- **One at a time.** One running export per organisation, so two owners clicking at
  once do not double the load. A second request is told one is already running.
- **Async later, if needed.** If real organisations outgrow streaming, add a background
  job writing the archive to object storage with a short-lived, single-use link and
  deletion after 7 days. Not built now; noted so the design does not preclude it.

## How completeness is guaranteed

The export is driven by a single registry, `src/services/organisation-export/registry.ts`:
every table in `src/db/schema` appears exactly once, as either

- **exported**: how it is scoped (its own `organisation_id`, or through a named parent),
  any columns withheld and why; or
- **excluded**: the reason, written for the person reading the manifest.

The registry is what the export runs from and what the manifest's exclusions list is
printed from, so the documentation of what was left out cannot disagree with what was
left out.

Tests (`tests/organisation-export.test.ts`):

1. **No table unaccounted for.** Reads every base table in the `public` schema from
   `information_schema` and fails if any is in neither list, naming the table. Adding a
   table without deciding its export fails CI. This is the database, not the Drizzle
   schema, so a hand-written migration cannot slip past either.
2. **No column unaccounted for.** Every column of an exported table is either written to
   the JSON or listed as withheld with a reason. Rows are read with `select *` shape from
   Drizzle's table definitions, so a new column flows out by default; the test catches
   the reverse (a withheld list naming a column that no longer exists).
3. **Every row leaves.** Builds an organisation with rows across the record types the
   fixtures can make, exports it, unzips it, and checks each table's line count equals
   `count(*)` for that organisation, and each file's bytes hash to its recorded SHA-256.
4. **Nothing else leaves.** A second organisation in the same database: none of its ids
   appear anywhere in the first organisation's archive.
5. **Only an organisation-wide owner.** A privacy administrator, an entity-scoped owner
   and a viewer are refused; the refusal is not audited as an export.
6. **Audited.** Start and completion events are written, with counts matching the
   manifest.
7. **The audit chain verifies from the archive alone**, using the manifest's own
   instructions.

## What is withheld, and why

Proposed; the full table-by-table list is in the appendix. The principle: the client
gets everything it put in or that was recorded about its work; it does not get
credentials, or Waivern's own records about the client.

- **Secrets.** Integration connection secrets (`secret_ciphertext`, `_iv`, `_tag`), the
  consent analyser token (ciphertext, iv, tag; the hint is kept), and domain
  verification tokens. They are useless outside this deployment and dangerous inside
  it. The connection itself (name, direction, scopes, created) is exported.
- **Hashes of one-time secrets.** Contributor link `token_hash`, and
  hashed IP addresses. Not data the client gave us; meaningless without the salt.
- **Platform tables.** `legal_reference` (the shared statute library, public anyway),
  shared `country_risk` rows without an organisation (the organisation's own country
  assessments are exported), `terms_acceptance` (Waivern's record, as provider, that
  people accepted the terms) and `feedback` (product feedback sent to Waivern). A person
  wanting their own entries in these asks Waivern under their own data protection
  rights; they are not the controller's data.
- **People.** `app_user` is shared across organisations. Members are exported through
  `membership` and `role_assignment`, with each member's name and email joined in, and
  nothing about their other organisations or their sign-in identifiers.

## Help and page

- A new section on `/app/exports`, visible only to organisation-wide owners: what is in
  the archive, the confirmation step, and the download.
- A help topic, "Exporting all your organisation's data", covering what is included and
  withheld, how to verify the archive, and what happens to data after the client leaves
  (pointing to the terms, which this feature does not change). `pnpm help:md` after.
- Deletion on termination is out of scope; it is a separate, Waivern-run process under
  clause 5(h).

## Decisions needed

1. **Format**: zip of JSON Lines per table + files + existing CSVs + audit log and
   manifest, as above. *Recommended.*
2. **Who**: organisation-wide owners only, with name-typing confirmation and an email to
   the other owners. *Recommended.*
3. **Audit**: start and completion events as above. *Recommended.*
4. **Size**: stream with no stored copy, a 2 GB ceiling above which Waivern runs the
   command-line export, one export at a time per organisation. *Recommended;* say if you
   want a different ceiling or none.
5. **Completeness**: registry plus the seven tests above, CI failing on any table or
   column not accounted for. *Recommended.*
6. **Withheld**: secrets, one-time-secret hashes and the four platform tables, as in the
   appendix. Confirm, or name anything you want included.
7. **Command-line export for Waivern** after access has ended. *Recommended.*

Build would be one PR on `feature/whole-organisation-export`, with this document updated
to record the decisions.

## Appendix: every table

**Exported, scoped by its own `organisation_id`** (78 less the excluded ones below):
the registers and their decisions and events (risks, risk appetite, assessments,
contributor links, AI use cases and their changes, assurance records, incidents, intake
requests, ATRS records, training records, breaches and breach decisions, complaints and
their events, DSRs with their decisions, scope and intake attempts, FOI requests with
decisions, reviews and regulator events, processing activities, suppliers, DPAs,
evidence, scan findings, record links, PECR digital properties, storage items,
decisions, proposals and consent scans, marketing activities and decisions, policy
documents, sharing agreements with parties and activities, entity agreements, templates
and template versions, framework profile items, retention profiles, workflow
definitions, tasks, SLA policies, schedules, notifications, comments, documents, import
sources, batches, rows and mappings, extractions with findings and links, the
organisation's own country risks, the AI assistant's conversations and suggestions,
webhook deliveries, the reference counter, form appearance and logo, DSR intake links,
entities, memberships, role assignments, organisation requests, organisation domains,
the audit log and the audit chain head).

**Exported through a parent**: `assessment_answer` and `assessment_revision` (via
assessment), `ai_incident_event` (via AI incident), `ai_message` (via conversation),
`mitigation` and `risk_acceptance` (via risk), `workflow_stage` (via workflow
definition), `approval` (via assessment), `country_risk_review` (via the
organisation's own country risk).

**Exported as a single record**: `organisation` (name, slug, settings; token columns
withheld).

**Excluded**: `legal_reference`, `terms_acceptance`, `feedback`, `app_user` (members
exported via membership), shared `country_risk` rows with no organisation.

**Columns withheld**: `integration_connection.secret_ciphertext/secret_iv/secret_tag`;
`organisation.consent_analyser_token_ciphertext/_iv/_tag`; `organisation_domain.token`;
`contributor_link.token_hash` and `last_used_ip_hash`; and
`dsr_intake_attempt.ip_hash`. Bytea columns are not withheld: they
become files.

The exact list is fixed in the registry during the build; the test makes any later
divergence fail.
