# Plan: freedom of information requests, and request forms a client can embed

Status: all decisions settled 9 November 2026, as recommended. Phases 0 to 2 built.

## What is asked for

Two things:

1. **Freedom of information.** A public authority must answer requests for the
   information it holds, on statutory clocks, with exemptions it has to name and
   reasons it has to give. Govern should record each request and the decisions on it
   the way it already records data subject requests, complaints and breaches, and take
   requests through a public web form.
2. **Forms a client can put on its own website.** Both the new FOI form and the
   existing data protection request form should be usable as a link _or_ inside an
   iframe on the client's own site.

Settled with Vincent on 9 November 2026:

- **Regimes:** FOIA 2000 and the EIR 2004 (England, Wales, Northern Ireland and UK-wide
  bodies), **and** Scotland's FOI(S)A 2002 and EI(S)R 2004, in the first version.
- **Embedding:** only on websites listed against each form; everywhere else stays
  blocked.
- **Separate forms:** an FOI form and a data protection request form, each with its
  own address and embed code. The FOI form sends anyone asking for their own personal
  data to the data protection form.

## The law, as checked on legislation.gov.uk

Checked on 9 November 2026. FOIA pages show "no known outstanding effects"; the s.10
text was last revised 30 September 2026.

### Freedom of Information Act 2000

| Provision                                                             | What it requires now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Change                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| s.1                                                                   | Confirm or deny whether the information is held, and communicate it. Information held when the request is received (s.1(4)). Where more is reasonably needed to identify what is wanted, and the applicant has been told, no duty until it arrives (s.1(3)).                                                                                                                                                                                                                                                                                           | None.                                                               |
| s.8                                                                   | A valid request is **in writing** (electronic counts if legible and usable later), gives the applicant's **name** and an **address for correspondence**, and **describes** the information.                                                                                                                                                                                                                                                                                                                                                            | None.                                                               |
| s.9                                                                   | A fees notice may be sent within the s.10 period; no duty unless paid **within 3 months**.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | S.I. 2016/997.                                                      |
| s.10                                                                  | Promptly, and no later than the **20th working day** following receipt. Receipt is the later of the day received and the day the s.1(3) clarification arrives (s.10(6)). Days between a fees notice and payment are disregarded (s.10(2)). **Working day** excludes Saturdays, Sundays, Christmas Day, Good Friday and bank holidays **in any part of the UK**. For the public interest test, time "reasonable in the circumstances" (s.10(3)), but the s.17(1) notice is still due on time. Regulations may extend to the 60th working day (s.10(4)). | "Commission": S.I. 2026/386 with S.I. 2026/1015, 30 September 2026. |
| s.11                                                                  | A stated preference for a copy, inspection or a digest is met so far as reasonably practicable, with reasons if not; datasets in a re-usable form.                                                                                                                                                                                                                                                                                                                                                                                                     | Protection of Freedoms Act 2012, 1 September 2013.                  |
| s.12; S.I. 2004/3244                                                  | No duty where the estimate exceeds **£600** (Schedule 1 Part I bodies) or **£450** (others), at **£25 an hour**, counting only determining whether held, locating, retrieving and extracting. Requests from one person or people acting in concert, for the same or similar information, within **60 consecutive working days**, may be aggregated.                                                                                                                                                                                                    | Figures unchanged since 2004.                                       |
| s.14                                                                  | No duty to comply with a **vexatious** request, or a repeat of one already answered unless a reasonable interval has passed.                                                                                                                                                                                                                                                                                                                                                                                                                           | None.                                                               |
| s.16                                                                  | Advice and assistance, so far as reasonable; following the s.45 code counts as compliance.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | None.                                                               |
| s.17                                                                  | A **refusal notice** within the s.10 time: the exemption and why it applies; where a public interest test is outstanding, that and an estimated date; the s.12/s.14 notices (s.17(5), (6)). **Every** notice gives particulars of the complaints procedure (or says there is none) and of the **s.50 right** to apply to the Commission (s.17(7)).                                                                                                                                                                                                     | None since 2005.                                                    |
| s.40                                                                  | The **requester's own personal data is absolutely exempt** (s.40(1), s.2(3)(f)), with no duty to confirm or deny (s.40(5A)); it is handled as a subject access request. Third-party personal data under s.40(2), first condition absolute.                                                                                                                                                                                                                                                                                                             | DUAA 2025 s.88 (5 September 2025) and s.70 (5 February 2026).       |
| s.45 code (July 2018, minor amendments September 2018, still current) | Real names, not pseudonyms (1.14, 2.7). Public interest extensions normally no more than **20 further working days** (4.6). **Internal review:** requests accepted within **40 working days** of the response (5.3), decided within **20 working days** (5.4), exceptionally a further 20 (5.5).                                                                                                                                                                                                                                                       | "Commission" in s.45(4), 30 September 2026.                         |
| s.50                                                                  | Any complainant may apply to **the Information Commission**, which need not decide where the authority's complaints procedure has not been used.                                                                                                                                                                                                                                                                                                                                                                                                       | "Commission", 30 September 2026.                                    |
| s.77                                                                  | **Offence** to alter, deface, block, erase, destroy or conceal a record to prevent disclosure once a request is made.                                                                                                                                                                                                                                                                                                                                                                                                                                  | "Commission", 30 September 2026.                                    |
| Part II                                                               | Absolute (s.2(3)): ss.21, 23, 32, 34, 36 (Houses of Parliament only), 37(1)(a)–(ab), 40(1), 40(2) first condition, 41, 44. Everything else is qualified and subject to the public interest test.                                                                                                                                                                                                                                                                                                                                                       | —                                                                   |

