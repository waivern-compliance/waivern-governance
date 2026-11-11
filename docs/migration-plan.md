# Plan: moving a team's records in from another governance platform

Status: proposed 11 November 2026. Decisions below are recommendations, not yet settled.

## What is asked for

Teams arriving from OneTrust, Vanta and similar platforms bring years of records: a
record of processing, a vendor inventory, agreements, risks, assessments, policies,
evidence. They need to bring those in smoothly, without retyping, and without the
move quietly changing what the records say.

The question asked was whether an MCP connection is the best way to do it. This plan
recommends against MCP as the main route and for an import pipeline Govern owns, with
MCP as an optional client of that pipeline later (decision 1).

## What a migration has to get right

- **It adds up.** Somebody must be able to say "412 processing activities: 380 in, 32
  need attention", fix the 32 and run it again. Every row is accounted for: created,
  updated, refused with a reason, or left out on purpose.
- **It is repeatable.** Teams migrate in passes, and often run both platforms for a
  while. Importing the same export twice updates; it never duplicates.
- **It changes nothing on the way.** A legal basis, a risk owner or a retention period
  comes in as it was, or is refused and said so. Nothing is guessed silently.
- **It is honest about where records came from.** A risk accepted in OneTrust in 2024
  was not accepted in Govern. Imported decisions are history, shown as such, not
  approvals Govern's workflow gave.
- **It can be undone.** A batch imported against the wrong entity, or with a bad
  mapping, can be taken back out before anybody has worked on it.
- **Nothing is lost.** Fields with no home in Govern are kept with the record they came
  from, readable, rather than dropped.

## Why not MCP as the main route

MCP lets an AI agent call tools, one call at a time, with the agent deciding what to
call and with what. For a migration that is the wrong shape:

- The count and the reconciliation would live in the agent's run, not in Govern. There
  would be no batch to look at, re-run or undo.
- A model would be choosing how each record maps. Records a regulator may ask about
  (Article 30 entries, risk acceptances, DPIA outcomes) should move deterministically,
  with the model at most suggesting a mapping a person confirms.
- Every client would need an AI client connected to both platforms. Every team can
  already produce an export file.

Where MCP does help is the long tail: a platform with no usable export, or a team that
wants its own agent to pull from an old platform's API. That fits later, as a Govern MCP
server whose tools call the same pipeline, dry run first, and never write directly
(phase 5).

## Where Govern stands

- **Ingest, with idempotency.** `POST /api/v1/ingest/{processing-activities,vendors,dpas,
evidence,ai-use-cases,scans}` validates records against `lib/integration/contracts.ts`
  and upserts them by `externalRef`, unique per organisation and
  `integration_connection`. Processing activities, suppliers, DPAs, evidence, scan
  findings and AI use cases carry `external_ref`. The importer reuses these validators
  and this idempotency rather than writing a second set.
- **Missing from ingest:** risks, assessments, policy documents, data subject requests,
  complaints, breaches and FOI requests have no ingest route, and most have no
  `external_ref`.
- **Reading agreements.** `services/extraction.ts` asks the organisation's own model to
  read an agreement and propose its facts for review. That serves a legacy export that
  holds only DPA PDFs.
- **Files.** `documents` stores uploaded files (bytea), which suits keeping the original
  export with its batch.
- **Audit.** Every write goes through `appendAuditEvent` in the same transaction; an
  import does the same, one event per batch and one per record.

## What the sources hold

To be confirmed against real exports before any source profile is built (decision 6):
formats vary by product version, licence and each customer's configuration, so this is
a guide to scope, not a specification.

- **OneTrust:** the data inventory (assets, processing activities, vendors, data
  elements and their links), assessments (PIA, DPIA, vendor), data subject request and
  consent records, policies. Exports are typically spreadsheets, with a REST API for
  much of it.
- **Vanta:** vendors and their risk reviews, a risk register, policies, controls mapped
  to frameworks (SOC 2, ISO 27001), evidence documents. Exports are typically CSV, with
  an API.
- **Others** (Drata, Secureframe, TrustArc, spreadsheets kept by hand): broadly the
  same record types. A generic CSV import with column mapping covers them without a
  profile each.

## Decisions

1. **The route.** Recommended: an import pipeline in Govern (upload, map, dry run,
   commit), with MCP as an optional client of it later. Alternative: MCP first.
2. **Where imported decisions stand.** Recommended: imported records arrive marked
   _imported, not yet confirmed in Govern_. Their past decisions (a risk acceptance, an
   assessment outcome) are kept as dated history with who made them in the old
   platform, and a person confirms each record in Govern before it counts as current
   (for example, before an imported risk acceptance counts as in force). Alternative:
   treat them as current from the moment of import.
