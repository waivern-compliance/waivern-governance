/**
 * What freedom of information law requires of a request, expressed once.
 *
 * Pure, and separate from the database, like the data subject request and
 * breach modules: the arithmetic behind a deadline the regulator may ask about
 * should be inspectable, and nothing here decides anything. It works out when a
 * response or a review is due and what each regime allows; a named person
 * records each judgement and why.
 *
 * Four regimes, checked on legislation.gov.uk on 9 November 2026: the Freedom
 * of Information Act 2000 and the Environmental Information Regulations 2004
 * (England, Wales, Northern Ireland and UK-wide bodies), and their Scottish
 * counterparts, the Freedom of Information (Scotland) Act 2002 and the
 * Environmental Information (Scotland) Regulations 2004. See
 * `docs/foi-plan.md`.
 *
 * Time runs in working days, counted from the day after receipt: "the
 * twentieth working day following the date of receipt" (FOIA s.10(1)). A
 * deadline covers the whole of the day it lands on.
 */
import {
  BANK_HOLIDAYS_ANY_PART_OF_UK,
  BANK_HOLIDAYS_SCOTLAND
} from '@/lib/dsr/bank-holidays';

/** The Act an entity answers requests under, if any. */
export type FoiAct = 'foia' | 'foisa';

/** The regime a request, or a part of one, is handled under. */
export type FoiRegime = 'foia' | 'eir' | 'foisa' | 'eisr';

/**
 * Where the authority gets longer than twenty working days.
 *
 * - `school`: maintained, MoD and Northern Ireland schools and academies (S.I.
 *   2004/3364, 2009/1369, 2010/2768): the twentieth working day disregarding
 *   days that are not school days, or the sixtieth working day if earlier.
 *   Govern cannot know term dates, so the handler gives the school-days date.
 * - `archive`: a request for a transferred public record not designated open,
 *   to a records authority or place of deposit (S.I. 2004/3364): thirty
 *   working days. In Scotland, the Keeper of the Records (FOI(S)A s.10(2)).
 */
export type TimeProfile = 'standard' | 'school' | 'archive';

export const FOI_ACT_REGIMES: Record<FoiAct, readonly [FoiRegime, FoiRegime]> =
  {
    foia: ['foia', 'eir'],
    foisa: ['foisa', 'eisr']
  };

/** Which Act a regime belongs to, and so whose working days and regulator apply. */
export function actOf(regime: FoiRegime): FoiAct {
  return regime === 'foisa' || regime === 'eisr' ? 'foisa' : 'foia';
}

export const REGULATOR: Record<FoiAct, string> = {
  foia: 'the Information Commission',
  foisa: 'the Scottish Information Commissioner'
};

export const REGIME: Record<
  FoiRegime,
  {
    label: string;
    short: string;
    /** Where the duty to respond and its time limit are. */
    respond: string;
    /** Whether the law requires the request in writing. */
    mustBeInWriting: boolean;
    /** Whether a review by the authority is required by law, not only by a code. */
    statutoryReview: boolean;
  }
> = {
  foia: {
    label: 'Freedom of Information Act 2000',
    short: 'FOIA',
    respond: 'ss.1 and 10',
    mustBeInWriting: true,
    statutoryReview: false
  },
  eir: {
    label: 'Environmental Information Regulations 2004',
    short: 'EIR',
    respond: 'reg 5',
    mustBeInWriting: false,
    statutoryReview: true
  },
  foisa: {
    label: 'Freedom of Information (Scotland) Act 2002',
    short: 'FOI(S)A',
    respond: 'ss.1 and 10',
    mustBeInWriting: true,
    statutoryReview: true
  },
  eisr: {
    label: 'Environmental Information (Scotland) Regulations 2004',
    short: 'EI(S)R',
    respond: 'reg 5',
    mustBeInWriting: false,
    statutoryReview: true
  }
};

const DAY = 86_400_000;

function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function endOfDay(d: Date): Date {
  return new Date(startOfDay(d).getTime() + DAY - 1);
}

