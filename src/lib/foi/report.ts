/**
 * The figures about freedom of information requests that authorities publish
 * and the regulators ask for: how many came in, how many were answered in
 * time, what the answers came to, which exemptions and exceptions were relied
 * on, and how reviews went.
 *
 * Pure: the service loads the records, this counts them. Counts only, so the
 * figures can go on a page, into a spreadsheet or a board paper without any
 * requester going with them.
 *
 * Each figure is for the requests received in the period, as the published
 * statistics count them, so a quarter's figures settle once its requests are
 * answered. A request under both an Act and its environmental regulations is
 * counted once in the total and once under each regime: one response answers
 * it, by the earlier of the two deadlines. Reviews and cases before the
 * regulator are counted with the request they are about, whenever they
 * happened.
 */

import { REGIME, type FoiRegime } from './statutory';

export const FOI_REGIMES: readonly FoiRegime[] = [
  'foia',
  'eir',
  'foisa',
  'eisr'
];

/** What a response came to, in words. Mirrors `informationRequestOutcome`. */
export const OUTCOME_LABEL = {
  released_in_full: 'Released in full',
  released_in_part: 'Released in part',
  withheld_in_full: 'Withheld in full',
  refused_request: 'Request refused as a whole',
  not_held: 'Not held'
} as const;

export type Outcome = keyof typeof OUTCOME_LABEL;

export const OUTCOME_HINT: Record<Outcome, string> = {
  released_in_full: 'Everything asked for that is held was sent.',
  released_in_part:
    'Some was sent and the rest withheld under an exemption or exception.',
  withheld_in_full:
    'Nothing was sent: all of it withheld, or neither confirmed nor denied.',
  refused_request:
    'The cost limit, a vexatious or repeated request, or manifestly unreasonable.',
  not_held: 'None of the information is held.'
};

// ---------------------------------------------------------------------------
// Periods

export type ReportPeriod = {
  /** `2026` or `2026-Q3`, as it goes in the address. */
  key: string;
  label: string;
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
};

const QUARTER_MONTHS = [
  'January to March',
  'April to June',
  'July to September',
  'October to December'
];

function year(y: number): ReportPeriod {
  return {
    key: String(y),
    label: String(y),
    from: new Date(Date.UTC(y, 0, 1)),
    to: new Date(Date.UTC(y + 1, 0, 1))
  };
}

function quarter(y: number, q: number): ReportPeriod {
  return {
    key: `${y}-Q${q}`,
    label: `${QUARTER_MONTHS[q - 1]} ${y}`,
    from: new Date(Date.UTC(y, (q - 1) * 3, 1)),
    to: new Date(Date.UTC(y, q * 3, 1))
  };
}

/**
 * The period an address names: a calendar year or quarter. Anything else,
 * including a period that has not started, is this year so far.
 */
export function reportPeriod(
  key: string | undefined,
  now = new Date()
): ReportPeriod {
  const fallback = year(now.getUTCFullYear());
  const m = /^(\d{4})(?:-Q([1-4]))?$/.exec(key ?? '');
  if (!m) return fallback;
  const period = m[2]
    ? quarter(Number(m[1]), Number(m[2]))
    : year(Number(m[1]));
  return period.from > now ? fallback : period;
}

/**
 * The periods to choose from, newest first: each year since the first
 * request, and each of its quarters that has begun.
 */
