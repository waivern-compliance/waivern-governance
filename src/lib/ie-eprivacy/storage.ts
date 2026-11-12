/**
 * What the Irish ePrivacy Regulations (S.I. No. 336 of 2011) require of
 * cookies and similar technologies, and what the Data Protection Commission's
 * guidance adds, expressed once.
 *
 * Pure, like `lib/pecr/statutory.ts` beside it. Regulation 5(3) needs consent
 * and clear and comprehensive information before anything is stored on, or
 * read from, a person's device. Regulation 5(5) has only two exceptions:
 * storage solely to carry a communication, and storage strictly necessary for
 * a service the person explicitly asked for. There is nothing like PECR's
 * statistics or appearance exceptions (Schedule A1).
 *
 * The page references are to the Commission's "Guidance note on cookies and
 * other tracking technologies" (April 2020), by the note's own page numbers.
 * It decides nothing: a person records the basis each item relies on.
 */

import type {
  BasisSpec,
  ConditionKey,
  Gap,
  StorageBasis
} from '@/lib/pecr/statutory';

/** The bases Irish law has: three of PECR's keys, with the Irish citations. */
export type IrishBasis = Extract<
  StorageBasis,
  'consent' | 'transmission' | 'strictly_necessary' | 'none'
>;

export const IE_BASES: Record<IrishBasis, BasisSpec> = {
  consent: {
    label: 'Consent',
    citation: 'S.I. 336/2011 reg 5(3)',
    summary:
      "The person's consent before it is set, given purpose by purpose, after clear and comprehensive information that is prominently displayed and easy to reach.",
    conditions: [],
    needsInformation: true
  },
  transmission: {
    label: 'Transmission',
    citation: 'S.I. 336/2011 reg 5(5)',
    summary:
      'Solely to carry out the transmission of a communication over a network, such as a load-balancing cookie. Speeding up or regulating a transmission is not enough (DPC guidance, page 6).',
    conditions: [
      {
        key: 'sole_purpose',
        label: 'Its only purpose is carrying the communication'
      }
    ],
    needsInformation: false
  },
  strictly_necessary: {
    label: 'Strictly necessary',
    citation: 'S.I. 336/2011 reg 5(5)',
    summary:
      'Strictly necessary for a service the person explicitly asked for, such as a shopping basket or a language choice. Never advertising; a chat window’s cookies only once the chat is opened; a long-lived preference cookie needs consent (DPC guidance, pages 6 and 7).',
    conditions: [
      {
        key: 'requested_service',
        label:
          'The person explicitly asked for the service, and it would not work without it'
      }
    ],
    needsInformation: false
  },
  none: {
    label: 'No basis',
    citation: 'S.I. 336/2011 reg 5(3)',
    summary:
      'Neither exception in regulation 5(5) covers it. Remove it, or put it behind consent.',
    conditions: [],
    needsInformation: false
  }
};

export const IE_BASIS_KEYS = Object.keys(IE_BASES) as IrishBasis[];

export function isIrishBasis(v: unknown): v is IrishBasis {
  return typeof v === 'string' && v in IE_BASES;
}

/**
 * The basis a scanner's category points towards under Irish law. Only
 * strictly necessary has an exception; everything else needs consent, however
 * it is labelled (DPC guidance, page 6). A suggestion, never applied.
 */
export function suggestedIrishBasis(
  category: string | null | undefined
): IrishBasis | null {
  if (!category || category === 'unknown') return null;
  return category === 'strictly_necessary' ? 'strictly_necessary' : 'consent';
}

/** The default for how long a strictly necessary item may last, in months, before it is flagged (decision 11). */
export const DEFAULT_LIFESPAN_THRESHOLD_MONTHS = 12;

/** The Commission's outer limit on stored consent before people are asked again (guidance pages 8 and 11). */
export const CONSENT_RENEWAL_LIMIT_MONTHS = 6;

const MONTHS_PER: Record<string, number> = {
  year: 12,
  month: 1,
  week: 12 / 52,
  day: 12 / 365,
  hour: 12 / (365 * 24),
  minute: 12 / (365 * 24 * 60),
  second: 12 / (365 * 24 * 3600)
};