/**
 * Is this a working day for the Act?
 *
 * FOIA s.10(6), and the EIR reg 2(1) with it: not a Saturday or Sunday,
 * Christmas Day, Good Friday, or a bank holiday under the Banking and
 * Financial Dealings Act 1971 in any part of the United Kingdom. So a Scottish
 * or Northern Irish bank holiday stops an English authority's clock too.
 *
 * FOI(S)A s.73, and the EI(S)R with it: not a Saturday or Sunday, Christmas
 * Day, or a bank holiday in Scotland.
 */
export function isWorkingDay(d: Date, act: FoiAct): boolean {
  const weekday = d.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const day = dayOf(d);
  if (day.endsWith('-12-25')) return false;
  return act === 'foia'
    ? !BANK_HOLIDAYS_ANY_PART_OF_UK.has(day)
    : !BANK_HOLIDAYS_SCOTLAND.has(day);
}

/** A period the clock stood still, inclusive of both days. `to` is null while it lasts. */
export type Pause = { from: Date; to: Date | null };

function paused(d: Date, pauses: readonly Pause[], now: Date): boolean {
  const day = startOfDay(d).getTime();
  return pauses.some(
    (p) =>
      day >= startOfDay(p.from).getTime() &&
      day <= startOfDay(p.to ?? now).getTime()
  );
}

/**
 * The nth working day following a date, skipping days in any pause.
 *
 * FOIA s.10(2): the working days from the day a fees notice is given to the
 * day the fee is received are disregarded. The EIR's advance payment (reg 8)
 * and the Scottish equivalents work the same way.
 */
export function workingDayAfter(
  from: Date,
  n: number,
  act: FoiAct,
  pauses: readonly Pause[] = [],
  now = new Date()
): Date {
  let day = startOfDay(from);
  let counted = 0;
  while (counted < n) {
    day = new Date(day.getTime() + DAY);
    if (isWorkingDay(day, act) && !paused(day, pauses, now)) counted += 1;
  }
  return endOfDay(day);
}

/** Working days from one day to another, counting the second but not the first. */
export function workingDaysBetween(from: Date, to: Date, act: FoiAct): number {
  let day = startOfDay(from);
  const end = startOfDay(to).getTime();
  let n = 0;
  while (day.getTime() < end) {
    day = new Date(day.getTime() + DAY);
    if (isWorkingDay(day, act)) n += 1;
  }
  return n;
}

/**
 * When the clock starts.
 *
 * On receipt, or, where the authority asked for more to identify what is
 * wanted, when that arrives: FOIA s.1(3) with s.10(6), EIR reg 9(4), FOI(S)A
 * s.1(3) and EI(S)R reg 9(4). Asking is not a pause: the count starts again.
 * While the answer is awaited nothing is owed, so there is no start.
 */
export function clockStartsAt(input: {
  receivedAt: Date;
  clarificationSoughtAt?: Date | null;
  clarificationReceivedAt?: Date | null;
}): Date | null {
  if (!input.clarificationSoughtAt) return input.receivedAt;
  if (!input.clarificationReceivedAt) return null;
  return input.clarificationReceivedAt > input.receivedAt
    ? input.clarificationReceivedAt
    : input.receivedAt;
}

/** The ordinary limit, in working days, before any extension. */
export function ordinaryLimit(regime: FoiRegime, profile: TimeProfile): number {
  if (profile === 'archive' && (regime === 'foia' || regime === 'foisa'))
    return 30;
  return 20;
}

/**
 * The deadline for responding.
 *
 * - Twenty working days (FOIA s.10(1), EIR reg 5(2), FOI(S)A s.10(1), EI(S)R
 *   reg 5(2)), thirty for archives under the `archive` profile.
 * - Forty for an environmental request extended because it is both complex
 *   and voluminous (EIR reg 7(1), EI(S)R reg 7(1)), which the applicant must
 *   be told of within the first twenty.
 * - A school's is the date the handler gives for the twentieth school day,
 *   but never later than the sixtieth working day: FOIA schools and academies
 *   (S.I. 2004/3364, 2009/1369, 2010/2768), and grant-aided and independent
 *   special schools in Scotland (S.S.I. 2016/346). The EIR have no school rule.
 * - A day the Information Commission set on application (armed forces
 *   operations, information held outside the UK: S.I. 2004/3364), never later
 *   than the sixtieth working day.
 *
 * The FOIA public interest extension (s.10(3)) does not move this: the refusal
 * notice saying the test is still being considered is due here. See
 * `publicInterestGuideDate`.
 */
