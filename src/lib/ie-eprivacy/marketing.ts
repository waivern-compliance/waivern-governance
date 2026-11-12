/**
 * What the Irish ePrivacy Regulations (S.I. No. 336 of 2011, regulation 13)
 * require of electronic direct marketing, expressed once.
 *
 * Pure, like `lib/pecr/marketing.ts` beside it, and the same shape: which
 * bases a channel can rely on, what each needs, and what a recorded decision
 * is still missing. The differences from PECR that matter here:
 *
 * - Email and text (including SMS) to a natural person need consent
 *   (13(1)), or the soft opt-in (13(11)), which runs only for twelve months
 *   from the sale, and has no charity version.
 * - Email to an address that reasonably appears to be used mainly for the
 *   person's business, about that business only, needs only that they have
 *   not objected (13(2) with 13(4)). Organisations that are not natural
 *   persons may be emailed unless they objected (13(4)).
 * - Live calls may go to landlines not opted out in the National Directory
 *   Database and not objected (13(5)); calls to mobiles need consent (13(6)).
 *   An opt-out binds after 28 days (13(9)).
 * - Each message or call without a basis is a separate offence (13(13)(b)),
 *   and the sender must prove each person consented (13(14)). A missing record
 *   of consent is therefore a serious gap (decision 6).
 *
 * Enforced mainly by the Data Protection Commission (regulations 17 and 26);
 * ComReg takes marketing that meets telecoms rules, such as nuisance calls or
 * spoofed caller identification.
 */

import {
  isPecrMarketingBasis,
  MARKETING_BASES,
  type MarketingBasis,
  type MarketingBasisSpec,
  type MarketingChannel,
  type MarketingCondition,
  type MarketingConditionKey,
  type MarketingGap,
  type MarketingRecipients
} from '@/lib/pecr/marketing';

/** The bases Irish law has. Consent, the soft opt-in and none share PECR's keys. */
export type IrishMarketingBasis = Extract<
  MarketingBasis,
  | 'consent'
  | 'soft_opt_in'
  | 'business_address'
  | 'not_objected'
  | 'ndd_screened'
  | 'none'
>;

/** How long a National Directory Database screening holds: an opt-out binds after 28 days (13(9)). */
export const NDD_SCREENING_DAYS = 28;

/** Whom a call activity rings: landlines, mobiles, or both. Asked under Irish law, where mobiles need consent. */
export type CallNumbers = 'landline' | 'mobile' | 'both';

export const CALL_NUMBERS: Record<CallNumbers, string> = {
  landline: 'Landlines only',
  mobile: 'Mobiles only',
  both: 'Landlines and mobiles'
};

export function isCallNumbers(v: unknown): v is CallNumbers {
  return typeof v === 'string' && v in CALL_NUMBERS;
}

const EMAIL_AND_TEXT: readonly MarketingChannel[] = ['email', 'sms'];
const CALLS: readonly MarketingChannel[] = ['live_call', 'automated_call'];

const NO_OBJECTION: MarketingCondition = {
  key: 'no_prior_objection',
  label: 'Nobody who has objected, free of charge, is contacted (13(8))'
};

/** What every message must say about who sent it, by channel (13(10), (12)). */
const IDENTITY: Record<MarketingChannel, MarketingCondition> = {
  email: {
    key: 'contact_identified',
    label:
      'Every message gives a valid address to contact and opt out, and does not hide who it is from (13(10)(c), 13(12))'
  },
  sms: {
    key: 'contact_identified',
    label:
      'Every message gives a valid address to contact and opt out, and does not hide who it is from (13(10)(c), 13(12))'
  },
  live_call: {
    key: 'contact_identified',
    label:
      "Each call gives the caller's name and, where relevant, whom it is for (13(10)(a))"
  },
  automated_call: {
    key: 'contact_identified',
    label:
      'Each call gives the name, address and telephone number of the caller and of whom it is for (13(10)(b))'
  }
};

export const IE_MARKETING_BASES: Record<
  IrishMarketingBasis,
  MarketingBasisSpec