The regulator is **the Information Commission** for FOIA, and in the EIR's definitions,
from 30 September 2026 (S.I. 2026/386 Sch 2 para 12 and Sch 3 para 8; commenced by S.I.
2026/1015 reg 2(c)). Govern already names it that way for data protection.

### Longer limits (Time for Compliance Regulations)

| Instrument     | Who                                                      | Limit                                                                                       |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| S.I. 2004/3364 | Maintained and MoD schools                               | 20th working day ignoring non-school days, or the 60th working day if earlier               |
| S.I. 2004/3364 | Archives: transferred public records not designated open | **30** working days                                                                         |
| S.I. 2004/3364 | Armed forces operations; information held outside the UK | Not automatic: the Commission sets a day no later than the 60th working day, on application |
| S.I. 2009/1369 | Northern Ireland schools                                 | As for schools                                                                              |
| S.I. 2010/2768 | Academies                                                | As for schools                                                                              |

### Environmental Information Regulations 2004

| Reg   | What it requires now                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2(1)  | Environmental information: the state of the elements; factors affecting them; measures and activities; reports; cost-benefit analyses; and human health, living conditions and cultural sites so far as affected by these. |
| 5     | As soon as possible and **no later than 20 working days**. The applicant's own personal data is excluded (5(3)). **No requirement to be in writing.**                                                                      |
| 7     | Extension to **40 working days** only where **complexity and volume** make 20 impracticable, told within 20.                                                                                                               |
| 8     | Reasonable charges, with a published schedule; inspection free; advance payment pauses the clock.                                                                                                                          |
| 9     | Advice and assistance; a request too general is clarified within 20 working days and the clock restarts.                                                                                                                   |
| 11    | **Statutory reconsideration:** representations within **40 working days**, decided within **40 working days**, free.                                                                                                       |
| 12–13 | An exception **and** the public interest test, with a **presumption in favour of disclosure**. 12(4)(a)–(e) and 12(5)(a)–(g); 12(5)(d)–(g) cannot withhold information on **emissions**. Personal data under reg 13.       |
| 14    | Written refusal within 20 working days, with reasons, the public interest factors, and the reg 11 and reg 18 rights.                                                                                                       |