export function responseDeadline(input: {
  regime: FoiRegime;
  startsAt: Date;
  profile?: TimeProfile;
  /** EIR / EI(S)R reg 7: complex and voluminous. */
  extendedForComplexity?: boolean;
  schoolDaysDeadline?: Date | null;
  commissionSetDeadline?: Date | null;
  feePauses?: readonly Pause[];
  now?: Date;
}): Date {
  const act = actOf(input.regime);
  const profile = input.profile ?? 'standard';
  const pauses = input.feePauses ?? [];
  const at = (n: number) =>
    workingDayAfter(input.startsAt, n, act, pauses, input.now);
  const cap = at(60);

  if (input.commissionSetDeadline && input.regime === 'foia') {
    const set = endOfDay(input.commissionSetDeadline);
    return set < cap ? set : cap;
  }
  if (
    profile === 'school' &&
    (input.regime === 'foia' || input.regime === 'foisa')
  )
    return schoolDeadline(input.schoolDaysDeadline, cap);
  const environmental = input.regime === 'eir' || input.regime === 'eisr';
  if (environmental && input.extendedForComplexity) return at(40);
  return at(ordinaryLimit(input.regime, profile));
}

/** The school-days date where the handler gave one, never later than the cap. */
function schoolDeadline(given: Date | null | undefined, cap: Date): Date {
  if (!given) return cap;
  const school = endOfDay(given);
  return school < cap ? school : cap;
}

/**
 * Whether a regime allows its time to be extended to weigh the public
 * interest. Only FOIA does (s.10(3)), and only for "such time as is reasonable
 * in the circumstances". The EIR, FOI(S)A and EI(S)R weigh it within the
 * ordinary limit.
 */
export function allowsPublicInterestExtension(regime: FoiRegime): boolean {
  return regime === 'foia';
}

/**
 * The date by which a FOIA public interest extension should normally end:
 * twenty working days after the ordinary deadline. This is the s.45 code
 * (para 4.6), not the Act, and the estimate given in the refusal notice
 * (s.17(2)) is what the applicant holds the authority to.
 */
export function publicInterestGuideDate(deadline: Date): Date {
  return workingDayAfter(deadline, 20, 'foia');
}

/**
 * How long the applicant has to pay a fee or charge before the request lapses.
 * FOIA s.9(2) and FOI(S)A s.9(3): three months from the fees notice. EIR and
 * EI(S)R reg 8: sixty working days.
 */
export function feeLapsesAt(regime: FoiRegime, noticeAt: Date): Date {
  if (regime === 'foia' || regime === 'foisa') {
    const d = new Date(noticeAt);
    d.setUTCMonth(d.getUTCMonth() + 3);
    return endOfDay(d);
  }
  return workingDayAfter(noticeAt, 60, actOf(regime));
}

/**
 * The review the applicant can ask for, and the time each side has.
 *
 * - FOIA: the s.45 code, not the Act. Requests are accepted within forty
 *   working days of the response (5.3) and decided within twenty (5.4), or
 *   exceptionally forty (5.5).
 * - EIR reg 11: representations within forty working days of the failure,
 *   decided within forty.
 * - FOI(S)A ss.20 and 21: a requirement for review within forty working days
 *   of the deadline, or of a late response, decided within twenty.
 * - EI(S)R reg 16: within forty working days of the decision, or of when it
 *   was due, decided within twenty.
 */
export const REVIEW: Record<
  FoiRegime,
  {
    name: string;
    provision: string;
    askWithin: number;
    decideWithin: number;
    /** The longest a decision should take, where a code allows more. */
    decideAtMost: number;
  }
> = {
  foia: {
    name: 'internal review',
    provision: 's.45 code of practice, part 5',
    askWithin: 40,
    decideWithin: 20,
    decideAtMost: 40
  },
  eir: {
    name: 'reconsideration',
    provision: 'reg 11',
    askWithin: 40,
    decideWithin: 40,
    decideAtMost: 40
  },
  foisa: {
    name: 'review',
    provision: 'ss.20 and 21',
    askWithin: 40,
    decideWithin: 20,
    decideAtMost: 20
  },
  eisr: {
    name: 'review',
    provision: 'reg 16',
    askWithin: 40,
    decideWithin: 20,
    decideAtMost: 20
  }
};

