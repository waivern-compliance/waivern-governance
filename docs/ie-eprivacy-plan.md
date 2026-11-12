# Plan: the Irish ePrivacy Regulations, beside PECR

## What is asked for

Support the Republic of Ireland's ePrivacy law, the European Communities (Electronic
Communications Networks and Services) (Privacy and Electronic Communications)
Regulations 2011, S.I. No. 336 of 2011, as amended. It is the Irish transposition of
the ePrivacy Directive 2002/58/EC, and the nearest equivalent of PECR. When an entity is
declared, it should also say whether it is subject to this Irish law.

EU GDPR support is built and deployed (PRs #32 to #40, migrations `0101` to `0106`).
This plan is based on the code that shipped, listed below with its files, and refers to
the EU GDPR plan (`docs/eu-gdpr-plan.md`) only for the reasoning behind its decisions.
Decisions are numbered here; "EU decision N" means decision N of that plan.

### What shipped, and what this plan reuses

| What                                    | Where                                                                                                                                                                                                                                | Reused for                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| The entity's law, `uk / eu / uk_eu`     | `entity.data_protection_law` (`drizzle/0086_entity_data_protection_law.sql`); `lib/dpa2018/applies.ts`; `setDataProtectionLaw` in `services/entities.ts`                                                                             | The Irish flag is allowed only where EU law applies, and narrowing to UK law is refused while it is on, in the same function |
| Establishment and lead authority        | `entity.eu_establishments`, `eu_lead_authority` and the rest (`drizzle/0101_entity_establishment.sql`, `0102_establishment_followups.sql`); `lib/gdpr/establishment.ts`; `EstablishmentForm.tsx` under `app/app/admin/organisation`  | Suggesting the Irish flag from an Irish establishment or `ie-dpc`                                                            |
| The authority library                   | `lib/gdpr/authorities.ts` (a code module updated by release, with `ie-dpc`)                                                                                                                                                          | Naming the Commission and its ePrivacy breach form                                                                           |
| A record's own laws within its entity's | `processing_activity.laws` (`drizzle/0103_records_under_both_laws.sql`); `withinEntity`, `effectiveLaws` in `lib/gdpr/regimes.ts`; `cleanRecordLaws` in `services/ropa.ts`                                                           | The same pattern for `eprivacy_scope` on cookie properties and marketing activities                                          |
| Breach obligations per authority        | `breach.laws`, `affected_states`, `authority_code` and `authoritiesToNotify` (`drizzle/0104_eu_requests_complaints_breaches.sql`, `lib/breach/statutory.ts`, `lib/gdpr/establishment.ts`)                                            | The Irish provider obligation sits beside them as its own clock                                                              |
| The UK-only settings guard              | `ukLawOnly` and the provider check in `services/entities.ts`                                                                                                                                                                         | Widened for `public_comms_provider`                                                                                          |
| The PECR registers                      | `drizzle/0067_pecr_inventory.sql`, `0068_pecr_keeping_current.sql`, `0070_pecr_marketing.sql`, `0071_pecr_breach_5a.sql`; `lib/pecr/statutory.ts`, `lib/pecr/marketing.ts`; `services/storage-inventory.ts`, `services/marketing.ts` | Irish variants beside them                                                                                                   |
| Law-gated guidance and nav              | the `ukLaw` flag on steps in `lib/guidance/steps.ts` and on items in `lib/nav.ts`                                                                                                                                                    | An `eprivacy` gate for the cookie and marketing steps and pages                                                              |
| The context export                      | `services/export.ts`, contract in `docs/integration-api.md` (context version 1.3)                                                                                                                                                    | `entities[].ieEprivacy` in 1.4                                                                                               |

## Where Govern already stands

- **Law gating.** An entity is subject to UK law, EU law or both (`entity.data_protection_law`,
  `lib/dpa2018/applies.ts`). The PECR settings follow UK law: `setPublicCommsProvider`
  refuses on an EU-only entity (`services/entities.ts`, `ukLawOnly`). The EU GDPR plan
  left ePrivacy out of scope: PECR stays UK only, and an EU-only entity is not offered
  the PECR registers.
- **Cookies and similar technologies** (`/app/cookies`): `digital_property`,
  `storage_item`, `storage_decision`, `consent_scan`, with Consent Analyser reports as
  input. The basis set is PECR regulation 6 with Schedule A1: consent, transmission,
  strictly necessary, statistics, appearance and function, and emergency
  (`lib/pecr/statutory.ts`). The analyser is already called with `region: 'uk' | 'eu'`
  (`lib/pecr/analyser-client.ts`).
- **Electronic marketing** (`/app/marketing`): `marketing_activity` and
  `marketing_decision`, channels `email | sms | live_call | automated_call`, recipients
  `individuals | businesses | both`, and bases consent, soft opt-in, charity soft
  opt-in, corporate subscribers only, screened against the TPS and CTPS, and none. A TPS
  screening holds for 28 days (`lib/pecr/marketing.ts`). Upheld marketing objections in
  the request register count against the activity.
- **Breach by a communications provider**: `entity.public_comms_provider` and
  `breach.pecr_service_breach` run PECR regulation 5A beside Article 33, as decision
  kinds `pecr_commissioner` and `pecr_subscribers` (`lib/breach/statutory.ts`).
- **Authorities**: the shared library has `ie-dpc` (the Data Protection Commission).
- Nothing in Govern names S.I. 336/2011 today.

## The law, as checked

Checked on 12 November 2026 at irishstatutebook.ie: the S.I. as made
(`/eli/2011/si/336/made/en/print`), the Legislation Directory entry for S.I. 336/2011
(updated to 3 November 2026), and each instrument it lists. **The Law Reform Commission
publishes no revised version of this S.I.** (the statute book shows "No Revised SI
available"), so the reading "as amended" below is a consolidation made for this plan,
and Phase 0 has it read again by a person before any rule is coded.

### Amending instruments

| Instrument                                                                                         | In force                                                                  | What it changed                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data Protection Act 2018 (No. 7 of 2018), ss. 9, 14(2) and (4), 165, 166                           | 25 May 2018, the establishment day (S.I. No. 175 of 2018, made under s.9) | No textual change. References to the Data Protection Commissioner are read as the Data Protection Commission (s.14(2)), and references to personal data and processing reach the GDPR (ss.165, 166).                                                                                                                                                                                                                                                   |
| S.I. No. 347 of 2019, ePrivacy (Amendment) Regulations 2019                                        | Notice published 19 July 2019                                             | Reg 2: substituted the definition of "operator" (who keeps the National Directory Database). Itself revoked by S.I. 444/2022, reg 112(6).                                                                                                                                                                                                                                                                                                              |
| S.I. No. 444 of 2022, European Union (Electronic Communications Code) Regulations 2022, reg 112(1) | 9 June 2023 (date fixed by S.I. No. 300 of 2023)                          | Reg 2: definitions now come from the Electronic Communications Code Regulations, not the revoked Framework Regulations; "National Directory Database" and "operator" substituted. Reg 10(b): any other emergency number ComReg specifies. Reg 12 (directories) substituted, now on providers of number-based interpersonal communications services. Reg 14 (the National Directory Database): the same providers. Regs 29 and 30: "or provider" added. |
| S.I. No. 305 of 2023, ePrivacy (Amendment) Regulations 2023                                        | 9 June 2023                                                               | Reg 20: deemed residence of companies for service of notices (new 20(2)). Reg 30(5) substituted and 30(5A) inserted (ComReg directions). Reg 30(6) and Reg 31 deleted (ComReg's High Court route to compliance orders and financial penalties). Reg 32 substituted: ComReg decisions are appealed to the High Court within 28 days.                                                                                                                    |

One instrument acts on S.I. 336/2011 without amending its text, so the statute book
does not list it as an amendment: **S.I. No. 304 of 2023**, the Communications
Regulation and Digital Hub Development Agency (Amendment) Act 2023 (Regulatory
Provisions) Regulations 2023, in operation from 10 June 2023. Made under s.60(1)(d) of
the 2023 Act (No. 4 of 2023), its reg 2(a) makes Regs 7 to 15, 29 and 30 of S.I.
336/2011 "regulatory provisions" for Part 7 of that Act, so ComReg's administrative
sanctions reach them (see "Enforcement, as settled" below). Regs 4, 5 and 6 are not
among them.

**The substantive rules this plan builds on (Regs 4, 5 and 13, the offences and the
penalties) have not been amended since 2011.** The amendments touch definitions,
directories, the National Directory Database and ComReg's procedures. Nothing is listed
for 2024 to 2026.

Two consequences of S.I. 444/2022 matter here. Reg 2 now takes "electronic
communications service" from the Electronic Communications Code Regulations, which
include interpersonal communications services, so the provider duties in Regs 4 to 9 in
principle reach messaging services that do not use numbers. That is a reading of the
definitions, not a stated rule, and Phase 0 records it as such. The EU ePrivacy
Regulation proposal (COM(2017)10) was withdrawn (OJ C/2025/5423, 6 October 2025), so
the Directive, and this S.I., remain the law. The Digital Omnibus proposal (2025/0360(COD))
would rewrite the cookie rule; it is not law and is out of scope until adopted.

### What each regulation requires, as amended

- **Reg 2**: "electronic mail" includes SMS. There is no "individual" or "corporate
  subscriber": Reg 13 distinguishes a subscriber or user who is a natural person from
  one who is not. Consent is consent in the data protection sense. Reg 13(18) treats
  phone numbers and email addresses as personal data for Reg 13.
- **Reg 3**: applies to processing in connection with publicly available electronic
  communications services in public networks in the State.
- **Reg 4** (providers of a publicly available network or service): security measures
  and a security policy (4(1)-(2)); tell subscribers of a particular network risk (4(4));
  on a personal data breach, notify the Data Protection Commission without undue delay,
  and the subscriber or individual where the breach is likely to adversely affect their
  data or privacy (4(6)), unless the provider shows the Commission the data was
  unintelligible (4(7)); keep an inventory of breaches with their facts, effects and
  remedial action (4(12)). Commission Regulation (EU) No 611/2013 applies directly: the
  authority is notified within 24 hours of detection where feasible, with a second
  notice within three days if information was missing (Art 2), and subscribers without
  undue delay (Art 3). The Commission has a separate form for telecoms and ISP breaches.
- **Reg 5**: confidentiality of communications (5(1)-(2)), and the cookie rule. Storing
  or accessing information on terminal equipment needs consent and clear and
  comprehensive information about the purposes (5(3)), with browser settings acceptable
  where technically possible and effective (5(4)). The only exemptions (5(5)) are the
  sole purpose of carrying out a transmission, and what is strictly necessary to
  provide a service the subscriber or user explicitly requested.
- **Regs 6 to 12** (providers): traffic data erased or anonymised, used for marketing
  the provider's services only with consent (6); itemised billing (7); calling and
  connected line identification (8); location data only anonymised or with consent (9);
  exceptions for malicious calls and emergencies (10); automatic call forwarding (11);
  directories (12).
- **Reg 13**: unsolicited direct marketing. Each message or call is a separate offence
  (13(13)(b)), and the defendant has to prove the recipient unambiguously consented
  (13(14)).
  - Automated calls, fax and electronic mail (email and SMS) to a natural person need
    consent (13(1)).
  - Email to an address that reasonably appears to be used mainly for the person's
    business, about that business only, is outside 13(1) and only needs to respect an
    objection (13(2) with 13(4)).
  - Automated calls and fax to a subscriber that is not a natural person: not if it
    objected or is opted out in the National Directory Database (13(3)).
  - Email to a subscriber that is not a natural person: not if it said it does not
    consent (13(4)).
  - Live calls: not to a person who objected, or to a number opted out in the National
    Directory Database (13(5)). To a **mobile**, only with consent, given to the caller
    or recorded in the National Directory Database (13(6)).
  - An SMS sent for another purpose may not carry marketing without consent (13(7)).
  - Objections are free (13(8)), and a National Directory Database opt-out binds after
    28 days (13(9)).
  - Calls give the caller's name; automated calls and faxes the name, address and
    number; email a valid contact address (13(10)). Email must not conceal the
    sender, and must give a valid opt-out address (13(12)).
  - The soft opt-in (13(11)): details obtained in the sale of a product or service,
    used for the seller's own similar products or services, with a clear, free and easy
    chance to object at collection and in every message, and the sale **not more than
    12 months** before the message (or the details used for marketing within that
    period).
- **Reg 14**: the National Directory Database. Providers record subscribers' refusal of
  marketing calls, automated calls and faxes; marketers may access it for a fee ComReg
  approves. ComReg's consumer page says the database has been run by PXS since 1 July
  2024 (Decision D19/24), that landlines opt out on request and mobiles are opted out
  by default.
- **Reg 16**: where a law restricts these rights under Article 15(1) of the
  Directive, providers keep procedures for answering requests for access to users'
  personal data, such as those from the authorities, and report on them to the
  Commission within 28 days of being asked (16(1)). It is not about subject access
  requests. Also a civil right to damages for any breach (16(2)), with a
  reasonable-care defence (16(3)).
- **Regs 17 to 28**: the Data Protection Commission investigates, serves enforcement
  notices on Regs 4, 5, 6, 9, 12, 13, 14 and 16(1), serves information notices, and
  prosecutes summary offences itself (Reg 26). Appeals go to the Circuit Court within 21
  days. Irish law gives the Commission this competence expressly: Reg 17(1) and (11)
  and Reg 26, read with the Data Protection Act 2018, s.14(2). Officers are liable where an offence was committed with their consent,
  connivance or neglect (Reg 25).
- **Penalties**: a class A fine (up to €5,000, Fines Act 2010 s.3) on summary
  conviction; on indictment up to €250,000 for a body corporate and €50,000 for a
  natural person, for Reg 13 offences (13(15)) and for Reg 4(1) and 4(6) (4(14)). Reg 5
  is not itself an offence: it is enforced by notice, and breaching a notice is. Courts
  may order data forfeited or destroyed.
- **Regs 29 to 33**: ComReg monitors Regs 7 to 15 and issues directions, subject to
  the Commission's functions under Reg 17 (Reg 30(1)); it may specify, with the
  Commission, the form of obtaining, recording and rescinding consent (Reg 30(1)), and
  has issued no such rules. The two cooperate (Reg 33). Since 10 June 2023, Regs 7 to
  15, 29 and 30 are also enforced through Part 7 of the 2023 Act (S.I. 304/2023).

### Settled on 12 November 2026

The six points the first draft could not confirm were answered by the user and checked
against the sources below.

1. **ComReg's administrative sanctions reach part of S.I. 336/2011.** S.I. No. 304 of
   2023, reg 2(a), prescribes Regs 7 to 15, 29 and 30 as regulatory provisions for Part
   7 of the 2023 Act. Under Part 7 ComReg can agree a resolution (s.62), serve a notice
   of suspected non-compliance (s.63), accept commitments (s.67) and refer a case to an
   adjudicator, who decides on the balance of probabilities (s.90(2)) and may impose
   administrative sanctions (s.91), confirmed by the High Court (s.109). S.I. No. 305 of
   2023 removed ComReg's older High Court route (Reg 31) and rewrote appeals (Reg 32).
   Regs 4, 5 and 6 are not prescribed, so security, breach notification, cookies and
   traffic data stay with the Data Protection Commission.
2. **Time limits.** For ComReg's Part 7 steps there is none: s.115 of the 2023 Act lets
   a notice of suspected non-compliance, a supplementary notice or an urgent interim
   measures notice be served, and a referral under s.68(3)(c) or s.71 be made, "at any
   time", notwithstanding the Statute of Limitations 1957 (other than s.11A) and the
   Statute of Limitations (Amendment) Act 1991. Section 115 does not cover the
   Commission's own summary prosecutions under Reg 26; see the open items below.
3. **The Commission's cookie guidance** (Guidance note on cookies and other tracking
   technologies, April 2020) has been read; the points Govern will use are in
   "Phase 1: what the cookie guidance adds".
4. **Consent records.** ComReg has issued no general rules under Reg 30(1) on obtaining,
   recording and rescinding consent. The Commission's guidance is what applies.
5. **The establishment day** of the Data Protection Act 2018 is 25 May 2018: the Data
   Protection Act 2018 (Establishment Day) Order 2018, S.I. No. 175 of 2018, art. 2,
   made under s.9 of the Act.
6. **No one-stop shop for the Irish Regulations.** EDPB Opinion 5/2019 on the interplay
   between the ePrivacy Directive and the GDPR (adopted 12 March 2019), paragraph 80:
   the GDPR's cooperation and consistency mechanisms concern the GDPR, and "do not apply
   to the enforcement of the provisions contained in the ePrivacy Directive as such". A
   data protection authority enforces national ePrivacy rules only where national law
   gives it that competence (paragraphs 66 to 69). Irish law does: Reg 17(1) and (11)
   and Reg 26 of S.I. 336/2011, with the Data Protection Act 2018, s.14(2). The
   Commission's own guidance note says the same (page 2). So the Commission is
   competent for S.I. 336/2011 whatever an entity's GDPR lead authority, and
   Article 95 GDPR keeps a provider's breach duty from being duplicated.

### Enforcement, as settled

The marketing rules (Reg 13) and the National Directory Database (Reg 14) now have
**two routes, side by side**; neither replaces the other.

- **The Commission's route survives unchanged.** Neither S.I. 304/2023 nor S.I. 305/2023
  touches Regs 17 to 28, so the Commission still serves enforcement notices on Regs 13
  and 14 and prosecutes their offences summarily (Reg 26), with the per-message offence
  (13(13)(b)) and the penalties in 13(15). ComReg's monitoring is "subject to" the
  Commission's Reg 17 functions (Reg 30(1)).
- **ComReg's Part 7 route sits beside it.** Where the breach is also a criminal offence,
  as every Reg 13 breach is, ComReg may serve a notice of suspected non-compliance only
  where the offence is one ComReg may prosecute summarily and it has elected not to, or
  the matter was referred to the Director of Public Prosecutions and no proceedings
  were commenced (2023 Act, s.63(3)). ComReg cannot prosecute summarily (answer 1
  below), so for these offences it is always the second. Once an adjudicator finds the breach, the person
  may not be prosecuted for the offence it constitutes (s.90(3)).
- **Cookies, security and breach notification (Regs 4 to 6)** have only the
  Commission's route.

### Answered by the user, 12 November 2026

1. **ComReg cannot prosecute S.I. 336/2011 offences summarily.** For a breach that is
   also an offence it must refer the matter to the Director of Public Prosecutions, so
   only s.63(3)(b) of the 2023 Act opens its Part 7 route for a Reg 13 breach.
2. **There is no published memorandum of understanding between the Commission and
   ComReg** for S.I. 336/2011. Under Reg 33 they divide the work functionally,
   coordinated through Ireland's Digital Regulators Group:
   - **marketing (Reg 13)** is the Commission's, except where it meets telecoms
     infrastructure or numbering rules, such as nuisance-call mitigation, spoofing and
     line identification under Reg 8, or a regulated provider's systemic breach of a
     ComReg direction, which is ComReg's;
   - **the National Directory Database (Reg 14)**: recording preferences and running
     the database is ComReg's; failing to screen a marketing list against it is the
     Commission's.
3. **Time limits for prosecution.** The Commission must apply to the District Court for
   a summons within six months of the offence, under s.10(4) of the Petty Sessions
   (Ireland) Act 1851, which applies by default. There is no time limit for a
   prosecution on indictment by the Director of Public Prosecutions.

What follows in Govern: an Irish marketing gap names the Commission as its regulator,
and ComReg only for the telecoms cases above; a gap about National Directory Database
screening names the Commission. The help gives the six-month limit for the Commission's
summary prosecutions, and says ComReg's Part 7 steps (s.115) and prosecutions on
indictment have none.

## The entity flag

`entity.ie_eprivacy`, nullable boolean: **the entity is subject to S.I. 336/2011.** Null
means nobody has answered, which counts as no, so the suggestion below can go away once
someone answers either way (built in Phase 0 that way, rather than default false).
Declared beside the data protection law when an entity is created, and on the
Organisation page.

- **Why a separate flag, not derived from EU law.** The S.I. reaches whoever stores
  information on an Irish user's device or markets to Irish subscribers, and providers
  of services in the State. An entity under the EU GDPR with no Irish users is not
  subject to it; whether one is depends on facts Govern does not hold. So it is
  declared, like the lead authority (EU decision 4).
- **Within EU law.** Recommended: allowed only where EU law applies to the entity,
  refused otherwise in the way `ukLawOnly` refuses the UK settings, and narrowing the
  entity to UK law refused while the flag is on (decision 2). Its consent is GDPR
  consent, and anything marketing to or tracking people in Ireland is almost always
  within EU GDPR Article 3(2).
- **Suggested, not set.** The Organisation page suggests it, as a gap to answer rather
  than a value to accept, where the entity is established in Ireland
  (`eu_establishments` includes `IE`) or its lead authority is `ie-dpc`. A person
  records the answer (decision 3).
- **Backfill.** Entities under UK law only get false, since the Regulations cannot apply
  to them; entities under EU law stay unanswered. No entity is subject to them by
  migration: the suggestion above shows on the Organisation page for those it fits, and
  the setup guidance asks the question for every entity under EU law.
- **Audit.** `entity.ie_eprivacy_changed`, with before and after.
- **PECR is unchanged.** PECR still follows UK law. A dual entity can be under PECR,
  S.I. 336/2011, both or neither: the two flags are independent, because a UK group
  with an Irish subsidiary is under each for different properties and campaigns.

### `public_comms_provider` becomes law-neutral

Today it is refused unless UK law applies. It becomes allowed where UK law applies or
`ie_eprivacy` is on, and its meaning becomes "a provider of a publicly available
electronic communications service under PECR, S.I. 336/2011, or both". Narrowing either
law away is refused while it depends on it. Its existing audit action is kept.

## Per-record scope

Following the EU plan's principle (EU decision 1: one record with an answer per law),
each cookie property and marketing activity says which ePrivacy laws govern it, within
its entity's.

`EprivacyScope = 'uk' | 'ie' | 'uk_ie'`, on `digital_property.eprivacy_scope` and
`marketing_activity.eprivacy_scope`, defaulted from the entity (UK where UK law applies,
plus IE where `ie_eprivacy` is on). A UK campaign by a dual group is `uk`; a website
serving both markets is `uk_ie`. One outside the entity's laws is refused, as a record's
data protection laws are. A record whose entity is under neither ePrivacy law is not
offered the registers, which also closes the gap left in the EU plan, where the cookie
and marketing pages still appear for an EU-only organisation.

## Regulation by regulation, against Govern's PECR features

| S.I. 336/2011                                                                                            | PECR feature today                                                 | Plan                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reg 5(3)-(5) cookies and terminal equipment                                                              | Cookie register, PECR reg 6 and Sch A1 bases                       | **Irish variant.** The same register, inventory, scans and proposals; a second basis set with consent, transmission and strictly necessary only. Statistics, appearance and function, and emergency do not exist in Irish law. A decision is recorded per law (`storage_decision.law`).                                                                                         |
| Reg 5(1)-(2) confidentiality of communications                                                           | None                                                               | **Not built.** A provider's operational duty; covered in help.                                                                                                                                                                                                                                                                                                                  |
| Reg 4(1)-(4) security of services                                                                        | None (PECR reg 5 is not modelled either)                           | **New, small.** A provider checklist template (security policy, access control, risk notice to subscribers), offered to providers under either law. Phase 4, and only if decision 7 says so.                                                                                                                                                                                    |
| Reg 4(6)-(9) breach notification by providers                                                            | PECR reg 5A obligations and clock                                  | **Irish variant.** New obligations for a provider under S.I. 336/2011: the Commission within 24 hours of detection where feasible, a second notice within three days if incomplete (Reg 611/2013 Art 2), subscribers without undue delay where likely to adversely affect them, unless the Commission accepts the data was unintelligible (4(7)). No risk test, as with reg 5A. |
| Reg 4(12) breach inventory                                                                               | The breach register                                                | **Reused.** The register already holds facts, effects and remedial action; the export gains a filter for Irish provider breaches so the inventory can be produced on request.                                                                                                                                                                                                   |
| Regs 6, 7, 8, 9, 11, 12 traffic and location data, billing, line identification, forwarding, directories | None                                                               | **Not built** as registers (decision 7). Traffic or location data used for marketing or value-added services is a processing activity: the ROPA gains a help note, not a field.                                                                                                                                                                                                 |
| Reg 13(1), (2), (4), (11) email and SMS                                                                  | Marketing bases: consent, soft opt-in, corporate subscribers       | **Irish variant.** Consent; soft opt-in with the 12-month rule as a condition; business email address of a natural person (13(2)); non-natural persons who have not objected (13(4)). No charity soft opt-in.                                                                                                                                                                   |
| Reg 13(1), (3) automated calls and fax                                                                   | Automated calls: consent                                           | **Irish variant**, and fax becomes a channel (decision 5). Natural persons: consent. Non-natural persons: no objection and not opted out in the National Directory Database.                                                                                                                                                                                                    |
| Reg 13(5), (6) live calls                                                                                | Screened against the TPS and CTPS                                  | **Irish variant.** Landlines: screened against the National Directory Database and no objection. Mobiles: consent, given to the caller or recorded in the database. Calls are split by number type (`call_numbers: landline / mobile / both`), asked only under Irish scope.                                                                                                    |
| Reg 13(7) marketing in a service SMS                                                                     | None                                                               | **New gap question** on SMS activities under Irish scope.                                                                                                                                                                                                                                                                                                                       |
| Reg 13(10), (12) identity and opt-out address                                                            | PECR reg 23 condition                                              | **Reused**, with the Irish citations; calls add the caller's name, automated calls and faxes the address and number.                                                                                                                                                                                                                                                            |
| Reg 13(14) burden of proving consent                                                                     | Consent condition "when and how each person consented is recorded" | **Reused**, and its gap is raised to serious under Irish scope, because without the record there is no defence to a per-message offence.                                                                                                                                                                                                                                        |
| Reg 14 National Directory Database                                                                       | TPS screening, 28 days                                             | **Irish variant.** `marketing_activity.ndd_screened_at` with the same 28-day staleness, because an opt-out binds after 28 days (13(9)). Audit `marketing.ndd_screened`.                                                                                                                                                                                                         |
| Regs 17-28, 13(15), 4(14) enforcement and penalties; 2023 Act Part 7 for Regs 7-15                       | Help text only                                                     | **Help and gap words**, not a calculator. Each Irish marketing gap says the act is an offence for each message, and that ComReg may also take it to an adjudicator for an administrative sanction.                                                                                                                                                                              |

## Which body regulates what

- **The Data Protection Commission**: enforces Regs 4, 5, 6, 9, 12, 13, 14 and 16(1)
  by notice (Reg 17), receives provider breach notifications (on its telecoms and ISP
  form, separate from the GDPR form), receives marketing and cookie complaints, and
  prosecutes summarily (Reg 26). Competent whatever an entity's GDPR lead authority
  (EDPB Opinion 5/2019, paragraph 80).
- **ComReg**: monitors Regs 7 to 15, issues directions (Regs 29, 30), approves National
  Directory Database fees and requires someone to keep it. Since 10 June 2023 it can
  also take a breach of Regs 7 to 15, 29 or 30 through Part 7 of the 2023 Act, to an
  adjudicator who may impose administrative sanctions (S.I. 304/2023). Not a complaints
  route for marketing.
- **The courts**: the District Court hears the Commission's summary prosecutions; the
  Circuit Court hears appeals against its notices; the High Court hears appeals against
  ComReg (Reg 32) and confirms adjudications (2023 Act, s.109); any court may award
  damages under Reg 16(2).

What follows in Govern:

- **Breach.** An Irish provider obligation names the Data Protection Commission and its
  telecoms form. The `ie-dpc` entry in `lib/gdpr/authorities.ts` gains an
  `eprivacyBreachUrl`. Article 33 still runs beside it under the entity's lead
  authority, which may not be the Commission; the ePrivacy notice goes to the
  Commission regardless (settled point 6).
- **Complaints and objections.** There is no Irish duty like s.164A, so no new
  complaints register. A marketing objection is recorded in the request register as
  today and counts against the activity; under Irish scope the help says it must be
  free (13(8)).
- **Public form.** Where the entity is under S.I. 336/2011, the form's regulator line
  adds that marketing and cookie complaints go to the Data Protection Commission.
- **Exports.** Each Irish decision carries its citation and the regulator it answers to.

## Where Irish law and PECR differ

| Difference          | PECR                                                                                           | S.I. 336/2011                                                                                                                                                                                                                                                                                             | UI                                                                                                                                | Help                                     | Exports                                                |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| Cookie exceptions   | Statistics, appearance and function, emergency without consent (Sch A1)                        | Consent, or transmission or strictly necessary only                                                                                                                                                                                                                                                       | Irish basis list has three options; a `uk_ie` property shows a decision per law, and an item on statistics is flagged for Ireland | Cookies topic gains an Irish section     | One row per item and law                               |
| Soft opt-in         | No time limit; charity soft opt-in since February 2026                                         | 12 months from the sale; no charity version                                                                                                                                                                                                                                                               | 12-month condition with the sale date; the charity basis is not offered                                                           | Marketing topic, Irish section           | Basis and condition per law                            |
| Business recipients | "Corporate subscribers" are outside reg 22; sole traders and some partnerships are individuals | Non-natural persons may be emailed unless they object; a natural person's business address too, about that business only                                                                                                                                                                                  | Irish bases name both cases; recipients gain "business email address of a person" under Irish scope                               | Explains the natural person line         | Basis per law                                          |
| Calls               | TPS and CTPS screening, mobiles included                                                       | National Directory Database; mobiles need consent                                                                                                                                                                                                                                                         | Number type asked; NDD screening date; mobile calls without consent flagged                                                       | Explains the opt-in for mobiles          | NDD date beside TPS date                               |
| Fax                 | Reg 20 (not modelled)                                                                          | 13(1), (3)                                                                                                                                                                                                                                                                                                | Fax channel (decision 5)                                                                                                          | Short note                               | Channel column                                         |
| Provider breach     | Information Commission, 72 hours where feasible                                                | Data Protection Commission, 24 hours where feasible, second notice in three days                                                                                                                                                                                                                          | A second clock on the breach page, its own decision kinds                                                                         | Breaches topic, provider section         | Obligation per law                                     |
| Enforcement         | Monetary penalty notices from the Information Commission                                       | Cookies, security and breaches: the Commission's notices and prosecution only. Marketing and the NDD: prosecution per message by the Commission, and ComReg's administrative sanctions through an adjudicator (2023 Act Part 7), not both for the same breach (s.90(3)). Officer liability; civil damages | Gap words say "an offence for each message", and for marketing that ComReg may also seek an administrative sanction               | Enforcement paragraph naming both routes | Citation on each gap, and the regulator for each route |

## Data model

| Change                                                                           | Detail                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity.ie_eprivacy`                                                             | nullable boolean; null is unanswered (built in Phase 0)                                                                                     |
| `entity.public_comms_provider`                                                   | unchanged column; the guard widens (above)                                                                                                  |
| `digital_property.eprivacy_scope`, `marketing_activity.eprivacy_scope`           | text not null, `uk / ie / uk_ie`, backfilled to `uk` for existing rows (every existing row was made under PECR)                             |
| `storage_decision.law`, `marketing_decision.law`                                 | text not null `uk / ie`, backfilled `uk`; the "current decision" uniqueness gains the law                                                   |
| `marketing_activity.ndd_screened_at`, `marketing_activity.call_numbers`          | timestamp; text `landline / mobile / both`, nullable                                                                                        |
| `marketing_channel` enum                                                         | `fax` added (decision 5)                                                                                                                    |
| `breach.pecr_service_breach`                                                     | renamed `comms_service_breach`; it asks the same question under either law                                                                  |
| `breach_decision_kind` enum                                                      | `ie_eprivacy_commission`, `ie_eprivacy_subscribers`                                                                                         |
| `lib/gdpr/authorities.ts`                                                        | `eprivacyBreachUrl` on the `ie-dpc` entry (code, no migration)                                                                              |
| `digital_property.consent_renewal_months`, `consent_renewal_justification`       | Phase 1: how long stored consent lasts; over six months needs the justification (cookie guidance pages 8 and 11)                            |
| `organisation.cookie_lifespan_threshold_months`, `cookie_lifespan_justification` | Phase 1: default 12 months beyond the session (decision 11); a change needs the justification, audited as `pecr.lifespan_threshold_changed` |

- **Pure modules.** `lib/ie-eprivacy/storage.ts` (the Reg 5 basis set and gaps),
  `lib/ie-eprivacy/marketing.ts` (Reg 13 bases, conditions, the 12-month rule, mobile
  consent, NDD staleness), and Irish obligations and the 24-hour clock in
  `lib/breach/statutory.ts`. The PECR modules are untouched; the services pick the set
  by law, so each rule is in one place.
- **RLS.** No new tables. Every changed table already carries `organisation_id` and its
  `tenant_isolation` policy; the migration adds columns only. The authority library is
  code, not a table, so it needs no policy.
- **Audit.** `entity.ie_eprivacy_changed`; `pecr.basis_decided` and
  `marketing.basis_decided` gain `law` in their payloads (actions unchanged, so filters
  and exports keep working); `marketing.ndd_screened`; breach decisions as today with
  the new kinds.
- **Integration API.** The context export gains `entities[].ieEprivacy`; no ingest
  change. Contract first, as before.

## Help, guidance and tests

- **Help.** New topic `ie-eprivacy` ("Irish ePrivacy Regulations") in the "The
  registers" group of `HELP_GROUPS`, covering scope, the regulators, enforcement and how
  Govern records each rule. Irish sections in `cookies`, `marketing`, `breaches` and
  `organisation`. `pnpm help:md` regenerates `docs/help.md`.
- **Guidance.** The setup step on entities asks the Irish question for entities under
  EU law; the cookies and marketing steps show where either ePrivacy law applies.
- **Tests** (`node:test` against the database, one organisation per file):
  - pure: the Irish cookie bases, and statistics flagged under `ie`; the soft opt-in
    12-month boundary on both sides; mobile calls without consent; NDD staleness at 28
    days; business-address email; the 24-hour clock and the second notice;
  - services: the flag refused off EU law; narrowing refused while it or a provider
    depends on it; scope refused outside the entity's laws; a `uk_ie` property holding
    one decision per law; audit events written in the same transaction;
  - tenant isolation entries for every new service function;
  - the help test (every topic in a group) and the wording lint (no em dashes).

## Phases

One PR per phase, each from `main`.

| Phase | Scope                                                                                                                                                                                                                        | Size           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 0     | **Law, flag and scope.** (Built: PR #43.) `entity.ie_eprivacy`, its guard, suggestion and audit; `eprivacy_scope` on properties and activities; the registers hidden where neither law applies; the help topic and guidance. | about 1.5 days |
| 1     | **Cookies.** The Irish basis set, decisions per law, gaps, the analyser's EU region for Irish properties, the points from the Commission's guidance below, help and export.                                                  | about 2 days   |
| 2     | **Marketing.** Irish bases and conditions, the 12-month rule, number type, NDD screening and the sweep reminder, fax, the service-SMS question, help and export.                                                             | about 2.5 days |
| 3     | **Provider breaches.** The law-neutral provider flag, the Irish obligations and 24-hour clock, the Commission's form, the inventory filter.                                                                                  | about 1.5 days |
| 4     | **Exports, Integration API and copy.** The context export, the public form line, the provider checklist template if decision 7 asks for it.                                                                                  | about 1 day    |

### Phase 1: what the cookie guidance adds

From the Data Protection Commission's Guidance note on cookies and other tracking
technologies (April 2020). Page numbers are the note's own.

| Point                                                                                                                                                                                          | Where                                                                                      | In Govern                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent is needed for anything outside the two Reg 5(5) exemptions, whatever the cookie is called and whether or not it holds personal data                                                    | pages 5, 6 and 11 ("Consent"; "Which cookies are exempt"; "Pre-checked boxes and sliders") | The Irish basis set has three options; a category label from the analyser never sets the basis                                                       |
| The communications exemption is narrow: speeding up or regulating transmission is not enough (load balancing qualifies)                                                                        | page 6                                                                                     | Help on the transmission basis; its condition asks for the sole purpose                                                                              |
| Strictly necessary needs a service the user explicitly asked for; advertising never qualifies; a chatbot's cookies wait until the chat is opened; a long-lived preference cookie needs consent | pages 6 and 7                                                                              | Conditions on the strictly necessary basis, with these examples in help                                                                              |
| Analytics cookies need consent; first-party analytics are "unlikely" to be an enforcement priority                                                                                             | pages 7 and 8                                                                              | An analytics item on strictly necessary is a gap under Irish scope (decision 10 on how it is worded)                                                 |
| Device fingerprinting, pixels, SDKs and local storage are covered as cookies are                                                                                                               | pages 4 and 7                                                                              | Every analyser item kind is in scope, as now                                                                                                         |
| No bundled consent, one consent per purpose, no pre-ticked boxes or sliders set to on                                                                                                          | pages 8 and 10                                                                             | Property questions, as gaps where answered no                                                                                                        |
| Withdrawing consent must be as easy as giving it                                                                                                                                               | pages 8 and 11                                                                             | Property question                                                                                                                                    |
| **Consent must be asked for again at most six months after it was stored**, unless a longer period is justified case by case                                                                   | page 8 (footnote 2) and page 11 (footnote 3)                                               | **Missed by the first draft.** New `digital_property.consent_renewal_months`; a gap where it is over six months with no justification recorded       |
| An accept button needs a reject (or manage) option of equal prominence; an accept-only banner is not compliant                                                                                 | pages 9 and 12                                                                             | Property questions from the analyser report where it says, else asked                                                                                |
| Scrolling or carrying on is not consent; a banner that disappears on scroll is not compliant                                                                                                   | pages 9 and 10                                                                             | Property question                                                                                                                                    |
| The cookie and privacy policies must be readable with no non-exempt cookie set, and the banner must not obscure them                                                                           | page 12                                                                                    | Property question                                                                                                                                    |
| Browser settings are generally not consent                                                                                                                                                     | pages 12 and 13                                                                            | Help; not offered as a basis                                                                                                                         |
| A cookie's lifespan must be proportionate to its purpose                                                                                                                                       | pages 3 and 13                                                                             | **Missed by the first draft.** A gap where an item's expiry (from the analyser) is long for a strictly necessary basis; the threshold is decision 11 |
| Keep a record of consent, as part of the Article 30 record, backed by measures that act on it                                                                                                  | pages 9, 11 and 14                                                                         | The property links to its processing activity; a gap where it has none                                                                               |
| Location tracking needs consent; special category data from cookies in practice needs explicit consent; the DPC's mandatory DPIA list covers tracking and large-scale profiling                | pages 15 and 16                                                                            | Help, with links to the ROPA and DPIA screening                                                                                                      |

## Out of scope

- Regs 6 to 12 as registers (traffic and location data, billing, line identification,
  forwarding, directories): provider operations, not records Govern keeps.
- Other member States' ePrivacy laws. The model (`eprivacy_scope`) can take more values
  later; each needs its own reading.
- The Digital Omnibus changes to the cookie rule, until adopted.
- Deciding whether the S.I. applies to an entity, or any basis: Govern suggests and a
  person records, as elsewhere.

## Decisions

Decisions 1 to 4, 10 and 11 were confirmed by the user on 12 November 2026. Decisions
5 to 9 are still open.

1. **Build it as a second ePrivacy law beside PECR, one record with a decision per law.**
   _Decided:_ as recommended. _Recommendation:_ yes, following EU decision 1. The alternative, separate Irish
   registers, would duplicate the inventory and scans that both laws read.
2. **Allow the flag only where EU law applies to the entity.** _Decided:_ as
   recommended. _Recommendation:_ yes.
   The alternative is to allow it on a UK-only entity, which is possible in law but
   almost never true in fact, and would let consent be judged without the EU GDPR.
3. **Suggest the flag from an Irish establishment or the DPC as lead authority, never
   set it.** _Decided:_ as recommended. _Recommendation:_ suggest only, as with the lead authority (EU decision 4).
4. **Hide the cookie and marketing registers where neither ePrivacy law applies.**
   _Decided:_ as recommended. _Recommendation:_ yes. This also hides PECR registers from EU-only organisations,
   which the EU plan intended but did not build.
5. **Add fax as a marketing channel for both laws.** _Recommendation:_ yes, as both
   PECR (reg 20) and the S.I. (13(1), (3)) regulate it; or leave fax out and say so in
   help.
6. **Raise the missing consent record to a serious gap under Irish scope.**
   _Recommendation:_ yes, because the defendant bears the burden of proof for each
   message (13(14)).
7. **Provider duties beyond breach (security of services, traffic and location data).**
   _Recommendation:_ a checklist template in Phase 4, no registers. The alternative is
   help text only.
8. **Make `public_comms_provider` law-neutral rather than adding an Irish provider
   flag.** _Recommendation:_ yes: it is the same fact about the entity under either law.
9. **Scope and order.** _Recommendation:_ Phases 0 to 2 first, as cookies and marketing
   are what most entities need; Phase 3 only once a provider client needs it.
10. **First-party analytics under Irish scope.** The Commission says they need consent
    but are unlikely to be an enforcement priority (guidance pages 7 and 8).
    _Decided:_ flag them as a gap like any other analytics item, with the Commission's
    own words beside it, rather than lowering the gap.
11. **How long is too long for a strictly necessary cookie.** The guidance asks for
    proportionate lifespans but sets no figure. _Decided:_ flag a strictly necessary
    item that outlives the session by more than a year, as a prompt to check rather
    than a breach. The organisation can change the threshold, but only with a specific
    justification recorded in Govern, which is kept and audited with the change.
