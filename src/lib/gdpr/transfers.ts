/**
 * Transfer mechanisms under each law, and which transfer assessment a
 * transfer needs.
 *
 * Pure. Under the UK GDPR a restricted transfer rests on approval by
 * regulations (Article 45A), an Article 46 safeguard (the IDTA, the UK
 * Addendum to the EU standard contractual clauses, UK binding corporate
 * rules) that passes the data protection test, or an Article 49 derogation.
 * Under the EU GDPR it rests on an adequacy decision (Article 45), an Article
 * 46 safeguard (the standard contractual clauses of Implementing Decision (EU)
 * 2021/914, binding corporate rules, an approved code or certification), or a
 * derogation. An Article 46 safeguard needs an assessment of the destination:
 * the UK transfer risk assessment, the EU transfer impact assessment (Schrems
 * II, EDPB Recommendations 01/2020). Adequacy and derogations do not.
 *
 * The two laws' tools are not interchangeable: the EU clauses alone are not a
 * UK safeguard (they need the UK Addendum), and the IDTA is not an EU one.
 */

import type { DataProtectionLaw } from '@/lib/dpa2018/applies';

import type { Law } from './regimes';

export type TransferMechanism =
  | 'uk_approval'
  | 'idta'
  | 'uk_addendum'
  | 'uk_bcr'
  | 'eu_adequacy'
  | 'eu_scc'
  | 'eu_bcr'
  | 'eu_code_or_certification'
  | 'derogation';

export const TRANSFER_MECHANISMS: Record<
  TransferMechanism,
  {
    label: string;
    point: string;
    /** The laws it is a transfer tool under. */
    laws: readonly Law[];
    /** An Article 46 safeguard, so the destination must be assessed. */
    assessed: boolean;
  }
> = {
  uk_approval: {
    label: 'UK approval by regulations (including the UK-US data bridge)',
    point: 'UK GDPR Article 45A',
    laws: ['uk'],
    assessed: false
  },
  idta: {
    label: 'International data transfer agreement (IDTA)',
    point: 'UK GDPR Article 46',
    laws: ['uk'],
    assessed: true
  },
  uk_addendum: {
    label: 'UK Addendum to the EU standard contractual clauses',
    point: 'UK GDPR Article 46',
    laws: ['uk'],
    assessed: true
  },
  uk_bcr: {
    label: 'Binding corporate rules approved by the Information Commission',
    point: 'UK GDPR Articles 46-47',
    laws: ['uk'],
    assessed: true
  },
  eu_adequacy: {
    label:
      'EU adequacy decision (including the EU-US Data Privacy Framework, for a certified recipient)',
    point: 'EU GDPR Article 45',
    laws: ['eu'],
    assessed: false
  },
  eu_scc: {
    label: 'EU standard contractual clauses (2021/914)',
    point: 'EU GDPR Article 46(2)(c)',
    laws: ['eu'],
    assessed: true
  },
  eu_bcr: {
    label: 'Binding corporate rules approved under the EU GDPR',
    point: 'EU GDPR Articles 46-47',
    laws: ['eu'],
    assessed: true
  },
  eu_code_or_certification: {
    label: 'An approved code of conduct or certification',
    point: 'EU GDPR Article 46(2)(e)-(f)',
    laws: ['eu'],
    assessed: true
  },
  derogation: {
    label:
      'A derogation for a specific situation (explicit consent, contract, legal claims and the rest)',
    point: 'Article 49',
    laws: ['uk', 'eu'],
    assessed: false
  }
};

export const TRANSFER_MECHANISM_KEYS = Object.keys(
  TRANSFER_MECHANISMS
) as TransferMechanism[];

export function isTransferMechanism(v: unknown): v is TransferMechanism {
  return typeof v === 'string' && v in TRANSFER_MECHANISMS;
}

/** The EU clauses' modules (Implementing Decision (EU) 2021/914). */
export const SCC_MODULES = {
  1: 'Module 1 - controller to controller',
  2: 'Module 2 - controller to processor',
  3: 'Module 3 - processor to processor',
  4: 'Module 4 - processor to controller'
} as const;
export type SccModule = keyof typeof SCC_MODULES;

/** One mechanism as an agreement records it. */
export type RecordedMechanism = {
  mechanism: TransferMechanism;
  /** For the EU clauses: which module. */
  module?: SccModule | null;
};

export class TransferMechanismRefused extends Error {}

/** The mechanisms as stored: known ones, once each, a module only on the EU clauses. */
export function cleanMechanisms(
  input: ReadonlyArray<{ mechanism: string; module?: unknown }>
): RecordedMechanism[] {
  const out: RecordedMechanism[] = [];
  for (const m of input) {
    if (!isTransferMechanism(m.mechanism))
      throw new TransferMechanismRefused(
        `Not a transfer mechanism: ${m.mechanism}.`
      );
    if (out.some((o) => o.mechanism === m.mechanism)) continue;
    const moduleNo = Number(m.module);
    if (m.mechanism === 'eu_scc' && m.module != null && m.module !== '') {
      if (!(moduleNo in SCC_MODULES))
        throw new TransferMechanismRefused('Choose a module from 1 to 4.');
      out.push({ mechanism: 'eu_scc', module: moduleNo as SccModule });
    } else out.push({ mechanism: m.mechanism });
  }
  return out;
}