/**
 * The last day to ask for a review.
 *
 * Counted from the response, or from the day it was due where none came.
 * FOI(S)A s.20(5) is different: it counts from the expiry of the time for
 * responding, however early the response came, or from a late response. An
 * authority may accept a late request; this is when it stops having to.
 */
export function reviewRequestDeadline(input: {
  regime: FoiRegime;
  respondedAt?: Date | null;
  deadline: Date;
}): Date {
  const responded = input.respondedAt ?? null;
  const from =
    input.regime === 'foisa'
      ? responded && responded > input.deadline
        ? responded
        : input.deadline
      : (responded ?? input.deadline);
  return workingDayAfter(
    from,
    REVIEW[input.regime].askWithin,
    actOf(input.regime)
  );
}

/**
 * When the review should be decided, counted from receipt of the request for
 * it. A Scottish special school under S.S.I. 2016/346 has the school-days rule
 * for its review too (s.21(1)).
 */
export function reviewDeadline(input: {
  regime: FoiRegime;
  requestedAt: Date;
  /** FOIA only: the code's exceptional further twenty working days. */
  exceptional?: boolean;
  profile?: TimeProfile;
  schoolDaysDeadline?: Date | null;
}): Date {
  const r = REVIEW[input.regime];
  if (input.profile === 'school' && input.regime === 'foisa')
    return schoolDeadline(
      input.schoolDaysDeadline,
      workingDayAfter(input.requestedAt, 60, 'foisa')
    );
  return workingDayAfter(
    input.requestedAt,
    input.exceptional ? r.decideAtMost : r.decideWithin,
    actOf(input.regime)
  );
}

/**
 * The appropriate limit under FOIA s.12 (S.I. 2004/3244): £600 for the bodies
 * in Schedule 1 Part I, £450 for everyone else, with staff time at £25 an hour
 * spent determining whether the information is held, locating, retrieving and
 * extracting it. FOI(S)A s.12 (S.S.I. 2004/467 regs 3 and 5): £600, with staff
 * time counted at no more than £15 an hour. The environmental regulations have
 * no cost limit; cost goes to whether a request is manifestly unreasonable
 * (EIR reg 12(4)(b), EI(S)R reg 10(4)(b)), which is a judgement, not a sum.
 */
export function costLimit(
  regime: FoiRegime,
  opts: { centralGovernment?: boolean } = {}
): { pounds: number; hourlyRate: number; hours: number } | null {
  if (regime === 'foia') {
    const pounds = opts.centralGovernment ? 600 : 450;
    return { pounds, hourlyRate: 25, hours: pounds / 25 };
  }
  if (regime === 'foisa') return { pounds: 600, hourlyRate: 15, hours: 40 };
  return null;
}

/**
 * The most a Scottish authority may charge as a fee (S.S.I. 2004/467 reg 4):
 * nothing where the projected cost is £100 or less, otherwise no more than
 * ten per cent of the cost above £100. Above the £600 limit there is no duty
 * to comply, so no fee is worked out.
 */
export function foisaMaximumFee(projectedCost: number): number | null {
  if (projectedCost > 600) return null;
  if (projectedCost <= 100) return 0;
  return Math.round((projectedCost - 100) * 10) / 100;
}

/** Whether an estimate in hours goes over the limit. Null where there is no limit. */
export function exceedsCostLimit(
  regime: FoiRegime,
  estimatedHours: number,
  opts: { centralGovernment?: boolean } = {}
): boolean | null {
  const limit = costLimit(regime, opts);
  return limit ? estimatedHours * limit.hourlyRate > limit.pounds : null;
}

/**
 * Whether two FOIA requests fall within the sixty consecutive working days in
 * which the costs of requests for the same or similar information, from one
 * person or people acting in concert, may be aggregated (S.I. 2004/3244). Govern shows the candidates; aggregating them is the handler's call.
 */
export function withinAggregationWindow(a: Date, b: Date): boolean {
  const [first, second] = a <= b ? [a, b] : [b, a];
  return workingDaysBetween(first, second, 'foia') < 60;
}