### Scotland: FOI(S)A 2002 and EI(S)R 2004

Scottish public authorities, the Scottish Parliament and Administration fall under
FOI(S)A, not FOIA (FOIA s.80), with the **Scottish Information Commissioner** (FOI(S)A
s.47).

| Provision                       | What it requires now                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FOI(S)A s.10                    | **20 working days**; 30 for the Keeper of the Records; fee days disregarded (amended S.S.I. 2016/346).                                                                               |
| s.20                            | **Requirement for review**: in recordable form, with name, address and what is complained of, within **40 working days** of the deadline or late response. Statutory, unlike FOIA's. |
| s.21                            | Review decided within **20 working days**; the notice states the s.47 right to apply to the Commissioner and the s.56 appeal.                                                        |
| Coronavirus (Scotland) Act 2020 | The temporary 60 days has gone; the text reads 20 again.                                                                                                                             |

### Checked on 9 November 2026, for Phase 0

- **Working days differ by Act.** FOIA s.10(6) (and EIR reg 2(1)) excludes Christmas
  Day, Good Friday and bank holidays **in any part of the UK**. FOI(S)A s.73 (and EI(S)R
  reg 2(1)) excludes Christmas Day and bank holidays **in Scotland** only. So 13 July
  2026 (Northern Ireland) stops an English authority's clock and not a Scottish one's.
- **FOI(S)A:** cost limit **£600**, staff time at no more than **£15 an hour** (S.S.I.
  2004/467 regs 3 and 5); no fee up to £100, then at most 10% of the cost above £100
  (reg 4). Fees notice: three months to pay, days to payment disregarded (ss.9(3),
  10(3)). Clarification restarts the count (s.10(1)(b)). No public interest extension;
  only the Scottish Ministers may extend, by regulations, to the 60th working day
  (s.10(4)), used for grant-aided and independent special schools (S.S.I. 2016/346,
  responses and reviews). Refusal notices (ss.16, 19) give the complaints procedure and
  the s.20 and s.47 rights. Absolute exemptions (s.2(2)): ss.25, 26, 36(2), 37,
  38(1)(a), (c), (d), and 38(1)(b) where the first condition is met. The review window
  runs from the **deadline**, or from a late response (s.20(5)), not from an early
  response.
- **FOI(S)A pending effects:** 2025 asp 8 and asp 12 add two bodies to Schedule 1, not
  yet in force. The clock is unchanged.
- **EI(S)R:** 20 working days (reg 5); extension to 40 for volume and complexity (reg
  7); charges payable within 60 working days, clock paused (reg 8); clarification
  restarts it (reg 9); exceptions with a presumption in favour of disclosure, (5)(d)–(g)
  not for emissions (reg 10); own personal data excluded by **reg 11(1)**; refusal
  contents (reg 13); review asked within 40 working days, decided within 20 (reg 16);
  the Scottish Information Commissioner (reg 17).
- **EIR reg 13:** the outstanding DUAA s.88(11)–(12) change is in force from 5 September
  2025; it adds the new DPA 2018 s.78A national security exemption as a ground. The
  same change is pending at EI(S)R reg 11(4A)(b). No effect on the clock.
- **Oral environmental requests:** confirmed for Scotland by the Scottish Information
  Commissioner (foi.scot). The ICO's pages could not be fetched; decision 7 stands on
  the regulations, which do not require writing.
- **FOIA Part II:** headings confirmed from the Act's contents page; s.25 is
  supplementary (certificates), not an exemption.

## Where Govern stands

