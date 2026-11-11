# Plan: the EU GDPR, alongside the UK GDPR

Status: proposed, for decision. Written 11 November 2026. Nothing built.

## What is asked for

Govern is grounded in UK law: the UK GDPR, the Data Protection Act 2018 and PECR, as
amended by the Data (Use and Access) Act 2025 (`docs/duaa-plan.md`). The ask is to
cover legal entities subject to the EU GDPR as well: an entity subject to it alone (a
company established in a member State with no UK presence), and a single entity
subject to both at once (a UK company that also targets people in the EU, or an EU
company that also targets people in the UK, or a company with establishments in
both).

The EU GDPR only. The EU AI Act stays out, as decided earlier. National laws that
supplement the GDPR in each member State (Germany's BDSG, Ireland's Data Protection
Act 2018, France's Loi Informatique et Libertés and so on) and the ePrivacy Directive's
national transpositions are named where they change an answer, but are not built in;
see "Out of scope".

## Where Govern already stands

Govern is further along than "UK only" suggests. The pieces that exist:

- **Each entity says which law it is subject to.** `entity.data_protection_law` is
  `uk`, `eu` or `uk_eu` (migration 0086, `lib/dpa2018/applies.ts`), set on the
  Organisation page and audited. For an EU-only entity the DPA 2018's questions,
  decisions and flags are hidden: Schedule 1 and the policy document on the ROPA, the
  Schedule 2 and 3 exemptions on requests, the public authority, competent authority
  and PECR settings (refused while the entity is EU only), and the UK templates where
  no entity is under UK law.
- **Requests run on either clock.** `data_subject_request.jurisdiction` is `uk` or
  `eu`. Under EU law the clarification pause (UK Article 12A) and the proportionate
  search (UK Article 15(1A)) do not apply, and only weekends move the deadline
  (`lib/dsr/statutory.ts`). A request is refused under a law the entity is not subject
  to; for an entity under both, the organisation's default
  (`organisation.data_protection_jurisdiction`) decides.
- **Complaints know the s.164A duty is UK only** (`lib/complaints/statutory.ts`), and
  say so for an EU complaint.
- **The country library holds both answers**: `uk_adequacy` (worded as UK approval
  under Article 45A) and `eu_adequacy`, each with a note.
- **EU templates exist**: the CNIL PIA method (`cnil-pia.ts`) and the EU transfer
  impact assessment on the EDPB's six steps (`transfers.ts`), with about twenty
  `eugdpr.*`, `edpb.*`, `cnil.*` and `cjeu.schrems2` legal references.

What still assumes UK law, and gives a wrong or missing answer for an EU entity:

| Area                | Where                                                                                                      | What is wrong for the EU                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lawful basis        | `lib/gdpr/lawful-basis.ts`, `ropa/LawfulBasisFields.tsx`, `sharing-agreements/BasisFields.tsx`             | Recognised legitimate interests (Art 6(1)(ea)) is offered to every entity. It does not exist in the EU GDPR.                                                                                                                                                                                                                                                                                                                     |
| Objections          | `lib/dsr/statutory.ts` `objectionTest`                                                                     | Treats (ea) as a basis Article 21(1) reaches; harmless for the EU only because (ea) cannot be chosen once the basis list is gated.                                                                                                                                                                                                                                                                                               |
| Automated decisions | `lib/gdpr/automated-decisions.ts`, the ROPA and AI register sections, the DPIA, the request register right | Built on UK Arts 22A-22D, which permit a solely automated significant decision with safeguards. EU Article 22(1) prohibits it unless one of three exceptions in 22(2) applies. An EU entity's record is never asked for the exception, so a prohibited decision shows as compliant. The request register's `automated_decision` right cites Article 22C on EU requests too (`RIGHTS` in `lib/dsr/statutory.ts` is one constant). |
| Further processing  | `lib/gdpr/further-processing.ts`, `ropa/FurtherProcessingFields.tsx`                                       | Offers UK Art 8A's deemed-compatible routes and Annex 2. The EU has Art 6(4) only: consent, Union or member State law under Art 23, or a compatibility assessment on five factors.                                                                                                                                                                                                                                               |
| Research            | the same                                                                                                   | UK Arts 84A-84D; the EU has Article 89 plus member State law. UK Art 13(5) has no EU counterpart (EU Art 14(5)(b) covers only data not obtained from the person).                                                                                                                                                                                                                                                                |
| Children            | `processing_activity.children_likely`, DPIA                                                                | UK Art 25(1A) children's higher protection matters is UK only. The EU age of consent for information society services (Art 8) is 13 to 16 by member State; Govern does not ask.                                                                                                                                                                                                                                                  |
| Transfers           | UK TRA template, `transfers.ts` (EU TIA), agreements' `transfer_mechanism` text                            | Both assessments exist, but nothing says which an entity needs. An entity under both laws exporting the same data needs both, and nothing prompts for the second.                                                                                                                                                                                                                                                                |
| Regulator           | breach `supervisory_authority` decision, complaints' "told of regulator right", public form copy, guidance | One authority is assumed, and it is the ICO. There is no lead supervisory authority, main establishment, or Article 27 representative anywhere.                                                                                                                                                                                                                                                                                  |
| Breach              | `breach.regime` (`uk_gdpr` or `dpa_part3`), `lib/breach/statutory.ts`                                      | One notification to "the supervisory authority". An entity under both laws owes two: the Information Commission and the EU authority (or authorities).                                                                                                                                                                                                                                                                           |
| Complaints          | `services/complaints.ts`                                                                                   | Takes its default law from the organisation, not the entity, unlike requests.                                                                                                                                                                                                                                                                                                                                                    |
| Public request form | `app/request/[slug]/page.tsx`                                                                              | Promises acknowledgement of a complaint within 30 days, which is s.164A and UK only.                                                                                                                                                                                                                                                                                                                                             |
| Processing regime   | `processing_activity.regime`, `breach.regime`                                                              | The general regime is stored and shown as `uk_gdpr`, "UK GDPR (with Part 2 of the DPA 2018)", for an EU-only entity too.                                                                                                                                                                                                                                                                                                         |
| Public authority    | `entity.public_authority`                                                                                  | Defined by DPA 2018 s.7 and refused for EU-only entities. The EU GDPR has its own "public authority or body" (Arts 6(1) last subparagraph, 37(1)(a)), decided by member State law.                                                                                                                                                                                                                                               |
| Integration API     | `docs/integration-api.md`                                                                                  | Carries no entity law, and accepts `recognised_legitimate_interests` for any entity.                                                                                                                                                                                                                                                                                                                                             |
| Legal references    | `templates/library/legal-references.ts`                                                                    | About 50 `ukgdpr.*` against about 20 `eugdpr.*`; no EU references for Arts 3, 4(16), 6(4), 8, 22(2)-(4), 27, 37, 45, 46(2)(c), 56, 77, 89.                                                                                                                                                                                                                                                                                       |
| Copy and help       | `lib/help/topics.ts`, `lib/guidance/steps.ts`, ICO-framed templates (breach, DPIA, screening, LIA)         | Speak of the ICO and UK articles throughout.                                                                                                                                                                                                                                                                                                                                                                                     |

## The law, as checked

The EU GDPR, Regulation (EU) 2016/679, was read on EUR-Lex (consolidated text,
`CELEX:02016R0679-20160504`) on 11 November 2026. It has **never been substantively
amended**: EUR-Lex lists corrigenda only. The UK texts were read on legislation.gov.uk
the same day. The full notes, item by item with URLs, are kept outside the repository
with the sessions' shared notes; what matters for this plan is below.

### EU GDPR provisions that differ from the UK text

| Provision                          | What it says                                                                                                                                                                                                                                                                                                                                                                                                                                            | UK counterpart                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Art 3(1)-(2)                       | Applies to processing in the context of an EU establishment, and to a controller not established in the EU that offers goods or services to, or monitors, people in the EU.                                                                                                                                                                                                                                                                             | Same structure, "the United Kingdom" for "the Union".                                                                                                                               |
| Art 4(16), 4(22), 4(23), 56(1)-(3) | **One-stop shop.** For cross-border processing (establishments in more than one member State, or one establishment substantially affecting people in more than one), the authority of the main or single establishment leads. Any authority may handle a case local to its State (56(2)); the lead has three weeks to take it (56(3)).                                                                                                                  | None. One regulator.                                                                                                                                                                |
| Art 6(1)                           | Six bases. No recognised legitimate interests. (f) does not apply to processing by public authorities in performing their tasks.                                                                                                                                                                                                                                                                                                                        | Seven, with (ea) and Annex 1 (DUAA).                                                                                                                                                |
| Art 6(4)                           | Compatibility of further processing: consent, Union or member State law safeguarding an Art 23(1) objective, or an assessment taking account of five factors.                                                                                                                                                                                                                                                                                           | Art 8A and Annex 2: the same five factors, plus routes deemed compatible.                                                                                                           |
| Art 8(1)                           | Information society services offered directly to a child on the basis of consent: age **16**, member States may set a lower age **not below 13**.                                                                                                                                                                                                                                                                                                       | **13**. Since 29 April 2026 (Children's Wellbeing and Schools Act 2026) Art 8(2A)-(2B) let the Secretary of State raise it, to no more than 16, generally or per service. Still 13. |
| Art 12(3), (5)                     | One month from receipt, extendable by two months where necessary, the person told within the first month. Manifestly unfounded or excessive requests may be refused or charged for. No pause.                                                                                                                                                                                                                                                           | Art 12A (5 February 2026): one month from "the relevant time" (the latest of receipt, identity information, or a fee), the clarification pause for access requests, and Art 15(1A). |
| Art 21(1)                          | Objection reaches (e) and (f).                                                                                                                                                                                                                                                                                                                                                                                                                          | Reaches (ea) as well.                                                                                                                                                               |
| Art 22(1)-(4)                      | **A right not to be subject** to a decision based solely on automated processing with legal or similarly significant effects, unless it is (a) necessary for a contract, (b) authorised by Union or member State law with safeguards, or (c) based on explicit consent. For (a) and (c), at least human intervention, the chance to express a view and to contest (22(3)). Special category data only under Art 9(2)(a) or (g) with safeguards (22(4)). | Arts 22A-22D: permitted with the 22C safeguards, restricted only for special category data and (ea).                                                                                |
| Art 27                             | A controller under Art 3(2) designates a representative in the Union, **established in a member State where the people targeted or monitored are** (27(3)). Exempt for occasional, low-risk processing without large-scale special category or criminal data, or for a public authority or body (27(2)).                                                                                                                                                | Same, but **27(3) is omitted**: a UK representative need only be in the UK.                                                                                                         |
| Art 33(1)                          | 72 hours to the supervisory authority "competent in accordance with Article 55".                                                                                                                                                                                                                                                                                                                                                                        | 72 hours to the Information Commission.                                                                                                                                             |
| Art 37(1), (7)                     | A DPO for public authorities, large-scale monitoring or large-scale special category data; contact details published **and** communicated to the authority. Member State law may require more (37(4)).                                                                                                                                                                                                                                                  | Same text.                                                                                                                                                                          |
| Arts 45, 46(2)(c), 49              | Commission adequacy decisions; standard contractual clauses adopted by the Commission; derogations.                                                                                                                                                                                                                                                                                                                                                     | Art 45 omitted; Art 45A approval by regulations; Art 46(1A) data protection test.                                                                                                   |
| Art 77, 78(2)                      | A complaint to a supervisory authority, in particular in the State of residence, work or the alleged infringement; the authority must inform the complainant within three months. No duty on the controller and no requirement to complain to it first.                                                                                                                                                                                                 | Art 77 omitted; DPA 2018 s.165, and the s.164A duty on controllers (in force 19 June 2026).                                                                                         |
| Art 83(4)-(5)                      | Up to EUR 10 million or 2%, and EUR 20 million or 4%, of worldwide annual turnover.                                                                                                                                                                                                                                                                                                                                                                     | The same, in pounds (£8.7 million and £17.5 million).                                                                                                                               |
| Arts 9(4), 23, 85-91               | Member States may add conditions for genetic, biometric and health data, restrict rights by law, and legislate for expression, employment, research, secrecy and churches.                                                                                                                                                                                                                                                                              | DPA 2018 Schedules 1-4.                                                                                                                                                             |

### EU instruments around the Regulation

| Instrument                                                                       | Status on 11 November 2026                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementing Decision (EU) 2021/914, standard contractual clauses (four modules) | In force. Recital 7 excludes importers already subject to the GDPR under Art 3(2); clauses for them exist only as drafts.                                                                                                         |
| Adequacy for the United Kingdom                                                  | **Renewed** by Decision (EU) 2025/2574 of 19 December 2025, expiring **27 December 2031**. It also removes the original immigration-exemption carve-out. (Decision 2025/1226 had extended the 2021 decision to 27 December 2025.) |
| EU-US Data Privacy Framework, Decision (EU) 2023/1795                            | In force; upheld by the General Court in T-553/23. A new reference, C-804/25, is pending before the Court of Justice.                                                                                                             |
| Regulation (EU) 2025/2518 on cross-border enforcement procedure                  | Published 12 December 2025, in force 1 January 2026, **applies from 2 April 2027**. Procedure between authorities and the rights of parties in cross-border cases.                                                                |
| Digital Omnibus, COM(2025) 837                                                   | **Proposal only**, at committee stage. Would change the personal data definition, breach notification (high risk only, 96 hours, a single entry point), EU-wide DPIA lists, Art 12(5) and Art 22. Not planned for here.           |
| Omnibus IV, COM(2025) 501                                                        | **Proposal**, trilogue agreed; plenary vote scheduled for 23 November 2026. Would widen the Art 30(5) record-keeping exemption. The agreed wording was not available to check.                                                    |

### UK points found while checking

- **The ICO is now the Information Commission.** From 30 September 2026 "Commission"
  replaces "Commissioner" throughout the UK GDPR and DPA 2018. Govern's copy says "ICO"
  and "Commissioner" in many places; this is a UK fix independent of the EU work and
  belongs in Phase 0.
- **Art 46(2)** now lists, among others, standard data protection clauses in regulations
  under Art 47A(1) and in a document issued under DPA 2018 s.119A. s.119A does not name
  the IDTA or the Addendum; their status after the DUAA's transitional provisions was not
  checked and should be before Phase 5.

Not confirmed: the agreed Omnibus IV wording; the IDTA and Addendum's transitional
status; whether the Information Commission may decline a complaint not first raised
with the controller. The European Commission's SCC page returned an error, so "no new
SCCs" rests on a EUR-Lex search.

## Data model

The principle: **the entity says which laws it is subject to; each record says which
of those laws govern it; every rule is evaluated once per law that applies.** Nothing
is merged into a hybrid rule set, because the two texts now differ on substance (bases,
automated decisions, further processing, transfers) and a hybrid would cite a provision
that exists in neither.

`DataProtectionLaw` (`uk | eu | uk_eu`) is already the type for "one, the other, or
both". It is reused everywhere below rather than introducing an array, so a record can
only ever name a subset of its entity's laws and a query can filter on one column.

### `entity` additions

| Column                        | What it holds                                 | Why                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uk_establishment`            | boolean, default true                         | Whether UK law applies by establishment (UK Art 3(1)) or only by targeting or monitoring (Art 3(2)). Decides whether a UK representative is needed.                                                                   |
| `eu_establishments`           | text[] of member State codes                  | Where the entity is established in the EU. Empty means EU law applies only under Art 3(2).                                                                                                                            |
| `eu_main_establishment`       | member State code, nullable                   | Art 4(16): the place of central administration, or where decisions on purposes and means are taken. Asked only where there is more than one establishment.                                                            |
| `eu_lead_authority`           | supervisory authority code, nullable          | Art 56(1). Suggested from the main establishment, **recorded by a person**, because identifying the lead authority is a judgement (EDPB Guidelines 8/2022) and is challenged in practice.                             |
| `eu_representative`           | jsonb (name, member State, contact), nullable | Art 27, where EU law applies and there is no EU establishment. Its member State must be one where the people targeted or monitored are (27(3)).                                                                       |
| `eu_representative_exemption` | `occasional` / `public_body`, nullable        | Art 27(2): occasional processing, not large-scale special category or criminal data, unlikely to result in a risk; or a public authority or body.                                                                     |
| `uk_representative`           | jsonb, nullable                               | UK GDPR Art 27, the mirror case: an entity under UK law with no UK establishment.                                                                                                                                     |
| `eu_public_body`              | boolean, default false                        | The EU sense of "public authority or body", decided by member State law. Bars Art 6(1)(f) for its tasks and requires a DPO (Art 37(1)(a)). Separate from `public_authority`, which is DPA 2018 s.7 and stays UK only. |

Gaps on the Organisation page: EU law applies with no establishment, no representative
and no exemption; more than one EU establishment with no main establishment; a main
establishment with no lead authority recorded; and the UK mirror.

### A shared library of supervisory authorities

`supervisory_authority`, central like the country library and updated for every client
at once: `code`, `name`, `country`, `law` (`uk` or `eu`), `website`, `breach_url`,
`complaints_url`, `reviewed_at`. Seeded with the Information Commission, one authority per EU member State,
and the three EEA EFTA authorities (the GDPR applies in Iceland, Liechtenstein and
Norway through the EEA Agreement). Germany has a federal authority and one per Land
(Bavaria two); the private sector answers to the Land authority, so the Länder are
seeded as separate rows. Organisations do not edit it; a wrong entry is fixed for
everyone.

### `processing_activity` additions and changes

| Column                   | What it holds                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laws`                   | `DataProtectionLaw`, default the entity's. Must be within the entity's laws. A dual entity's UK payroll may be `uk`; its EU customer records `uk_eu` or `eu`.                                                                                                                          |
| `regime`                 | The general regime value `uk_gdpr` becomes `gdpr` (decision 3); `dpa_part3` is unchanged and allowed only where `laws` includes UK.                                                                                                                                                    |
| `adm_eu_exception`       | Art 22(2): `contract`, `law` or `explicit_consent`, with `adm_eu_law_note` naming the Union or member State law for `law`. Asked only where `laws` includes EU and a significant decision is solely automated.                                                                         |
| `eu_compatibility_route` | Art 6(4): `consent`, `law` (a Union or member State measure safeguarding an Art 23(1) objective) or `assessed`. Asked where `laws` includes EU and the activity is further processing. The five assessment factors are shared with UK Art 8A(2), so `compatibility_factors` is reused. |
| `children_member_states` | text[] of member States, where the activity offers an information society service to children on the basis of consent (Art 8(1)). Read against the country library's age for each.                                                                                                     |

The existing UK-only fields (`recognised_condition`, the UK further-processing routes and
Annex 2, `art13_exemption`, `research_safeguards` for 84C, `children_likely` for Art
25(1A)) stay as they are and are asked only where `laws` includes UK.

### `country` addition

`digital_consent_age` (13 to 16) and `digital_consent_source` (the national provision)
on each EEA row, for Art 8(1). Seeded only from national law that has been checked;
unchecked rows stay null and the gap says "age not established".

### Breach

- `breach.laws`: `DataProtectionLaw`, default the entity's, narrowed by the person.
- `breach.regime`: `uk_gdpr` becomes `gdpr`, as for activities.
- `breach_decision.authority_code`: which supervisory authority a `supervisory_authority`
  decision concerns. There can now be several such decisions per breach, one per
  authority; the obligations list expects one per authority that must be told.

### Requests and complaints

- `data_subject_request.jurisdiction` and `complaint.jurisdiction` take a third value,
  `uk_eu` (decision 2). The Postgres enum gains a value; the type in
  `lib/dsr/statutory.ts` becomes `DataProtectionLaw`.
- Complaints default from the **entity**, as requests already do, through
  `defaultRequestJurisdiction`.
- `organisation.data_protection_jurisdiction` is dropped (decision 2): once "both" is a
  value of its own, a dual entity's default is `uk_eu`, and the organisation-wide
  setting decides nothing.

### Agreements and transfers

`transfer_mechanism` on agreement records is free text today. It becomes a list of
known mechanisms with the text kept as the note (decision 6): `uk_approval` (Art 45A),
`idta`, `uk_addendum`, `uk_bcr`, `eu_adequacy` (Art 45), `eu_scc` with its module
(1 to 4, Implementing Decision (EU) 2021/914), `eu_bcr`, `eu_code_or_certification`,
`derogation`.

### Pure modules

- `lib/gdpr/regimes.ts`: `lawsOf(record)`, `appliesUk`, `appliesEu`,
  `withinEntity(entityLaw, recordLaw)`. `lib/dpa2018/applies.ts` keeps the DPA 2018 gate
  and imports from here.
- `lib/gdpr/lawful-basis.ts`: `basesFor(laws)` (no (ea) without UK);
  `lawfulBasisGaps` gains `ea_without_eu_basis` and `f_by_eu_public_body`.
- `lib/gdpr/automated-decisions.ts`: `admRestriction` per law. For EU: prohibited unless
  an Art 22(2) exception is recorded; 22(4) special category needs explicit consent or
  substantial public interest (Art 9(2)(a) or (g)); the safeguards of 22(3) for the
  contract and consent exceptions. For UK: as today.
- `lib/gdpr/further-processing.ts`: `compatibilityRoutes({ law, ... })`.
- `lib/gdpr/authorities.ts`: `authoritiesToNotify({ laws, entity, affectedStates })`
  for breaches, and `regulatorFor` for complaints and the public form.
- `lib/gdpr/transfers.ts`: `assessmentsRequired({ laws, destination, mechanisms })`:
  which of the UK TRA and the EU TIA a transfer needs, and whether each is on file.

## How a dual-regime record is shown

Two patterns, chosen per feature by what the law asks:

- **A clock: strictest-of.** Where both laws set a deadline for the same act, the
  earliest governs and is shown, with the other beside it in small type and the reason
  ("EU GDPR: no pause for clarification"). This is how requests work: the month is the
  same in both, and UK law only ever adds time (the clarification pause, bank holidays),
  so the EU deadline is never later. Running the EU clock for a dual request is
  therefore always safe; the UK reliefs are shown as "UK only, does not extend the EU
  deadline".
- **A judgement or a duty owed to someone: both, side by side.** Where the laws ask
  different questions, or the duty runs to different people, the record shows a column
  per law, each with its own provision, answer and gap. Strictest-of would be wrong
  here: a lawful basis valid in one regime and not the other is not "the stricter
  basis", it is two answers, and a breach owed to the Information Commission and to the CNIL is two
  notifications, each tracked to its own acknowledgement.

| Feature                   | Pattern      | For a dual record                                                                                                                                                 |
| ------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request deadline          | strictest-of | The EU deadline. UK-only exemptions (DPA 2018 Sch 2 and 3) and the proportionate search are offered, marked as answering the UK obligation only.                  |
| Complaint acknowledgement | the UK duty  | s.164A applies wherever UK law does, so a dual complaint has the 30 days; the EU sets no period.                                                                  |
| Breach notification       | both         | One obligation per authority, each 72 hours from awareness. The risk assessment and the Art 34 decision are shared, because Arts 33 and 34 read the same in both. |
| Lawful basis              | both         | One list of bases, with each checked against each law. (ea) on an activity that is also EU needs an EU basis beside it.                                           |
| Automated decisions       | both         | The record is shared; the UK column checks 22A-22D, the EU column 22(2)-(4).                                                                                      |
| Further processing        | both         | Shared factors; a route per law.                                                                                                                                  |
| Transfers                 | both         | A UK assessment and an EU assessment, or a gap for whichever is missing.                                                                                          |
| Regulator                 | both         | The Information Commission and the EU authority (or authorities), named.                                                                                          |

The record page header names the laws ("UK GDPR and EU GDPR"), and each gap or notice
names the law it comes from, so a reader can always tell which regime is complaining.

## What can be shared

Most of the Regulation is still the same text in both. These stay single and unlabelled,
citing "Article N" without a prefix where the article reads the same:

- **Principles, records and security**: Arts 5, 24, 25(1)-(2), 28, 30 (including the
  30(5) exemption), 32. The ROPA's Article 30 elements are one set.
- **Special category and criminal data**: Arts 9(1)-(2) and 10 (already handled: an
  EU-only activity is asked Art 9 and 10 without Schedule 1).
- **Breach thresholds**: Art 33's risk test, Art 34's high-risk test and the 34(3)
  exemptions, and the 72 hours. The breach severity template's factors come from WP29
  WP250, which both the ICO and the EDPB follow.
- **DPIA**: Art 35(1), (3), (7) and 36. The UK DPIA and the CNIL method both satisfy
  both; the screening's "likely high risk" list differs (each authority publishes its
  own Art 35(4) list), handled by citing the relevant authority's list.
- **Rights**: Arts 15-21 and the month in Art 12(3), apart from what the DUAA added
  (Art 12A, Art 15(1A), the (ea) objection).
- **DPO**: Art 37-39. Some member States require a DPO more often (Germany, for example);
  the DPO panel notes that national law may require one where the GDPR does not.
- **Lawful bases (a)-(f)**, the Art 6(1)(f) balancing test (the LIA's three-part test is
  the same; only the citations change), and the five compatibility factors (UK Art
  8A(2) and EU Art 6(4) list the same five).
- **Assessments engine, workflows, risk register, audit chain, retention.** None of it is
  law-specific.

Shared records with one answer per law (decision 1 explains why not separate records):
the ROPA entry, the breach, the request, the complaint, the agreement.

Per-law variants, with the provision for each:

| Feature                              | UK                                                                                          | EU                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Territorial scope, representative    | UK GDPR Arts 3, 27                                                                          | GDPR Arts 3, 27                                                                                                      |
| Regulator                            | the Information Commission (since 30 September 2026); complaints DPA 2018 s.165             | lead authority Art 56(1), local cases 56(2), authority concerned Art 4(22); complaints Art 77                        |
| Recognised legitimate interests      | Art 6(1)(ea), Annex 1                                                                       | none                                                                                                                 |
| Public body and legitimate interests | DPA 2018 s.7                                                                                | Art 6(1) last subparagraph, member State law                                                                         |
| Further processing                   | Art 8A, Annex 2                                                                             | Art 6(4), Art 23(1)                                                                                                  |
| Research                             | Arts 84A-84D, Art 13(5)                                                                     | Art 89, Art 14(5)(b), member State law under 89(2)-(3)                                                               |
| Automated decisions                  | Arts 22A-22D                                                                                | Art 22(1)-(4)                                                                                                        |
| Children                             | Art 8 (13, adjustable to 16 by regulations), Art 25(1A)                                     | Art 8 (16, member States 13 to 15)                                                                                   |
| Subject access clock                 | Arts 12(3), 12A, 15(1A)                                                                     | Art 12(3)                                                                                                            |
| Complaints to the controller         | DPA 2018 s.164A                                                                             | none                                                                                                                 |
| Breach notification                  | Art 33 to the Commission                                                                    | Art 33 to the authority competent under Art 55, lead authority under Art 56                                          |
| Transfers                            | Arts 44A, 45A-45C, 46(1A) and the data protection test, IDTA and Addendum (DPA 2018 s.119A) | Arts 44-49, adequacy decisions, SCCs (2021/914), "essentially equivalent" (Schrems II, EDPB Recommendations 01/2020) |
| Exemptions                           | DPA 2018 Schs 2-4                                                                           | Art 23, member State law                                                                                             |
| Direct marketing and cookies         | PECR as amended                                                                             | ePrivacy Directive 2002/58/EC, member State law                                                                      |
| Fines                                | Art 83 in pounds, DPA 2018 s.157                                                            | Art 83 in euros                                                                                                      |

## Integration API v1

Additive only; a minor version bump of the context export, as before. Contract first in
`docs/integration-api.md`, then Govern, then the Portal.

- **Ingest, processing activities**: optional `laws` (`uk`, `eu`, `uk_eu`). Absent means
  the entity's laws, as today. A value outside the entity's laws is **skipped with the
  reason**, not narrowed, for the same reason an unknown entity is skipped.
  `lawfulBases` containing `recognised_legitimate_interests` on an EU-only activity is
  skipped with the reason; on a dual activity it is accepted and the gap reported.
  `automatedDecisions` gains `euException` and `euLawNote`; `furtherProcessing` gains
  `euRoute`; a `childrenMemberStates` array.
- **Ingest, DPAs**: optional `transferMechanisms` array as in the data model, with
  `transferMechanism` text kept as the note.
- **Export, context**: each entity carries `dataProtectionLaw`, `euMainEstablishment`,
  `euLeadAuthority`, `euRepresentative` and `ukRepresentative`; each processing activity
  `laws`, and the EU fields above. The Portal needs these to write a privacy notice that
  names the right regulator and representative.
- **Export, ropa**: `laws` per activity. An `entity` filter is already supported.
- **Export, requests and complaints summaries**: counts broken down by law, with `uk_eu`
  as its own key. `acknowledged` keeps counting every complaint.
- **Webhooks**: none change.

The Portal side is built separately; until then it sends nothing new and Govern applies
the entity's laws.

## Migration of existing data

Nothing existing is reinterpreted. Every entity is `uk`, `eu` or `uk_eu` already
(migration 0086); every record today was made under UK rules.

1. `processing_activity.laws` and `breach.laws` are set to the entity's law. For a
   `uk_eu` entity that is `uk_eu`, which shows more, never less. A person narrows it.
2. `regime` values `uk_gdpr` become `gdpr` on activities and breaches (if decision 3 is
   taken as recommended).
3. Requests and complaints keep the jurisdiction they were opened under; their deadlines
   are reproducible from the record and must not move. `uk_eu` is offered only for new
   ones.
4. `organisation.data_protection_jurisdiction` is dropped after step 3, with the audit
   chain holding its last value.
5. **(ea) on an EU-only activity.** Find any processing activity of an `eu` entity whose
   `lawful_bases` includes `recognised_legitimate_interests`. Leave it, and report it as
   a red gap ("Recognised legitimate interests is UK law only"); do not remove the
   basis, because the person has to decide what replaces it. The same for an EU-only
   activity with a UK further-processing route.
6. Transfer mechanism text is matched to the list where it names exactly one mechanism,
   and left as the note otherwise, as the lawful basis migration did.
7. Shipped templates: edited in place where the change is citations only (decision 5).

## Tests

`node:test` against the real database, each file with its own organisation, as now.

- **Pure rules**, each with an EU, a UK and a dual case: `basesFor`,
  `lawfulBasisGaps` (ea on EU-only; ea on dual without an EU basis; (f) by an EU public
  body), `admRestriction` (EU solely automated with no exception is prohibited; EU 22(4)
  with special category and only contract is prohibited; UK same record allowed with
  safeguards), `compatibilityRoutes` per law, `authoritiesToNotify` (main establishment
  gives the lead authority; no EU establishment gives each authority where affected
  people are; dual gives the Information Commission as well), `assessmentsRequired`.
- **Clocks**: a dual request's deadline equals the EU one in every case, including a
  clarification pause and a bank holiday; a dual complaint gets the s.164A 30 days; an
  EU complaint gets none.
- **Tenancy and refusal**: an activity's `laws` outside its entity's is refused; an EU
  setting on a UK-only entity is refused; narrowing an entity to UK only while an
  activity is EU is refused with the record named.
- **Integration API**: the skips listed above, the export carrying `laws`, and a 1.2
  reader ignoring the new keys.
- **Migration**: a seeded `uk_eu` entity's activities end up `uk_eu`; an EU activity on
  (ea) keeps it and shows the gap; request deadlines are unchanged before and after.
- **Help**: `pnpm help:md` and the help check, as for any screen change.

## Phases

### Phase 0: the law, references and the wrong answers

- Legal references for the EU provisions in the table above (`eugdpr.art3`, `art4.16`,
  `art6.4`, `art8`, `art22.2`, `art22.4`, `art27`, `art37`, `art45`, `art46.2c`, `art56`,
  `art77`, `art89`, the SCC decision, the UK adequacy decision, EDPB Guidelines 8/2022
  and 9/2022), each checked to resolve on EUR-Lex or the EDPB site.
- **Stop offering (ea) where EU law alone applies**: `basesFor(laws)` in the ROPA and
  sharing agreement forms, the DPIA and LIA. The red gap for existing records.
- **Complaints take their default from the entity.**
- **The public form**: the s.164A sentence only where the entity is under UK law; the
  regulator named from the entity.
- **"Information Commission"** for the UK regulator in copy, help and templates, since
  30 September 2026, with the legal references' titles updated.

### Phase 1: entity facts and the authority library

- The `entity` columns, the Organisation page section ("EU establishment and
  representation"), its gaps and audit events.
- The `supervisory_authority` library, its seed and its page beside the country library.
- `regulatorFor`, used by complaints ("told of regulator right"), requests (the refusal
  letter's right to complain) and the public form.

### Phase 2: records under both laws

- `processing_activity.laws`, the `gdpr` regime rename, the ROPA filter and column.
- `lib/gdpr/regimes.ts`, and the ROPA page showing per-law answers and gaps.
- Lawful basis per law: `ea_without_eu_basis`, `f_by_eu_public_body`.

### Phase 3: requests, complaints and breaches

- `uk_eu` on requests and complaints, strictest-of on the clock, UK reliefs marked.
- Breach `laws`, `authority_code` on decisions, one obligation per authority, the
  breach page's notifications section listing each authority with its own deadline and
  acknowledgement.
- Drop `organisation.data_protection_jurisdiction`.

### Phase 4: automated decisions, further processing, research, children

- `adm_eu_exception` and the EU column of the automated decisions section, on both the
  ROPA and AI use cases; the DPIA and AI risk templates ask the 22(2) question where the
  entity is under EU law; the request register's automated-decision right cites 22(3)
  for EU requests.
- `eu_compatibility_route`, the EU research safeguards (Art 89(1)), and the Art 14(5)(b)
  case.
- `digital_consent_age` on the country library (checked values only),
  `children_member_states` on activities, and the gap where an age is above 13 or not
  established.

### Phase 5: transfers

- `transfer_mechanisms` on agreements, `assessmentsRequired`, and gaps on the ROPA and
  agreements: "EU transfer with no TIA", "UK transfer with no TRA".
- EU TIA template: brought up to date with the current SCCs and, for the US, the Data
  Privacy Framework.
- The country library's EU notes for the UK and the US checked and dated.

### Phase 6: Integration API and exports

- Contract first, then ingest and export as above; context export version bump.
- CSV and PDF exports gain a "Law" column on activities, breaches, requests and
  complaints.

### Phase 7: copy, help and templates

- Help topics, guidance steps and the setup checklist name both laws where both may apply
  and stop saying "the ICO" where "the supervisory authority" is meant.
- Templates: the DPIA, screening and breach templates cite shared articles without a
  "UK" prefix where the text is the same, and add EU sources (EDPB, the relevant
  authority's Art 35(4) list) beside the ICO's.

## Rough size

| Phase   | Estimate       |
| ------- | -------------- |
| Phase 0 | about 1 day    |
| Phase 1 | about 2 days   |
| Phase 2 | about 2 days   |
| Phase 3 | about 2.5 days |
| Phase 4 | about 2.5 days |
| Phase 5 | about 2 days   |
| Phase 6 | about 1.5 days |
| Phase 7 | about 1.5 days |

Phase 0 removes the wrong answers an EU-only entity can get today and can ship on its
own. Phases 1-3 make a dual entity workable for the registers people use most.

## Out of scope

- The EU AI Act, as decided earlier.
- Member State law beyond the GDPR's own openings: national exemptions (Art 23), DPO
  thresholds, employment data (Art 88). The one exception is the Art 8 age of consent,
  and only its number. A record can cite national law in its notes.
- The ePrivacy Directive and national cookie and marketing laws. PECR stays UK only; an
  EU-only entity is not offered the PECR registers, as today.
- The Law Enforcement Directive (EU) 2016/680, the EU counterpart of DPA 2018 Part 3.
- Deciding any authority, basis, exception or mechanism automatically. Govern suggests
  (the lead authority from the main establishment, a mechanism from text) and a named
  person records the decision and why.
- Where Govern itself is hosted, and Waivern's own customer terms and data processing
  agreement for EU customers. Both matter commercially but are not product changes.
- The Portal's own changes.
- The Digital Omnibus and Omnibus IV, until adopted. Both would change rules built here
  (breach notification, Art 22, Art 30(5)); the pure modules keep each rule in one place
  so a change is one edit with its tests.

## Decisions for the user

1. **One record with an answer per law, or separate records per law.** _Recommendation:_
   one record. A dual entity's CRM is one processing activity, one breach is one
   incident, one request is from one person; splitting them would duplicate everything
   that is shared (most of the record) and let the copies drift. Per-law answers live
   in a few columns and in the pure rules.
2. **How a request or complaint to a dual entity is run.** _Recommendation:_ a third
   value, `uk_eu`, defaulted for a dual entity, running the strictest clock (the EU one
   for requests, s.164A for complaints), and drop the organisation-wide default. The
   alternative is to keep choosing one law per request, which is right only when the
   person handling it knows which law governs that person's data, and wrong in a way
   that misses a deadline when they guess UK.
3. **Rename the general regime `uk_gdpr` to `gdpr`.** _Recommendation:_ yes, with a data
   migration. It is shown as "UK GDPR (with Part 2 of the DPA 2018)" on EU-only records
   today. The alternative, adding an `eu_gdpr` regime value, would put the law in two
   places (`regime` and `laws`) that could disagree.
4. **Lead authority: derived or recorded.** _Recommendation:_ suggested from the main
   establishment, recorded by a person, audited. A derived value cannot represent the
   cases the one-stop shop leaves open (a decision taken elsewhere than central
   administration, a local case under Art 56(2)).
5. **Shipped templates.** _Recommendation:_ edit in place where only citations change
   (shared articles lose the "UK" prefix); add EU questions behind a "where the entity is
   under EU law" condition rather than shipping EU copies of the DPIA and LIA. The CNIL
   PIA and EU TIA stay as the EU-specific templates they are. Check first whether any
   organisation has answered assessments on these templates; the DUAA plan could edit in
   place because none had.
6. **Structure transfer mechanisms on agreements.** _Recommendation:_ yes, as the lawful
   basis was, because "which assessment does this transfer need" cannot be answered from
   free text. Without it, Phase 5 shrinks to guidance only.
7. **The Art 8 age table.** _Recommendation:_ hold only values checked against each
   member State's own law, with the source, and treat the rest as unknown. A list copied
   from a secondary source would be the one place Govern states a national law it has
   not read.
8. **Scope and order.** _Recommendation:_ Phase 0 now, as it fixes wrong answers; then
   Phases 1-3 for dual entities; 4-7 as clients need them. If the first EU client is
   EU-only rather than dual, Phase 4 (automated decisions) moves ahead of Phase 3,
   because that is where an EU-only entity gets a misleading answer.
9. **EEA, not just EU.** _Recommendation:_ label the regime "EU GDPR" but treat Iceland,
   Liechtenstein and Norway as member States throughout (authorities, establishments,
   ages). The alternative is to say EU only and refuse EEA EFTA establishments.