export type Exemption = {
  provision: string;
  title: string;
  /** No public interest test: if it applies, it applies. */
  absolute: boolean;
  /**
   * False where there is nothing to weigh although the provision is not
   * absolute: information that is not held (EIR reg 12(4)(a), EI(S)R reg
   * 10(4)(a)) cannot be balanced for or against disclosure.
   */
  weighed?: false;
};

/** Whether applying it needs the public interest test recorded. */
export function needsPublicInterestTest(e: Exemption): boolean {
  return !e.absolute && e.weighed !== false;
}

/**
 * FOIA Part II. Absolute per s.2(3); the rest are qualified, and withholding
 * under them needs the public interest in maintaining the exemption to
 * outweigh the public interest in disclosure.
 */
export const FOIA_EXEMPTIONS: readonly Exemption[] = [
  {
    provision: 's.21',
    title: 'Information accessible by other means',
    absolute: true
  },
  {
    provision: 's.22',
    title: 'Information intended for future publication',
    absolute: false
  },
  {
    provision: 's.22A',
    title: 'Research',
    absolute: false
  },
  {
    provision: 's.23',
    title: 'Information supplied by, or concerning, certain security bodies',
    absolute: true
  },
  { provision: 's.24', title: 'National security', absolute: false },
  { provision: 's.26', title: 'Defence', absolute: false },
  { provision: 's.27', title: 'International relations', absolute: false },
  {
    provision: 's.28',
    title: 'Relations within the United Kingdom',
    absolute: false
  },
  { provision: 's.29', title: 'The economy', absolute: false },
  {
    provision: 's.30',
    title: 'Investigations and proceedings conducted by public authorities',
    absolute: false
  },
  { provision: 's.31', title: 'Law enforcement', absolute: false },
  { provision: 's.32', title: 'Court records, etc.', absolute: true },
  { provision: 's.33', title: 'Audit functions', absolute: false },
  { provision: 's.34', title: 'Parliamentary privilege', absolute: true },
  {
    provision: 's.35',
    title: 'Formulation of government policy, etc.',
    absolute: false
  },
  {
    provision: 's.36',
    title: 'Prejudice to effective conduct of public affairs',
    // Absolute only for information held by the House of Commons or the House
    // of Lords (s.2(3)(e)); qualified for everyone else.
    absolute: false
  },
  {
    provision: 's.37(1)(a)-(ab)',
    title:
      'Communications with the Sovereign, the heir and the second in line to the Throne',
    absolute: true
  },
  {
    provision: 's.37(1)(ac)-(b)',
    title:
      'Communications with other members of the Royal Family and the Royal Household; honours',
    absolute: false
  },
  { provision: 's.38', title: 'Health and safety', absolute: false },
  { provision: 's.39', title: 'Environmental information', absolute: false },
  {
    provision: 's.40(1)',
    title: "The applicant's own personal data",
    absolute: true
  },
  {
    provision: 's.40(2), first condition',
    title:
      'Personal data of others, where disclosure would breach the data protection principles',
    absolute: true
  },
  {
    provision: 's.40(2), other conditions',
    title: 'Personal data of others, otherwise',
    absolute: false
  },
  {
    provision: 's.41',
    title: 'Information provided in confidence',
    absolute: true
  },
  {
    provision: 's.42',
    title: 'Legal professional privilege',
    absolute: false
  },
  { provision: 's.43', title: 'Commercial interests', absolute: false },
  { provision: 's.44', title: 'Prohibitions on disclosure', absolute: true }
];

/**
 * EIR exceptions. Every one needs the public interest test, with a
 * presumption in favour of disclosure (reg 12(1)-(2)), except the first
 * condition for personal data (reg 13). Those marked `notForEmissions` cannot
 * withhold information on emissions (reg 12(9)).
 */