> = {
  consent: {
    label: 'Consent',
    citation: 'S.I. 336/2011 reg 13(1), (6)',
    summary:
      'Each person told this organisation they consent. The organisation must be able to prove it for every message or call: the burden is on the sender (13(14)).',
    channels: ['email', 'sms', 'live_call', 'automated_call'],
    conditions: [
      {
        key: 'consent_specific',
        label: 'Given to this organisation by name, for this kind of message'
      },
      {
        key: 'consent_recorded',
        label:
          'When and how each person consented is recorded, so it can be proved for each message'
      },
      {
        key: 'consent_withdrawable',
        label: 'It is as easy to withdraw as it was to give'
      }
    ]
  },
  soft_opt_in: {
    label: 'Soft opt-in',
    citation: 'S.I. 336/2011 reg 13(11)',
    summary:
      "Details got from a customer in the sale of a product or service, used for this organisation's own similar products or services, with a clear, free and easy chance to object at collection and in every message, and only within twelve months of the sale.",
    channels: EMAIL_AND_TEXT,
    conditions: [
      {
        key: 'obtained_in_sale',
        label: 'The details were got in the course of a sale'
      },
      {
        key: 'similar_products',
        label:
          "It markets only this organisation's own products or services of a similar kind"
      },
      {
        key: 'refusal_at_collection',
        label:
          'People were clearly given a free, easy way to object when their details were collected'
      },
      {
        key: 'refusal_every_message',
        label: 'Every message since gives the same free, easy way to object'
      },
      {
        key: 'within_12_months',
        label:
          'Each message goes within twelve months of the sale, or of the details last being used for email marketing (13(11)(d))'
      }
    ]
  },
  business_address: {
    label: 'Business addresses, about that business',
    citation: 'S.I. 336/2011 reg 13(2), (4)',
    summary:
      "Email to a person's address that reasonably appears to be used mainly for their business or official work, about that work only. Needs only that they have not objected.",
    channels: ['email'],
    conditions: [
      {
        key: 'business_use',
        label:
          "Each address reasonably appears to be used mainly for the person's business or official work"
      },
      {
        key: 'business_related',
        label: 'The message relates solely to that work'
      },
      NO_OBJECTION
    ]
  },
  not_objected: {
    label: 'Organisations that have not objected',
    citation: 'S.I. 336/2011 reg 13(3), (4)',
    summary:
      'Sent only to subscribers that are not natural persons, such as companies, that have not objected; automated calls also only to numbers not opted out in the National Directory Database.',
    channels: ['email', 'sms', 'automated_call'],
    conditions: [
      {
        key: 'non_natural_only',
        label: 'Never sent to a natural person, including a sole trader'
      },
      NO_OBJECTION
    ]
  },
  ndd_screened: {
    label: 'Screened against the National Directory Database',
    citation: 'S.I. 336/2011 reg 13(5)',
    summary:
      'Live calls to landlines screened against the National Directory Database within the last 28 days, less anyone who has objected. Calls to mobiles need consent (13(6)).',
    channels: ['live_call'],
    conditions: [NO_OBJECTION]
  },
  none: {
    label: 'No basis',
    citation: 'S.I. 336/2011 reg 13',
    summary:
      'Nothing in regulation 13 covers it. Stop it: each message or call would be a separate offence (13(13)(b)).',
    channels: ['email', 'sms', 'live_call', 'automated_call'],
    conditions: []
  }
};

export const IE_MARKETING_BASIS_KEYS = Object.keys(
  IE_MARKETING_BASES
) as IrishMarketingBasis[];

export function isIrishMarketingBasis(v: unknown): v is IrishMarketingBasis {
  return typeof v === 'string' && v in IE_MARKETING_BASES;
}

/** What a basis needs on a channel, with what every message must say about its sender. */
export function irishConditionsOf(
  basis: IrishMarketingBasis,
  channel: MarketingChannel
): MarketingCondition[] {
  const own = IE_MARKETING_BASES[basis].conditions;
  return basis === 'none' ? own : [...own, IDENTITY[channel]];
}

/** The bases a channel can rely on under Irish law, given who it reaches. */
export function irishBasesFor(
  channel: MarketingChannel,
  recipients: MarketingRecipients
): IrishMarketingBasis[] {
  return IE_MARKETING_BASIS_KEYS.filter(
    (b) =>
      IE_MARKETING_BASES[b].channels.includes(channel) &&
      (b !== 'not_objected' || recipients === 'businesses') &&
      (b !== 'business_address' || recipients !== 'businesses')
  );
}

/** The conditions confirmed, keeping only those the basis needs on the channel. */
export function irishConditionsFor(
  basis: IrishMarketingBasis,
  channel: MarketingChannel,
  confirmed: Iterable<string>
): Partial<Record<MarketingConditionKey, boolean>> {
  const wanted = new Set(irishConditionsOf(basis, channel).map((c) => c.key));
  const out: Partial<Record<MarketingConditionKey, boolean>> = {};
  for (const k of confirmed)
    if (wanted.has(k as MarketingConditionKey))
      out[k as MarketingConditionKey] = true;
  return out;
}

const DAY = 86_400_000;