/**
 * How many months an item lasts, from what the analyser or a person wrote:
 * "session" is none, "13 months" is thirteen, "2 years" twenty-four. Null where
 * it cannot be read, which raises nothing: a guess would be a claim.
 */
export function lifespanMonths(
  expiry: string | null | undefined
): number | null {
  const text = expiry?.trim().toLowerCase();
  if (!text) return null;
  if (/^session\b/.test(text)) return 0;
  // Every number and unit, added up: "1 year 6 months" is eighteen.
  const parts = [
    ...text.matchAll(
      /(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|mths?|weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|seconds?|secs?|s)\b/g
    )
  ];
  if (parts.length === 0) return null;
  return parts.reduce(
    (sum, [, n, unit]) => sum + Number(n) * monthsPer(unit),
    0
  );
}

function monthsPer(unit: string): number {
  if (/^(y|yrs?|years?)$/.test(unit)) return MONTHS_PER.year;
  if (/^(mos?|mths?|months?)$/.test(unit)) return MONTHS_PER.month;
  if (/^(w|wks?|weeks?)$/.test(unit)) return MONTHS_PER.week;
  if (/^(d|days?)$/.test(unit)) return MONTHS_PER.day;
  if (/^(h|hrs?|hours?)$/.test(unit)) return MONTHS_PER.hour;
  if (/^(mins?|minutes?)$/.test(unit)) return MONTHS_PER.minute;
  return MONTHS_PER.second;
}

export type IrishGapInput = {
  item: {
    status: string;
    suggestedCategory: string | null;
    expiry: string | null;
    seenBeforeConsent: boolean | null;
    seenAfterReject: boolean | null;
  };
  decision: {
    basis: StorageBasis;
    conditions: Partial<Record<ConditionKey, boolean>>;
  } | null;
  property: { informationUrl: string | null };
  /** The organisation's threshold for a strictly necessary item's lifespan. */
  lifespanThresholdMonths: number;
};

const ANALYTICS_WORDS =
  "Analytics cookies need consent under Irish law. The Commission says first-party analytics are 'unlikely' to be an enforcement priority, but that does not exempt them (DPC guidance, pages 7 and 8).";

/**
 * What the record does not yet show for one item under the Irish
 * Regulations. Each gap is a sentence a handler can act on.
 */
export function irishGapsOf(input: IrishGapInput): Gap[] {
  const { item, decision, property } = input;
  if (item.status === 'removed') return [];
  const category = item.suggestedCategory;
  if (!decision || !isIrishBasis(decision.basis))
    return [
      {
        kind: 'no_basis',
        text: 'No basis recorded under the Irish Regulations.'
      },
      ...(category === 'analytics'
        ? [{ kind: 'analytics_needs_consent' as const, text: ANALYTICS_WORDS }]
        : [])
    ];
  const basis = IE_BASES[decision.basis];
  if (decision.basis === 'none')
    return [
      {
        kind: 'basis_none',
        text: 'Recorded as having no basis under the Irish Regulations: remove it, or put it behind consent.'
      }
    ];

  const out: Gap[] = [];
  for (const c of basis.conditions) {
    if (!decision.conditions[c.key])
      out.push({
        kind: 'condition_unconfirmed',
        text: `Not confirmed: ${c.label.toLowerCase()} (${basis.citation}).`
      });
  }
  if (category === 'analytics' && decision.basis !== 'consent')
    out.push({ kind: 'analytics_needs_consent', text: ANALYTICS_WORDS });
  if (category === 'advertising' && decision.basis !== 'consent')
    out.push({
      kind: 'advertising_not_necessary',
      text: 'Advertising cookies are never strictly necessary and must be consented to (DPC guidance, page 6).'
    });
  if (decision.basis === 'strictly_necessary') {
    const months = lifespanMonths(item.expiry);
    if (months !== null && months > input.lifespanThresholdMonths)
      out.push({
        kind: 'lifespan_long',
        text: `Recorded as strictly necessary, but it lasts ${item.expiry}, longer than the organisation's ${input.lifespanThresholdMonths}-month threshold. Check the lifespan is proportionate to its purpose (DPC guidance, pages 3 and 13).`
      });
  }
  if (basis.needsInformation && !property.informationUrl?.trim())
    out.push({
      kind: 'no_information',
      text: 'No clear and comprehensive information recorded for this website or app - where people are told about it (reg 5(3)(b)).'
    });
  if (decision.basis === 'consent' && item.seenBeforeConsent)
    out.push({
      kind: 'before_consent',
      text: 'Relies on consent, but the last scan saw it before any consent was given.'
    });
  if (decision.basis === 'consent' && item.seenAfterReject)
    out.push({
      kind: 'after_reject',
      text: 'The last scan still saw it after the person refused or rejected.'
    });
  return out;
}