export const EIR_EXCEPTIONS: readonly (Exemption & {
  notForEmissions?: boolean;
})[] = [
  {
    provision: 'reg 12(4)(a)',
    title: 'Not held',
    absolute: false,
    weighed: false
  },
  {
    provision: 'reg 12(4)(b)',
    title: 'Manifestly unreasonable',
    absolute: false
  },
  {
    provision: 'reg 12(4)(c)',
    title: 'Formulated in too general a manner',
    absolute: false
  },
  {
    provision: 'reg 12(4)(d)',
    title:
      'Material in the course of completion, unfinished documents or incomplete data',
    absolute: false
  },
  {
    provision: 'reg 12(4)(e)',
    title: 'Internal communications',
    absolute: false
  },
  {
    provision: 'reg 12(5)(a)',
    title:
      'International relations, defence, national security or public safety',
    absolute: false
  },
  {
    provision: 'reg 12(5)(b)',
    title: 'The course of justice and inquiries',
    absolute: false
  },
  {
    provision: 'reg 12(5)(c)',
    title: 'Intellectual property rights',
    absolute: false
  },
  {
    provision: 'reg 12(5)(d)',
    title: 'Confidentiality of proceedings',
    absolute: false,
    notForEmissions: true
  },
  {
    provision: 'reg 12(5)(e)',
    title: 'Confidentiality of commercial or industrial information',
    absolute: false,
    notForEmissions: true
  },
  {
    provision: 'reg 12(5)(f)',
    title: 'Interests of the person who provided the information',
    absolute: false,
    notForEmissions: true
  },
  {
    provision: 'reg 12(5)(g)',
    title: 'Protection of the environment',
    absolute: false,
    notForEmissions: true
  },
  {
    provision: 'reg 13, first condition',
    title:
      'Personal data of others, where disclosure would breach the data protection principles',
    absolute: true
  },
  {
    provision: 'reg 13, other conditions',
    title: 'Personal data of others, otherwise',
    absolute: false
  }
];

/**
 * FOI(S)A Part 2. Absolute per s.2(2); the rest are qualified. Most Scottish
 * exemptions turn on "substantial prejudice", a higher bar than FOIA's.
 */
export const FOISA_EXEMPTIONS: readonly Exemption[] = [
  {
    provision: 's.25',
    title: 'Information otherwise accessible',
    absolute: true
  },
  { provision: 's.26', title: 'Prohibitions on disclosure', absolute: true },
  {
    provision: 's.27',
    title: 'Information intended for future publication',
    absolute: false
  },
  {
    provision: 's.28',
    title: 'Relations within the United Kingdom',
    absolute: false
  },
  {
    provision: 's.29',
    title: 'Formulation of Scottish Administration policy, etc.',
    absolute: false
  },
  {
    provision: 's.30',
    title: 'Prejudice to effective conduct of public affairs',
    absolute: false
  },
  {
    provision: 's.31',
    title: 'National security and defence',
    absolute: false
  },
  { provision: 's.32', title: 'International relations', absolute: false },
  {
    provision: 's.33',
    title: 'Commercial interests and the economy',
    absolute: false
  },
  {
    provision: 's.34',
    title:
      'Investigations by Scottish public authorities and proceedings arising out of such investigations',
    absolute: false
  },
  { provision: 's.35', title: 'Law enforcement', absolute: false },
  {
    provision: 's.36(1)',
    title: 'Confidentiality: legal privilege',
    absolute: false
  },
  {
    provision: 's.36(2)',
    title: 'Confidentiality: information obtained from another person',
    absolute: true
  },
  { provision: 's.37', title: 'Court records, etc.', absolute: true },
  {
    provision: 's.38(1)(a)',
    title: "The applicant's own personal data",
    absolute: true
  },
  {
    provision: 's.38(1)(b), first condition',
    title:
      'Personal data of others, where disclosure would breach the data protection principles',
    absolute: true
  },
  {
    provision: 's.38(1)(b), other conditions',
    title: 'Personal data of others, otherwise',
    absolute: false
  },
  {
    provision: 's.38(1)(c)-(d)',
    title: 'Personal census information and deceased persons’ health records',
    absolute: true
  },
  {
    provision: 's.39',
    title: 'Health, safety and the environment',
    absolute: false
  },
  { provision: 's.40', title: 'Audit functions', absolute: false },
  {
    provision: 's.41',
    title: 'Communications with Her Majesty, etc. and honours',
    absolute: false
  }
];

/**
 * EI(S)R exceptions: reg 10(4) and (5), each needing the public interest test
 * with a presumption in favour of disclosure (reg 10(1)-(2)), and personal
 * data under reg 11. Reg 10(5)(d)-(g) cannot withhold information on
 * emissions (reg 10(6)).
 */