/**
 * Each part of the text, and the one mechanism it names. A part naming none,
 * or more than one, leaves the whole text unread: a guess would put a
 * mechanism on the record that nobody chose.
 */
const PATTERNS: Array<[TransferMechanism, RegExp]> = [
  ['idta', /\bidta\b|international data transfer agreement/i],
  ['uk_addendum', /\baddendum\b/i],
  [
    'uk_approval',
    /\bdata bridge\b|\buk extension\b|\buk (approval|adequacy)\b/i
  ],
  ['eu_scc', /\bsccs?\b|standard contractual clauses|2021\/914/i],
  ['eu_adequacy', /\bdpf\b|data privacy framework|\beu adequacy\b/i],
  ['eu_code_or_certification', /\bcode of conduct\b|\bcertification\b/i],
  ['derogation', /\bderogation\b|\barticle 49\b/i]
];

/**
 * Where one part names two mechanisms that mean one thing: "UK Addendum to
 * the SCCs" is the addendum, and "DPF certification" is the Framework, not a
 * certification mechanism.
 */
const OVERLAPS: Array<[TransferMechanism, TransferMechanism]> = [
  ['uk_addendum', 'eu_scc'],
  ['eu_adequacy', 'eu_code_or_certification']
];

function resolveOverlap(hits: TransferMechanism[]): TransferMechanism[] {
  if (hits.length !== 2) return hits;
  const pair = OVERLAPS.find(([a, b]) => hits.includes(a) && hits.includes(b));
  return pair ? [pair[0]] : hits;
}

export function mechanismsFromText(
  text: string | null | undefined
): TransferMechanism[] | null {
  if (!text?.trim()) return null;
  const parts = text
    .split(/[;,/+&\n]|\band\b|\bwith\b|\bplus\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const found: TransferMechanism[] = [];
  for (const part of parts) {
    const hits = PATTERNS.filter(([, re]) => re.test(part)).map(([m]) => m);
    // "SCCs with the UK Addendum" splits into two parts; a part matching
    // both the clauses and the addendum is the addendum.
    const one = resolveOverlap(hits);
    if (one.length !== 1) return null;
    if (!found.includes(one[0])) found.push(one[0]);
  }
  return found;
}

/** What an agreement or a transfer relies on: what was chosen, else what its text names. */
export function effectiveMechanisms(
  recorded: readonly RecordedMechanism[] | null | undefined,
  text: string | null | undefined
): TransferMechanism[] | null {
  if (recorded && recorded.length > 0) return recorded.map((r) => r.mechanism);
  return mechanismsFromText(text);
}

export type TransferAssessmentGap =
  | 'uk_transfer_no_tra'
  | 'eu_transfer_no_tia'
  | 'uk_transfer_mechanism_not_uk'
  | 'eu_transfer_mechanism_not_eu';

export const TRANSFER_ASSESSMENT_GAP_WORDS: Record<
  TransferAssessmentGap,
  string
> = {
  uk_transfer_no_tra:
    'UK transfer on an Article 46 safeguard with no transfer risk assessment',
  eu_transfer_no_tia:
    'EU transfer on an Article 46 safeguard with no transfer impact assessment',
  uk_transfer_mechanism_not_uk:
    'UK transfer on a mechanism that is not a UK transfer tool (the EU clauses need the UK Addendum)',
  eu_transfer_mechanism_not_eu:
    'EU transfer on a mechanism that is not an EU transfer tool'
};

/**
 * What one transfer needs under each law it is under. `restricted` says,
 * per law, whether the destination needs a safeguard at all (not adequate
 * under that law); `onFile` whether the assessment of that law is held.
 * Mechanisms not known (text nobody could read) ask nothing: the safeguard
 * gap is reported elsewhere, and a guess here would be a claim nobody made.
 */
export function assessmentsRequired(input: {
  laws: DataProtectionLaw;
  restricted: { uk: boolean; eu: boolean };
  mechanisms: readonly TransferMechanism[] | null;
  onFile: { tra: boolean; tia: boolean };
}): TransferAssessmentGap[] {
  if (!input.mechanisms || input.mechanisms.length === 0) return [];
  const gaps: TransferAssessmentGap[] = [];
  const check = (law: Law) => {
    if (!input.restricted[law]) return;
    const served = input.mechanisms!.filter((m) =>
      TRANSFER_MECHANISMS[m].laws.includes(law)
    );
    if (served.length === 0) {
      gaps.push(
        law === 'uk'
          ? 'uk_transfer_mechanism_not_uk'
          : 'eu_transfer_mechanism_not_eu'
      );
      return;
    }
    // A derogation or approval beside an Article 46 tool: the tool is what
    // the transfer rests on, and it is assessed.
    if (!served.some((m) => TRANSFER_MECHANISMS[m].assessed)) return;
    if (law === 'uk' && !input.onFile.tra) gaps.push('uk_transfer_no_tra');
    if (law === 'eu' && !input.onFile.tia) gaps.push('eu_transfer_no_tia');
  };
  if (input.laws !== 'eu') check('uk');
  if (input.laws !== 'uk') check('eu');
  return gaps;
}