export function nddDueAt(screenedAt: Date | null): Date | null {
  return screenedAt
    ? new Date(screenedAt.getTime() + NDD_SCREENING_DAYS * DAY)
    : null;
}

export type IrishMarketingGapInput = {
  activity: {
    channel: MarketingChannel;
    recipients: MarketingRecipients;
    status: string;
    callNumbers: CallNumbers | null;
    nddScreenedAt: Date | null;
    inServiceTexts: boolean | null;
  };
  decision: {
    basis: MarketingBasis;
    conditions: Partial<Record<MarketingConditionKey, boolean>>;
  } | null;
};

/**
 * What the record does not yet show under the Irish Regulations. The gaps
 * both laws share (objections, the ROPA link) are judged once, elsewhere.
 */
export function irishMarketingGapsOf(
  input: IrishMarketingGapInput,
  now = new Date()
): MarketingGap[] {
  const { activity, decision } = input;
  if (activity.status === 'ended') return [];
  const out: MarketingGap[] = [];
  const calls = CALLS.includes(activity.channel);

  if (calls && !activity.callNumbers)
    out.push({
      kind: 'call_numbers_unknown',
      text: 'Not recorded whether it calls landlines or mobiles. Under Irish law, calls to mobiles need consent (13(6)).'
    });
  if (!decision) {
    out.push({
      kind: 'no_basis',
      text: 'No basis recorded under the Irish Regulations.'
    });
    return out;
  }
  if (decision.basis === 'none') {
    out.push({
      kind: 'basis_none',
      text: 'Recorded as having no basis under the Irish Regulations: it should stop. Each message or call would be a separate offence (13(13)(b)).'
    });
    return out;
  }
  if (
    !isIrishMarketingBasis(decision.basis) ||
    !irishBasesFor(activity.channel, activity.recipients).includes(
      decision.basis
    )
  ) {
    out.push({
      kind: 'basis_not_available',
      text: 'That basis is not available under the Irish Regulations for this channel and these recipients.'
    });
    return out;
  }
  for (const c of irishConditionsOf(decision.basis, activity.channel)) {
    if (decision.conditions[c.key]) continue;
    out.push(
      c.key === 'consent_recorded'
        ? {
            kind: 'consent_unrecorded',
            text: "Consent is not recorded so it can be proved. Under Irish law the sender must prove each person's consent (13(14)), and each message without it is a separate offence (13(13)(b))."
          }
        : {
            kind: 'condition_unconfirmed',
            text: `Not confirmed: ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}.`
          }
    );
  }
  if (
    calls &&
    decision.basis !== 'consent' &&
    (activity.callNumbers === 'mobile' || activity.callNumbers === 'both')
  )
    out.push({
      kind: 'mobile_needs_consent',
      text: 'It calls mobiles, which under Irish law needs consent, given to the caller or recorded in the National Directory Database (13(6)).'
    });
  // Live landline calls, and automated calls to organisations, are screened.
  if (
    decision.basis === 'ndd_screened' ||
    (decision.basis === 'not_objected' && activity.channel === 'automated_call')
  ) {
    const due = nddDueAt(activity.nddScreenedAt);
    if (!due)
      out.push({
        kind: 'ndd_never',
        text: 'No National Directory Database screening recorded.'
      });
    else if (due.getTime() < now.getTime())
      out.push({
        kind: 'ndd_stale',
        text: `Last screened against the National Directory Database more than ${NDD_SCREENING_DAYS} days ago; an opt-out binds after 28 days (13(9)).`
      });
  }
  if (
    activity.channel === 'sms' &&
    activity.inServiceTexts &&
    decision.basis !== 'consent'
  )
    out.push({
      kind: 'service_texts',
      text: 'It adds marketing to texts sent for another purpose, which needs consent (13(7)).'
    });
  return out;
}

/**
 * Who enforces what an Irish marketing gap is about. The Data Protection
 * Commission, except where the marketing meets telecoms rules, which is
 * ComReg's: as the two divide the work under regulation 33.
 */
export const IRISH_MARKETING_REGULATOR =
  'Enforced by the Data Protection Commission, which prosecutes each message or call as a separate offence. ComReg takes cases that meet telecoms rules, such as nuisance or spoofed calls.';

/** A basis as recorded under a law, for showing it. Null for a key that law does not have. */
export function marketingBasisSpec(
  basis: MarketingBasis,
  law: 'uk' | 'ie'
): MarketingBasisSpec | null {
  if (law === 'ie')
    return isIrishMarketingBasis(basis) ? IE_MARKETING_BASES[basis] : null;
  return isPecrMarketingBasis(basis) ? MARKETING_BASES[basis] : null;
}