export const EISR_EXCEPTIONS: readonly (Exemption & {
  notForEmissions?: boolean;
})[] = EIR_EXCEPTIONS.map((e) => ({
  ...e,
  provision: e.provision
    .replace('reg 12(', 'reg 10(')
    .replace('reg 13,', 'reg 11,')
}));

/**
 * What every refusal notice has to say. Govern checks the list against what
 * the handler records as sent; it does not write the notice.
 */
export const REFUSAL_MUST_SAY: Record<FoiRegime, readonly string[]> = {
  foia: [
    'Which exemption applies (s.17(1)(b)), and why, unless that would itself be exempt (s.17(1)(c), (4))',
    'For a qualified exemption, the public interest reasons (s.17(3)), or that the test is still being weighed and when a decision is expected (s.17(2))',
    'The complaints procedure, or that there is none (s.17(7)(a))',
    'The right to apply to the Information Commission under s.50 (s.17(7)(b))'
  ],
  eir: [
    'The reasons, including which exception applies (reg 14)',
    'The matters weighed in the public interest test (reg 14)',
    'The right to ask for reconsideration under reg 11 (reg 14)',
    'The rights of enforcement and appeal under reg 18 (reg 14)'
  ],
  foisa: [
    'That the information is held and an exemption is claimed, which one, and why it applies unless that is apparent or would disclose exempt information (s.16(1), (3))',
    'For an exemption that is not absolute, why the public interest favours withholding (s.16(2))',
    "The authority's complaints procedure (s.19)",
    'The right to require a review under s.20 and to apply to the Scottish Information Commissioner under s.47 (s.19)'
  ],
  eisr: [
    'The reasons, and the exception in reg 10 or 11 relied on (reg 13)',
    'How the public interest was weighed (reg 13)',
    'For material still being completed, when it is expected to be finished (reg 13)',
    'The rights to a review under reg 16 and to apply to the Scottish Information Commissioner under reg 17 (reg 13)'
  ]
};

export type InformationRequestClock =
  | { state: 'waiting'; words: string }
  | { state: 'running'; daysRemaining: number; dueAt: Date; words: string }
  | { state: 'due_soon'; daysRemaining: number; dueAt: Date; words: string }
  | { state: 'overdue'; daysOver: number; dueAt: Date; words: string }
  | { state: 'met'; dueAt: Date; respondedAt: Date; words: string }
  | { state: 'late'; dueAt: Date; respondedAt: Date; words: string }
  | { state: 'closed'; words: string };

/** Working days left before the deadline at which a request counts as due soon. */
export const DUE_SOON_WORKING_DAYS = 5;

const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

const workingDays = (n: number) =>
  n === 1 ? '1 working day' : `${n} working days`;

/** Fee pauses kept per regime: a fee charged under one regime pauses only that part. */
export type FeePauses = Partial<Record<FoiRegime, readonly Pause[]>>;

/**
 * The deadline for a request that may fall under more than one regime: the
 * earliest of its parts, because one response answers it and the part with
 * the shortest time sets when that response is due.
 *
 * Each part runs on its own rules. A fee pauses only the part it was charged
 * under, and a FOIA public interest extension (s.10(3)) moves only the FOIA
 * part: the environmental regulations have no such extension. A part waiting
 * for its fee is left out while another part is running.
 */
export function requestDeadline(input: {
  regimes: readonly FoiRegime[];
  startsAt: Date;
  profile?: TimeProfile;
  extendedForComplexity?: boolean;
  schoolDaysDeadline?: Date | null;
  commissionSetDeadline?: Date | null;
  feePauses?: FeePauses;
  publicInterestDate?: Date | null;
  now?: Date;
}): Date {
  const pi = input.publicInterestDate
    ? endOfDay(input.publicInterestDate)
    : null;
  const parts = input.regimes.map((regime) => {
    const pauses = input.feePauses?.[regime] ?? [];
    let due = responseDeadline({ ...input, regime, feePauses: pauses });
    if (regime === 'foia' && pi && pi > due) due = pi;
    return { due, waiting: pauses.some((p) => p.to === null) };
  });
  const running = parts.filter((p) => !p.waiting);
  return (running.length > 0 ? running : parts)
    .map((p) => p.due)
    .reduce((a, b) => (b < a ? b : a));
}