| Already there                                                                            | What it gives this plan                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity.public_authority`                                                                | DPA 2018 s.7 defines a public authority as an FOIA or FOI(S)A public authority, so the flag already means "FOI applies". What it does not say is **which** Act.                                                                                                                                                   |
| `data_subject_request` with `data_subject_request_decision` and `lib/dsr/statutory.ts`   | The pattern to copy: a register, append-only decisions that each carry a basis and a rationale, and a pure module for the clock. Its working-day calendar knows **England and Wales** bank holidays only. FOIA counts bank holidays in **any part of the UK**, so it needs Scotland's and Northern Ireland's too. |
| `dsr_intake_link`, `/request/[slug]`, `services/dsr-intake.ts`                           | A per-entity public form: random address, can be withdrawn, rate limited by keyed hash of the address, a minimum fill time, takes complaints too. It sets no cookies. The FOI form reuses all of it.                                                                                                              |
| `frame-ancestors 'none'` (`src/proxy.ts`) and `X-Frame-Options: DENY` (`next.config.ts`) | No page can be framed today. Embedding means relaxing both, for the two form routes only.                                                                                                                                                                                                                         |
| The sweep and `breach_deadline`-style tasks                                              | Statutory deadlines raised as tasks.                                                                                                                                                                                                                                                                              |
| The complaints register                                                                  | FOI complaints and reviews follow its event-log shape.                                                                                                                                                                                                                                                            |

## Decisions

Settled 9 November 2026: regimes (all four), embedding (listed sites only), separate
forms, and decisions 1-10 below, all as recommended.

1. **Which Act an entity is under** (settled). _Recommendation:_ a new
   `entity.foi_regime`: `none` | `foia` | `foisa`, set on the Organisation page. Setting
   it to `foia` or `foisa` also sets `public_authority`, because DPA s.7 makes them the
   same thing. Each request then picks FOIA or EIR (or FOI(S)A or EI(S)R) within that.
2. **Partly covered authorities** (settled). Some bodies are public authorities only for
   some information (a GP practice, for its NHS work). _Recommendation:_ a free-text
   "covered for" note on the entity, shown on each request, not a rule.
3. **Longer limits** (settled). _Recommendation:_ a `foi_time_profile` on the entity:
   `standard`, `school` or `archive`. Schools get the 60th working day as a hard limit
   and the handler records the 20-school-day date, because Govern cannot know term
   dates. The armed forces and overseas extensions are recorded per request, as a date
   the Commission set.
4. **Who sees the register** (settled). Requests hold the requester's name and address.
   _Recommendation:_ a new capability, `foi.handle`, given to the same roles as
   `dsr.handle`, which keeps it separate for organisations that split the jobs.
5. **Requests for one's own data** (settled). _Recommendation:_ the handler can convert
   an FOI request into a data subject request in one step. The DSR keeps the original
   receipt date, and both records link to each other. The FOI form also tells people
   asking for their own data where to go instead.
6. **Mixed requests** (settled). One letter can ask for environmental and other
   information. _Recommendation:_ one request record with a regime per part, rather
   than two records, because one response answers it.
7. **Oral EIR requests** (settled). _Recommendation:_ staff can log one with the channel
   "in person" or "by phone", and the FOI form says a request does not have to come
   through it.
8. **Embedding mechanics** (settled). _Recommendation:_
   - Each form keeps up to ten **website origins** (`https://` plus host, exact match,
     no wildcards), added and removed by a privacy admin and audited.
   - The proxy sends `frame-ancestors` with those origins for that form's address
     only, and leaves out `X-Frame-Options` there. Every other page keeps `'none'` and
     `DENY`.
   - The admin page gives three things to copy: the link, an iframe snippet with a
     `title` (needed by the Public Sector Bodies Accessibility Regulations 2018), and
     an optional resize script. The script uses `postMessage` and checks the sender's
     origin, so the frame grows to fit the form.
   - Because the form sets no cookies, browsers that block third-party cookies make
     no difference.
9. **Welsh language** (settled). Welsh public bodies may be bound by the Welsh Language
   Standards to offer a Welsh form. _Recommendation:_ not in the first version. Build
   the form so its text can take a second language later.
10. **A disclosure log** (settled). Many authorities publish what they released.
    _Recommendation:_ later. Record now whether each response was published, so a
    log can be produced from it.

## Data model

### `entity` (new columns)