/** The banner and consent checks the Commission's guidance asks of a website or app. */
export const BANNER_CHECKS = {
  reject_as_prominent: {
    label:
      "A reject or manage option is as prominent as accept; there is no accept-only or 'I understand' banner",
    pages: 'pages 9 and 12'
  },
  per_purpose: {
    label: 'Consent is asked purpose by purpose, not bundled',
    pages: 'page 8'
  },
  no_preticked: {
    label: 'No boxes or sliders are ticked or switched on in advance',
    pages: 'pages 8 and 10'
  },
  no_implied: {
    label:
      'Scrolling, clicking on or carrying on with the page is never taken as consent',
    pages: 'pages 9 and 10'
  },
  withdraw_easily: {
    label: 'Withdrawing consent is as easy as giving it',
    pages: 'pages 8 and 11'
  },
  policies_readable: {
    label:
      'The cookie and privacy policies can be read with no cookie but an exempt one set, and the banner does not cover them',
    pages: 'page 12'
  }
} as const;

export type BannerCheck = keyof typeof BANNER_CHECKS;

export const BANNER_CHECK_KEYS = Object.keys(BANNER_CHECKS) as BannerCheck[];

export type IrishPropertyGapInput = {
  consentRenewalMonths: number | null;
  consentRenewalJustification: string | null;
  bannerChecks: Partial<Record<BannerCheck, boolean>>;
  /** Whether any item in use relies on consent under the Irish Regulations. */
  usesConsent: boolean;
};

/**
 * What a website or app as a whole does not yet show under the Irish
 * Regulations: how long consent lasts, and the banner. Asked only where
 * something relies on consent.
 */
export function irishPropertyGaps(input: IrishPropertyGapInput): string[] {
  if (!input.usesConsent) return [];
  const out: string[] = [];
  if (input.consentRenewalMonths === null)
    out.push(
      `How long stored consent lasts before people are asked again is not recorded. The Commission's outer limit is ${CONSENT_RENEWAL_LIMIT_MONTHS} months (DPC guidance, pages 8 and 11).`
    );
  else if (
    input.consentRenewalMonths > CONSENT_RENEWAL_LIMIT_MONTHS &&
    !input.consentRenewalJustification?.trim()
  )
    out.push(
      `Stored consent lasts ${input.consentRenewalMonths} months, longer than the Commission's ${CONSENT_RENEWAL_LIMIT_MONTHS}, with no justification recorded (DPC guidance, pages 8 and 11).`
    );
  for (const key of BANNER_CHECK_KEYS) {
    if (!input.bannerChecks[key])
      out.push(
        `Not confirmed: ${BANNER_CHECKS[key].label.charAt(0).toLowerCase()}${BANNER_CHECKS[key].label.slice(1)} (DPC guidance, ${BANNER_CHECKS[key].pages}).`
      );
  }
  return out;
}

/** The checks as stored: known keys only, each true or false. */
export function cleanBannerChecks(
  checks: Iterable<string>
): Record<BannerCheck, boolean> {
  const ticked = new Set(checks);
  return Object.fromEntries(
    BANNER_CHECK_KEYS.map((k) => [k, ticked.has(k)])
  ) as Record<BannerCheck, boolean>;
}