/** Whether every part of the request is waiting for its fee. */
export function waitingForFee(
  regimes: readonly FoiRegime[],
  feePauses: FeePauses = {}
): boolean {
  return regimes.every((r) => (feePauses[r] ?? []).some((p) => p.to === null));
}

/** How the request stands, said in words a handler can act on. */
export function informationRequestClock(input: {
  regimes: readonly FoiRegime[];
  receivedAt: Date;
  profile?: TimeProfile;
  clarificationSoughtAt?: Date | null;
  clarificationReceivedAt?: Date | null;
  extendedForComplexity?: boolean;
  schoolDaysDeadline?: Date | null;
  commissionSetDeadline?: Date | null;
  /** Fee notice to payment, per regime; `to` null while the fee is unpaid. */
  feePauses?: FeePauses;
  /**
   * FOIA s.10(3): the date given in the refusal notice for deciding the public
   * interest. The response is owed by then rather than by the ordinary
   * deadline, so long as the notice went out in time.
   */
  publicInterestDate?: Date | null;
  respondedAt?: Date | null;
  /** Closed without a response being owed, or converted to a subject access request. */
  closedWithoutResponse?: boolean;
  now?: Date;
}): InformationRequestClock {
  const now = input.now ?? new Date();
  if (input.closedWithoutResponse && !input.respondedAt)
    return { state: 'closed', words: 'Closed without a response being owed.' };

  const startsAt = clockStartsAt(input);
  if (!startsAt)
    return {
      state: 'waiting',
      words:
        'Waiting for the requester to say more about what they want. The twenty working days start again when they do. Nothing is owed until then.'
    };

  const dueAt = requestDeadline({ ...input, startsAt, now });
  const piDate = input.publicInterestDate
    ? endOfDay(input.publicInterestDate)
    : null;
  if (input.respondedAt)
    return input.respondedAt <= dueAt
      ? {
          state: 'met',
          dueAt,
          respondedAt: input.respondedAt,
          words: `Responded on ${longDate(input.respondedAt)}, within the time allowed.`
        }
      : {
          state: 'late',
          dueAt,
          respondedAt: input.respondedAt,
          words: `Responded on ${longDate(input.respondedAt)}, after the deadline of ${longDate(dueAt)}.`
        };

  if (waitingForFee(input.regimes, input.feePauses))
    return {
      state: 'waiting',
      words: `Waiting for the fee. Nothing is owed until it is paid, and the days until then do not count. If it were paid today, the deadline would be ${longDate(dueAt)}.`
    };

  const act = actOf(input.regimes[0] ?? 'foia');
  if (dueAt < now) {
    const over = Math.max(1, workingDaysBetween(dueAt, now, act));
    return {
      state: 'overdue',
      daysOver: over,
      dueAt,
      words: `${workingDays(over)} past the deadline of ${longDate(dueAt)}. The response is still owed, and the requester can complain to ${REGULATOR[act]}.`
    };
  }
  const remaining = workingDaysBetween(now, dueAt, act);
  if (remaining <= DUE_SOON_WORKING_DAYS)
    return {
      state: 'due_soon',
      daysRemaining: remaining,
      dueAt,
      words: `${workingDays(remaining)} left, to ${longDate(dueAt)}. Respond, or send the refusal notice, by then.`
    };
  return {
    state: 'running',
    daysRemaining: remaining,
    dueAt,
    words:
      piDate && dueAt.getTime() === piDate.getTime()
        ? `The public interest is being weighed. The refusal notice gave ${longDate(dueAt)} for the decision.`
        : `Due by ${longDate(dueAt)}.`
  };
}

/** The exemptions or exceptions a regime offers. */
export function exemptionsFor(
  regime: FoiRegime
): readonly (Exemption & { notForEmissions?: boolean })[] {
  return {
    foia: FOIA_EXEMPTIONS,
    eir: EIR_EXCEPTIONS,
    foisa: FOISA_EXEMPTIONS,
    eisr: EISR_EXCEPTIONS
  }[regime];
}

/**
 * The requester's own personal data. Not an exemption to apply and answer:
 * the request is a subject access request instead (FOIA s.40(1), FOI(S)A
 * s.38(1)(a); the environmental regulations exclude it from the start).
 */
export const OWN_DATA_PROVISIONS: readonly string[] = ['s.40(1)', 's.38(1)(a)'];