3. **Assessments.** Recommended: bring assessments in as read-only records with their
   questions and answers attached and their outcome as history, linked to the activity,
   vendor or system they were about. Do not force them into Govern's templates, whose
   questions will not match. A new assessment in Govern starts fresh when one is next
   due. Alternative: map answers into templates where questions match.
4. **Who may import.** Recommended: owners and privacy administrators
   (`workflow.configure` at organisation scope), the same people who configure the
   organisation. Every batch is audited with who ran it.
5. **Undo.** Recommended: a batch can be undone while none of its records has been
   changed in Govern since; after that, records are changed one by one like any other.
   Alternative: no undo, only correction.
6. **Sample files.** Recommended: no source profile is built until two or more real,
   anonymised exports of that source have been seen. Until then, the generic CSV import
   with saved column mappings serves every source.
7. **AI in the mapping.** Recommended: Claude suggests a column mapping for an
   unfamiliar file, using the organisation's own model as `extraction.ts` does, and a
   person confirms it before the dry run. The model never sees more than the header row
   and a few sample rows, and never writes.

## Data model

### `import_batch`

One upload and what became of it: the organisation, the entity it goes to, the source
(`csv`, `onetrust`, `vanta`, ...), the record type, the uploaded file (a `documents`
row), the mapping used, counts (created, updated, refused, left out), status
(`draft` / `dry_run` / `committed` / `undone`), who ran it and when. Carries its own
`integration_connection`, so each source's `externalRef` values are unique within it
and a re-import of the same source finds its earlier records.

### `import_row`

One row of the file and its outcome: the row number, the source ID, the record it
created or updated, `refused` with the reason, or `skipped`. Kept so a batch can be
reconciled and undone, and so a refused row can be fixed and re-run.

### `import_mapping`

A saved column mapping per organisation and source: which column goes to which field,
value translations (`"Legitimate Interest"` to `legitimate_interests`), and which
columns are deliberately left out. Source profiles ship as built-in mappings.

### On each importable record

- `external_ref` and `source_connection_id`, where the record type lacks them (risks,
  assessments, policy documents, the request registers).
- `imported_from` (batch id) and `imported_unconfirmed` (decision 2).
- `legacy` jsonb: the source fields with no home in Govern, shown on the record as
  "From <source>".

### `lib/import/` (pure)

Parsing (CSV, XLSX, JSON), mapping and value translation, and each record type's
conversion into the existing `*In` contracts. Pure, so a dry run and a commit run the
same code and the tests can feed it real anonymised exports.

## Phases

### Phase 0: the import framework

- `import_batch`, `import_row`, `import_mapping`, with RLS.
- Upload (CSV and XLSX, up to an agreed size), a column-mapping step, a dry run showing
  every row's outcome, commit, and undo (decision 5).
- First record types: **vendors** and **processing activities**, through the existing
  ingest validators.
- Provenance on the records: the batch, unconfirmed, and the legacy fields.
- An Imports page under Settings, listing batches with their counts.

### Phase 1: the rest of the inventory, and agreements

- DPAs and evidence, with their files.
- DPAs held only as PDFs go through `extraction.ts` for their facts, proposed for
  review as today.
- AI use cases.

### Phase 2: risks and policies

- `external_ref` on risks and policy documents; import for both.
- Imported risk acceptances kept as dated history (decision 2): the risk is
  unconfirmed until accepted, treated or closed again in Govern.

### Phase 3: assessments, and the request and incident registers

- Assessments as read-only records with questions, answers and outcome (decision 3).
- Data subject requests, complaints, breaches and FOI requests as closed history where
  they are closed, and as open records with their clocks where they are not.

### Phase 4: source profiles

- OneTrust and Vanta mappings, built from real exports (decision 6), so a file from
  either maps without the column step.
- Suggested mappings for unfamiliar files (decision 7).

### Phase 5: MCP, if wanted

- A Govern MCP server exposing the import as tools: start a batch, add rows, dry run,
  report, commit. A client's agent can pull from an old platform's API and push
  through the same pipeline, with a person committing the batch.
- Read-only tools for the batch report, so the agent can explain what was refused and
  why.

## Rough size

| Phase   | Estimate                                         |
| ------- | ------------------------------------------------ |
| Phase 0 | about 4 days                                     |
| Phase 1 | about 2 days                                     |
| Phase 2 | about 2 days                                     |
| Phase 3 | about 3 days                                     |
| Phase 4 | about 1 day per source, once exports are in hand |
| Phase 5 | about 2 days                                     |

Phase 0 and 1 cover what most teams move first: who they share data with, why, and
under what agreement.

## Out of scope

- Live, two-way sync with another platform. This is a move, not an integration.
- Exporting from Govern into another platform; the Integration API already serves
  exports.
- Migrating users and their permissions. Owners invite their people, as they do now.
- Re-creating another platform's workflows; Govern's own workflows apply from the move.