`foi_regime` (`none` | `foia` | `foisa`), `foi_covered_for` (text, null),
`foi_time_profile` (`standard` | `school` | `archive`).

### `information_request`

| Column                                      | Notes                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `organisation_id`, `entity_id`, `reference` | `FOI-2026-001` from `reference_counters`                                                                           |
| `regime`                                    | `foia` \| `eir` \| `foisa` \| `eisr`; with decision 6, per part (`information_request_part`)                       |
| `requester_name`, `correspondence_address`  | s.8; a pseudonym can be marked, and a FOIA request then flags as not valid (code 1.14), though an EIR one does not |
| `description`                               | What they asked for, as they wrote it                                                                              |
| `preferred_means`                           | s.11: copy, inspection, digest, or a format                                                                        |
| `channel`, `intake_link_id`                 | Form, email, post, in person, phone (EIR)                                                                          |
| `received_at`                               | The receipt date; the clock starts from the day after                                                              |
| `extended_deadline`                         | A Commission-set date (armed forces, overseas) or a school-days date                                               |
| `converted_to_request_id`                   | Where it became a data subject request (decision 5)                                                                |
| `published`                                 | Whether the response went on the disclosure log (decision 10)                                                      |
| `closed_at`                                 |                                                                                                                    |

### `information_request_decision` (append-only, the shape of `data_subject_request_decision`)

Kinds, each with its basis and a rationale that is never optional:

- **Holding and clarifying:** clarification sought (s.1(3), reg 9(2)) and received;
  held, not held, or partly held; neither confirm nor deny (with the provision).
- **Fees and cost:** fees notice (s.9, reg 8), paid or lapsed; cost limit (s.12), with
  the estimate in hours and whether requests were aggregated.
- **Refusing the request:** vexatious or repeated (s.14, reg 12(4)(b)); transferred
  (code section 2).
- **Exemptions:** exemption or exception applied: the provision, absolute or
  qualified, and for qualified ones the public interest factors on each side.
- **Extensions:** public interest extension (s.10(3)), with the estimated date (code
  4.6); EIR complexity and volume extension (reg 7).
- **Responding:** response sent: disclosed in full, in part, or refused. For a refusal,
  a checklist of what s.17 (or reg 14, or FOI(S)A s.16) requires, including the
  complaints procedure and the s.50 right. Govern checks the list; it does not write
  the letter.

### `information_request_review`

The internal review (code 5), reg 11 reconsideration or FOI(S)A s.20 review. It
records the request date, the clock, who reviewed, and the outcome (upheld, changed,
released). After it comes the application to the regulator (the Information Commission
or the Scottish Information Commissioner), the decision notice, and any appeal, as
events.

### `lib/foi/statutory.ts` (pure)

- Working days per s.10(6), and its FOI(S)A equivalent, with bank holidays for **all
  parts of the UK**, Christmas Day and Good Friday.
- The deadline per regime and time profile.
- The clock: paused for fees, restarted on clarification, and extended under s.10(3)
  or reg 7.
- Review windows.
- The cost estimate at £25 an hour against the right limit.
- Requests that could be aggregated: the same person, within 60 working days. Govern
  only shows these; it never aggregates on its own.
- Which exemptions are absolute.

### Forms

`dsr_intake_link` gains:

- `kind`: `data_protection` or `information`;
- `frame_origins`: a text array, empty by default.

The FOI form lives at `/information-request/[slug]` and reuses the slug, rate limit and
attempt table. It asks for a name, an address for correspondence, what information is
wanted, and the preferred format. It says:

- a real name is needed;
- the requester does not have to say why they want the information;
- a request does not have to use the form;
- where to go for their own personal data (the entity's data protection form, when it
  has one).

## Phases

Each phase is its own PR.

### Phase 0: the law and the clock (built)

- The law checks above.
- `lib/foi/statutory.ts` with tests: UK-wide bank holidays, each regime's deadline,
  pauses and extensions, school and archive profiles, review windows.

Built as:

- `lib/dsr/bank-holidays.ts` now holds Scotland's and Northern Ireland's bank holidays
  (gov.uk, 2025–2028) as well as England and Wales's, with
  `BANK_HOLIDAYS_ANY_PART_OF_UK` for FOIA and `BANK_HOLIDAYS_SCOTLAND` for FOI(S)A.
  The coverage test fails once any list runs out.
- `lib/foi/statutory.ts`: `isWorkingDay` per Act; `workingDayAfter`, which skips fee
  pauses (both ends included); `clockStartsAt`, where clarification restarts the count;
  `responseDeadline` (20, archive 30, environmental extension 40, school-days date or a
  Commission-set date capped at the 60th); the FOIA public interest guide date (code
  4.6); fee lapse; `REVIEW` with `reviewRequestDeadline` and `reviewDeadline`; cost
  limits and the FOI(S)A maximum fee; the FOIA aggregation window; the exemption and
  exception lists for all four regimes, marking which are absolute and which cannot
  withhold information on emissions; and what each regime's refusal notice must say.
- `tests/foi-statutory.test.ts`: 24 cases, including deadlines that fall differently
  under FOIA and FOI(S)A because their bank holidays differ.

### Phase 1: who FOI applies to, and the register (built)

- The `entity` columns (decisions 1–3), on the Organisation page, audited.
- `information_request`, the `foi.handle` capability, list and detail pages, logging
  a request by hand, and conversion to a data subject request (decision 5).
- Help topic and nav entry. Row-level security on every new table, with its tenant
  isolation test.

Built as:

- `entity.foi_act` (null, `foia` or `foisa`), `foi_time_profile` and `foi_covered_for`
  (migration 0093), set on the Organisation page by `setFreedomOfInformation` and
  audited as `entity.foi_changed`. Setting an Act turns `public_authority` on, and
  `setPublicAuthority` refuses to turn it off while an Act applies. Refused for an
  entity under EU law only.
- `information_request` (`src/db/schema/foi.ts`), row-level security as for every
  tenant table. The Act and time profile are copied from the entity when the request
  is recorded. Decision 6 is a `regimes` list on the request rather than a parts table:
  one response answers it, and the earliest deadline of its regimes is the one shown
  (`requestDeadline`).
- `services/information-requests.ts`: record (refusing a spoken request unless every
  regime is environmental, and a regime from the other Act), correct, clarification
  sought and received, respond (a late response needs its reason), close, and convert
  to a subject access request (`dsr.handle` needed as well). References are
  `FOI-2026-0001`, four digits like the other registers. The requester's name and
  address stay out of the audit chain.
- `foi.handle`, for owners, privacy administrators and analysts. Pages at
  `/app/information-requests`; the nav item shows only where some entity has an Act.
  The subject access request page links back to the FOI request it came from.
- Help topic `information-requests`; tests in `tests/information-requests.test.ts` and
  the tenant isolation suite.
- Not yet: decisions with exemptions and the public interest test, and deadline tasks
  (Phase 2).

### Phase 2: decisions and deadlines (built)

- Decisions with exemptions, the public interest test, fees, cost limit and s.14.
- The refusal notice checklist.
- Deadlines raised as tasks by the sweep, including the s.10(3) estimated date.

Built as:

- `information_request_decision` (migration 0094, row-level security), append-only in
  code like the decisions on data subject requests. Kinds: held, neither confirm nor
  deny, exemption, public interest extension, complexity extension, fees notice, fee
  paid, fee lapsed, cost limit, vexatious, repeated, transferred, advice. Each needs a
  reason.
- `recordInformationRequestDecision` checks each against the law:
  - an exemption must be the regime's own, and a qualified one, or any environmental
    exception, needs the factors on each side;
  - the requester's own data is refused, with conversion offered instead;
  - the four emissions-barred exceptions need the handler to confirm the information
    is not on emissions;
  - the public interest extension is FOIA only, names a qualified exemption, and must
    be given by the ordinary deadline with a later estimated date;
  - reg 7 extension only for environmental requests, within twenty working days;
  - a fees notice within the time for responding, one at a time, with its lapse date;
  - the cost limit only above it, and never under the environmental regulations,
    which point to reg 12(4)(b) instead; vexatious and repeated likewise.