export function reportPeriods(
  first: Date | null,
  now = new Date()
): ReportPeriod[] {
  const thisYear = now.getUTCFullYear();
  const firstYear = Math.min(first?.getUTCFullYear() ?? thisYear, thisYear);
  const out: ReportPeriod[] = [];
  for (let y = thisYear; y >= firstYear; y--) {
    out.push(year(y));
    for (let q = 4; q >= 1; q--) {
      const p = quarter(y, q);
      if (p.from <= now) out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Figures

export type ReportRequest = {
  id: string;
  regimes: readonly FoiRegime[];
  receivedAt: Date;
  status: 'open' | 'responded' | 'closed' | 'converted';
  /** From the request's clock now. */
  clockState: string;
  outcome: Outcome | null;
};

/** A refusing decision: an exemption, exception, or a refusal of the whole request. */
export type ReportRefusal = {
  requestId: string;
  kind: string;
  regime: FoiRegime | null;
  provision: string | null;
  title: string | null;
};

/** Counted with the request it is about, so a period's figures follow its requests through. */
export type ReportReview = {
  requestId: string;
  status: 'open' | 'decided' | 'withdrawn';
  outcome: 'upheld' | 'varied' | 'reversed' | 'declined' | null;
  clockState: string;
};

/** Counted with the request it is about, like reviews. */
export type ReportRegulatorEvent = { requestId: string; kind: string };

export type Timeliness = {
  received: number;
  inTime: number;
  late: number;
  /** Still open and past the deadline now. */
  overdue: number;
  /** Open and still in time, or waiting for clarification or a fee. */
  inProgress: number;
  /** Closed without a response being owed: withdrawn, a duplicate, or now a subject access request. */
  noResponseOwed: number;
  /** Answered in time, out of those whose time has run: null if none has. */
  inTimeRate: number | null;
};

export type RefusalCount = {
  regime: FoiRegime | null;
  provision: string;
  label: string;
  /** Requests it was relied on in. */
  requests: number;
};

export type FoiFigures = {
  total: Timeliness;
  byRegime: Array<
    Timeliness & { regime: FoiRegime; label: string; short: string }
  >;
  outcomes: Array<{ outcome: Outcome | null; label: string; count: number }>;
  refusals: RefusalCount[];
  reviews: {
    requested: number;
    decidedInTime: number;
    decidedLate: number;
    overdue: number;
    open: number;
    withdrawn: number;
    upheld: number;
    varied: number;
    reversed: number;
    declined: number;
  };
  regulator: { applications: number; decisionNotices: number; appeals: number };
};

const within = (d: Date, p: ReportPeriod) => d >= p.from && d < p.to;

function timeliness(rows: readonly ReportRequest[]): Timeliness {
  const count = (states: string[]) =>
    rows.filter((r) => states.includes(r.clockState)).length;
  const inTime = count(['met']);
  const late = count(['late']);
  const overdue = count(['overdue']);
  const noResponseOwed = rows.filter(
    (r) => r.status === 'closed' || r.status === 'converted'
  ).length;
  const due = inTime + late + overdue;
  return {
    received: rows.length,
    inTime,
    late,
    overdue,
    inProgress: rows.length - inTime - late - overdue - noResponseOwed,
    noResponseOwed,
    inTimeRate: due === 0 ? null : inTime / due
  };
}

const KIND_LABEL: Record<string, string> = {
  neither_confirm_nor_deny: 'Neither confirm nor deny',
  cost_limit: 'Cost limit',
  vexatious: 'Vexatious',
  repeated: 'Repeated'
};

export function foiFigures(input: {
  period: ReportPeriod;
  requests: readonly ReportRequest[];
  refusals: readonly ReportRefusal[];
  reviews: readonly ReportReview[];
  regulatorEvents: readonly ReportRegulatorEvent[];
}): FoiFigures {
  const { period } = input;
  const requests = input.requests.filter((r) => within(r.receivedAt, period));
  const ids = new Set(requests.map((r) => r.id));

  const byRegime = FOI_REGIMES.map((regime) => ({
    regime,
    label: REGIME[regime].label,
    short: REGIME[regime].short,
    ...timeliness(requests.filter((r) => r.regimes.includes(regime)))
  })).filter((r) => r.received > 0);

  const responded = requests.filter((r) => r.status === 'responded');
  const outcomes = [
    ...(Object.keys(OUTCOME_LABEL) as Outcome[]).map((outcome) => ({
      outcome,
      label: OUTCOME_LABEL[outcome],
      count: responded.filter((r) => r.outcome === outcome).length
    })),
    {
      outcome: null,
      label: 'Not recorded',
      count: responded.filter((r) => r.outcome === null).length
    }
  ].filter((o) => o.count > 0 || o.outcome !== null);

  // Each ground once per request, however many decisions relied on it.
  const grounds = new Map<string, RefusalCount & { seen: Set<string> }>();
  for (const d of input.refusals) {
    if (!ids.has(d.requestId)) continue;
    const provision = d.provision ?? KIND_LABEL[d.kind] ?? d.kind;
    const key = `${d.regime ?? ''}|${provision}`;
    const entry = grounds.get(key) ?? {
      regime: d.regime,
      provision,
      label: d.title ?? KIND_LABEL[d.kind] ?? d.kind.replace(/_/g, ' '),
      requests: 0,
      seen: new Set<string>()
    };
    if (!entry.seen.has(d.requestId)) {
      entry.seen.add(d.requestId);
      entry.requests += 1;
    }
    grounds.set(key, entry);
  }
  const refusals = [...grounds.values()]
    .map(({ seen: _seen, ...r }) => r)
    .sort(
      (a, b) =>
        b.requests - a.requests ||
        FOI_REGIMES.indexOf(a.regime as FoiRegime) -
          FOI_REGIMES.indexOf(b.regime as FoiRegime) ||
        a.provision.localeCompare(b.provision, 'en', { numeric: true })
    );

  const reviews = input.reviews.filter((r) => ids.has(r.requestId));
  const outcomeOf = (o: ReportReview['outcome']) =>
    reviews.filter((r) => r.outcome === o).length;

  const events = input.regulatorEvents.filter((e) => ids.has(e.requestId));
  const eventsOf = (kind: string) =>
    events.filter((e) => e.kind === kind).length;

  return {
    total: timeliness(requests),
    byRegime,
    outcomes,
    refusals,
    reviews: {
      requested: reviews.length,
      decidedInTime: reviews.filter((r) => r.clockState === 'met').length,
      decidedLate: reviews.filter((r) => r.clockState === 'late').length,
      overdue: reviews.filter((r) => r.clockState === 'overdue').length,
      open: reviews.filter((r) => r.status === 'open').length,
      withdrawn: reviews.filter((r) => r.status === 'withdrawn').length,
      upheld: outcomeOf('upheld'),
      varied: outcomeOf('varied'),
      reversed: outcomeOf('reversed'),
      declined: outcomeOf('declined')
    },
    regulator: {
      applications: eventsOf('application'),
      decisionNotices: eventsOf('decision_notice'),
      appeals: eventsOf('appeal_lodged')
    }
  };
}

/** A rate as people read it: "92%", or a dash where nothing has fallen due. */
export function percent(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate * 100)}%`;
}