- The clock reads the decisions: fee notice to payment is paused, an unpaid fee waits,
  and a public interest extension moves the deadline to its estimated date.
- A response after any refusing decision needs `refusal_notice_checked`, ticked
  against the list of what that regime's notice must say.
- The sweep raises a `foi_deadline` task when a response is due within five working
  days or overdue, keyed on the request, state and due date.
- Request page: decision history, and a form per kind. Help topic extended.

### Phase 3: reviews and the regulator (built)

- Internal review, reg 11 reconsideration and FOI(S)A s.20–21, with their clocks.
- Applications to the Information Commission or the Scottish Information Commissioner,
  and their outcomes.

Built as:

- `information_request_review` and `information_request_regulator_event` (migration
  0095, row-level security). One open review per request, enforced by a partial unique
  index.
- `lib/foi/statutory.ts`: `reviewAskedLate` (each regime's own window), `reviewDueAt`
  (the earliest part of a mixed review; the code's further twenty days for FOIA
  alone), `informationRequestReviewClock`, `REGULATOR_APPLICATION`, `APPEAL` and
  `appealDeadline` (28 calendar days to the First-tier Tribunal; 42 to the Court of
  Session).
- `services/information-request-reviews.ts`:
  - a review only of an answered request, or of one past its deadline (then recorded
    as about the failure to respond); never of a closed or converted one;
  - EIR reg 11(2) and FOI(S)A s.20(3) reviews must be asked for in writing;
  - one asked for after the last day needs a choice, accept or decline, with a reason;
    a declined one is recorded as decided there and then;
  - the outcome (upheld, varied, reversed) needs the reviewer and confirmation that the
    notice gives the right to go to the regulator; a late one needs the reason;
  - the FOIA exceptional extension only before the time runs out;
  - regulator events in order: an application opens a case (after a review, for
    FOI(S)A s.47(1)); a decision notice against the authority needs a date for its
    steps; an appeal needs a notice and suspends the steps (FOIA s.50(6)); nothing
    follows a closed case but a new application.
- The sweep raises `foi_deadline` tasks for reviews due within five working days or
  overdue, and for the regulator's steps due within a week or past, all on the request.
- Request page: review cards with their clocks and forms, and the regulator's case
  with its events. Help topic extended.

### Phase 4: the public FOI form

- `kind` on the form, the FOI page, and admin to issue and withdraw FOI forms beside
  data protection ones.
- Signposting between the two forms.

### Phase 5: embedding both forms

- `frame_origins` with its admin, audited.
- The proxy's per-form `frame-ancestors`, and no `X-Frame-Options` on those two routes.
- The copyable link, iframe snippet and resize script.
- Tests that every other page still refuses to be framed, and that an unlisted site is
  refused.
- Check the forms at phone width inside a frame, and against WCAG 2.2 AA.

### Phase 6: reporting

- On-time rates by regime, and outcomes by exemption: the figures authorities publish
  and the Commission asks about.
- Overdue requests and reviews on the dashboard.
- Requests in the export.

## Rough size

Phase 0 and 1 are the bulk of the new rules. Phases 4 and 5 are mostly reuse: the form
machinery exists, and embedding is a header change plus its admin and tests. Phase 5
does not depend on the FOI work, so the data protection form can become embeddable
first if that is wanted sooner.

## Out of scope

- Writing the response letters (Govern records what was sent; the Portal generates
  documents).
- The publication scheme (FOIA s.19), beyond noting that one is required.
- Requests to re-use information (the Re-use of Public Sector Information Regulations
  2015), which are a separate regime from access.
- A Welsh-language form (decision 9) and a public disclosure log (decision 10), for
  now.
