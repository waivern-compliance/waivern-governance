import { z } from 'zod';

import {
  LAWFUL_BASIS_KEYS,
  RECOGNISED_CONDITION_KEYS
} from '@/lib/gdpr/lawful-basis';

import {
  automatedDecisionsWire,
  furtherProcessingWire,
  researchWire
} from './duaa';

/**
 * The wire contract, versioned from the first release.
 *
 * Producers are separate products on separate infrastructure, so the shape has
 * to be agreed rather than shared. Every record carries the producer's own
 * identifier in `externalRef`: that is what makes a re-push an update instead
 * of a duplicate, and it is the only reason a scanner can run nightly without
 * silting up the register.
 */

const externalRef = z.string().min(1).max(200);
const shortText = z.string().min(1).max(500);
const longText = z.string().max(20_000);

/** Every batch names the entity it belongs to, or accepts the connection's default. */
const envelope = {
  /** Legal entity name or id. Omitted means the connection's default entity. */
  entity: z.string().max(200).optional()
};

export const processingActivityIn = z.object({
  ...envelope,
  externalRef,
  name: shortText,
  description: longText.optional(),
  purposes: z.array(shortText).max(50).default([]),
  /** As written. Read into `lawfulBases` where it names them unambiguously. */
  lawfulBasis: z.string().max(100).optional(),
  /** The Article 6(1) bases, where the producer knows them. Takes precedence over the text. */
  lawfulBases: z
    .array(z.enum(LAWFUL_BASIS_KEYS as [string, ...string[]]))
    .max(7)
    .optional(),
  /** The Annex 1 condition, with recognised legitimate interests. */
  recognisedCondition: z
    .enum(RECOGNISED_CONDITION_KEYS as [string, ...string[]])
    .optional(),
  dataCategories: z.array(z.string().max(100)).max(100).default([]),
  subjectCategories: z.array(z.string().max(100)).max(50).default([]),
  recipients: z.array(z.string().max(200)).max(100).default([]),
  systems: z.array(z.string().max(200)).max(100).default([]),
  transfers: z
    .array(
      z.object({
        country: z.string().max(100),
        mechanism: z.string().max(100).optional()
      })
    )
    .max(50)
    .default([]),
  retention: z.string().max(2000).optional(),
  securityMeasures: z.string().max(4000).optional(),
  controllerRole: z
    .enum(['controller', 'processor', 'joint_controller'])
    .optional(),
  controllerName: z.string().max(200).optional(),
  reviewDueAt: z.iso.datetime().optional(),
  /**
   * The Data (Use and Access) Act records (see docs/integration-api.md). Each
   * group sent replaces what is recorded for it; one left out leaves it alone.
   */
  automatedDecisions: automatedDecisionsWire.optional(),
  furtherProcessing: furtherProcessingWire.optional(),
  research: researchWire.optional(),
  childrenLikely: z.boolean().nullable().optional(),
  /**
   * Which of its entity's laws govern the record. Left out: the entity's for
   * a new record, as recorded for an existing one. Outside the entity's laws,
   * the record is skipped with the reason.
   */
  laws: z.enum(['uk', 'eu', 'uk_eu']).optional(),
  /** EU GDPR Article 8(1): EEA States, ISO codes. Unknown codes skip the record. */
  childrenMemberStates: z.array(z.string().max(2)).max(30).optional()
});

export const vendorIn = z.object({
  externalRef: externalRef.optional(),
  name: shortText,
  description: longText.optional(),
  categories: z.array(z.string().max(100)).max(50).default([])
});

export const dpaIn = z.object({
  externalRef: externalRef.optional(),
  /** Matched to a supplier by canonical name; created if unknown. */
  vendorName: shortText,
  title: shortText,
  documentRef: z.string().max(500).optional(),
  signedAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
  transferMechanism: z.string().max(200).optional(),
  /** Chosen from the list (`lib/gdpr/transfers.ts`); the text stays as the note. */
  transferMechanisms: z
    .array(
      z.object({
        mechanism: z.string().max(60),
        module: z
          .union([z.number(), z.string().max(2)])
          .nullable()
          .optional()
      })
    )
    .max(20)
    .optional(),
  subProcessors: z.array(z.string().max(200)).max(200).default([]),
  terms: z.record(z.string(), z.unknown()).default({})
});

export const evidenceIn = z.object({
  ...envelope,
  externalRef,
  kind: z.enum(['document', 'scan', 'attestation', 'link']),
  title: shortText,
  description: longText.optional(),
  uri: z.string().url().max(2000).optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  collectedAt: z.iso.datetime().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Attach to an existing record by its reference, e.g. "DPIA-2026-0001". */
  attachTo: z.string().max(100).optional()
});

/**
 * One observation from a scan.
 *
 * `severity` is the scanner's own rating and stays that way — it is an input to
 * a human judgement, never a governance decision. `advisory` is explicitly
 * labelled as a suggestion for the same reason.
 */
export const scanFindingIn = z.object({
  externalRef,
  category: shortText,
  severity: z.enum(['info', 'low', 'medium', 'high']),
  title: shortText,
  detail: longText.optional(),
  url: z.string().max(2000).optional(),
  vendor: z.string().max(200).optional(),
  cookieName: z.string().max(200).optional(),
  setBeforeConsent: z.boolean().optional(),
  thirdCountry: z.string().max(100).optional(),
  advisory: z.record(z.string(), z.unknown()).default({})
});

export const scanBatchIn = z.object({
  ...envelope,
  /** Identifies the run, so a re-scan can be compared with the last one. */
  scanRef: shortText,
  scannedUrl: z.string().max(2000).optional(),
  scannedAt: z.iso.datetime().optional(),
  /** Attach the run's evidence to an existing record, e.g. "DPIA-2026-0001". */
  attachTo: z.string().max(100).optional(),
  summary: z.record(z.string(), z.unknown()).default({}),
  findings: z.array(scanFindingIn).max(1000)
});

/**
 * An AI system the Portal knows about.
 *
 * The Portal describes the system; people here govern it. So a push sets what
 * the system is — name, purpose, type, where it comes from, how it is deployed,
 * its model and data — and never touches who owns it, its transparency scope,
 * its review date or its lifecycle stage after it is first recorded. Moving a
 * system live is a decision with a gate, and an integration does not take it.
 */
export const aiUseCaseIn = z.object({
  ...envelope,
  externalRef,
  name: shortText,
  purpose: longText.min(1),
  description: longText.optional(),
  systemType: z.enum(['predictive', 'generative', 'agentic', 'hybrid']),
  provenance: z.enum([
    'built_in_house',
    'fine_tuned',
    'third_party_api',
    'embedded_vendor'
  ]),
  /** Used only when the system is first recorded. */
  lifecycleStage: z
    .enum([
      'proposed',
      'development',
      'pilot',
      'production',
      'retiring',
      'retired'
    ])
    .optional(),
  deploymentPattern: z
    .enum([
      'public_web_app',
      'embedded',
      'public_api',
      'privately_hosted',
      'local',
      'trained_here'
    ])
    .optional(),
  /** Linked to a supplier on the register by name, where one matches. */
  supplierName: shortText.optional(),
  vendor: z.string().max(200).optional(),
  modelName: z.string().max(200).optional(),
  deployedIn: z.array(z.string().max(200)).max(50).default([]),
  processesPersonalData: z.boolean().optional(),
  dataCategories: z.array(z.string().max(100)).max(100).default([]),
  /** Articles 22A–22C, as on a processing activity. Sent replaces; left out leaves it alone. */
  automatedDecisions: automatedDecisionsWire.optional()
});

/** Batches are capped so one request cannot become an unbounded transaction. */
export const MAX_BATCH = 500;

export const processingActivityBatch = z.object({
  records: z.array(processingActivityIn).min(1).max(MAX_BATCH)
});
export const vendorBatch = z.object({
  records: z.array(vendorIn).min(1).max(MAX_BATCH)
});
export const dpaBatch = z.object({
  records: z.array(dpaIn).min(1).max(MAX_BATCH)
});
/**
 * An information asset. Read by the importer only: no ingest route takes it
 * (decision 8 of the plan in issue #64). Its type and classification are
 * checked against the organisation's own typology and scheme when it is
 * matched, since those differ between organisations.
 */
export const informationAssetIn = z.object({
  externalRef,
  name: shortText,
  description: longText.optional(),
  /** A type's key or label, built in or the organisation's own. */
  assetType: shortText,
  /** The owner's email address, matched to a member. */
  owner: z.string().max(320).optional(),
  hosting: z.enum(['on_premises', 'saas', 'cloud', 'hybrid']).optional(),
  hostedBy: z.string().max(200).optional(),
  region: z.string().max(200).optional(),
  countries: z.array(z.string().max(100)).max(100).default([]),
  /** A level's key or label in the organisation's scheme. */
  classification: z.string().max(100).optional(),
  retention: z.string().max(2000).optional(),
  nextReviewAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
  noticeDays: z.number().int().min(0).max(3650).optional(),
  autoRenews: z.boolean().optional(),
  /** Processing activities that use it, by reference or name. */
  activities: z.array(z.string().max(500)).max(100).default([]),
  /** Suppliers that host, run or support it, by name. */
  suppliers: z.array(z.string().max(500)).max(100).default([])
});

/**
 * A risk on the register. Read by the importer only, like an asset. Ratings
 * are as written in the source; they are read onto the organisation's scale
 * when matched, with the translations a person chose for that source.
 */
export const riskIn = z.object({
  externalRef,
  title: shortText,
  description: longText.min(1),
  category: z.string().max(200).optional(),
  /** The owner's email address, matched to a member. */
  owner: z.string().max(320).optional(),
  inherentLikelihood: z.string().min(1).max(100),
  inherentImpact: z.string().min(1).max(100),
  residualLikelihood: z.string().max(100).optional(),
  residualImpact: z.string().max(100).optional(),
  status: z
    .enum(['identified', 'treating', 'mitigated', 'accepted', 'closed'])
    .optional(),
  openedAt: z.iso.datetime().optional(),
  closedAt: z.iso.datetime().optional(),
  nextReviewAt: z.iso.datetime().optional(),
  /** An acceptance given in the source: kept as its history, not as one given here. */
  acceptedBy: z.string().max(320).optional(),
  acceptedAt: z.iso.datetime().optional(),
  acceptanceExpiresAt: z.iso.datetime().optional(),
  acceptanceRationale: longText.optional(),
  /** The assessment it came out of, by its identifier in the source. */
  assessment: z.string().max(500).optional(),
  /** What it concerns, by reference, identifier in the source, or name. */
  activities: z.array(z.string().max(500)).max(100).default([]),
  suppliers: z.array(z.string().max(500)).max(100).default([]),
  aiSystems: z.array(z.string().max(500)).max(100).default([]),
  assets: z.array(z.string().max(500)).max(100).default([])
});

/**
 * Something being done about an imported risk. Read by the importer only. A
 * verification given in the source is kept as its history, not as one given
 * here, where verifying is a second member's act.
 */
export const mitigationIn = z.object({
  externalRef,
  /** The risk it treats: its identifier in the source, or its reference here. */
  risk: z.string().min(1).max(500),
  description: longText.min(1),
  controlRef: z.string().max(200).optional(),
  /**
   * Acceptance is read so the row is not lost, but is not a treatment here:
   * it is kept with the mitigation, and the risk is accepted on its own page.
   */
  treatmentType: z
    .enum(['avoidance', 'limitation', 'transference', 'acceptance'])
    .optional(),
  /** The owner's email address, matched to a member. */
  owner: z.string().max(320).optional(),
  dueAt: z.iso.datetime().optional(),
  status: z
    .enum(['planned', 'in_progress', 'implemented', 'verified', 'abandoned'])
    .optional(),
  implementedAt: z.iso.datetime().optional(),
  verifiedBy: z.string().max(320).optional(),
  verifiedAt: z.iso.datetime().optional(),
  evidenceRef: z.string().max(500).optional()
});

/**
 * An appropriate policy document. Read by the importer only. Conditions are
 * as the source names them, read onto Schedule 1 and Part 3 when matched.
 */
export const policyDocumentIn = z.object({
  externalRef,
  title: shortText,
  version: z.string().max(100).optional(),
  /** The legal entity by name; empty for every entity. */
  entity: z.string().max(200).optional(),
  /** The owner's email address, matched to a member. */
  owner: z.string().max(320).optional(),
  conditions: z.array(z.string().max(300)).max(60).default([]),
  lastReviewedAt: z.iso.datetime().optional(),
  withdrawnAt: z.iso.datetime().optional()
});

/**
 * A policy on the general register. Read by the importer only. An approval
 * given in the source is kept as its history, not as one given here.
 */
export const policyIn = z.object({
  externalRef,
  title: shortText,
  summary: longText.optional(),
  /** The legal entity by name; empty for every entity. */
  entity: z.string().max(200).optional(),
  owner: z.string().max(320).optional(),
  status: z.enum(['draft', 'in_force', 'withdrawn']).optional(),
  version: z.string().max(100).optional(),
  approvedBy: z.string().max(320).optional(),
  approvedAt: z.iso.datetime().optional(),
  approvalReference: z.string().max(500).optional(),
  reviewIntervalMonths: z.number().int().min(1).max(60).optional(),
  lastReviewedAt: z.iso.datetime().optional(),
  nextReviewAt: z.iso.datetime().optional(),
  withdrawnAt: z.iso.datetime().optional(),
  withdrawnReason: longText.optional(),
  /** What it governs, by reference, identifier in the source, or name. */
  activities: z.array(z.string().max(500)).max(100).default([]),
  aiSystems: z.array(z.string().max(500)).max(100).default([])
});

/**
 * An assessment done in another platform. Read by the importer only. Its
 * questions and answers are the columns no field reads, kept as asked there.
 */
export const assessmentIn = z.object({
  externalRef,
  title: shortText,
  kind: z.enum([
    'dpia',
    'lia',
    'tia',
    'tra',
    'ai_risk',
    'screening',
    'eia',
    'custom'
  ]),
  /** Where it got to there; unfinished comes in withdrawn (decision 4). */
  outcome: z.enum([
    'approved',
    'rejected',
    'superseded',
    'withdrawn',
    'unfinished'
  ]),
  /** What it assessed: one of these, by reference, identifier there, or name. */
  activity: z.string().max(500).optional(),
  supplier: z.string().max(500).optional(),
  aiSystem: z.string().max(500).optional(),
  owner: z.string().max(320).optional(),
  submittedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  approvedBy: z.string().max(320).optional(),
  reviewDueAt: z.iso.datetime().optional(),
  /** The questions as asked there, with their answers, in order. */
  answers: z
    .array(z.object({ question: z.string().max(1000), answer: longText }))
    .max(500)
    .default([])
});

/**
 * A data subject request handled in another platform, with its real dates.
 * Read by the importer only. What moved its clock there (asking for proof of
 * identity or for clarification, extending the time) comes with its dates, so
 * its deadline here is the one it had there.
 */
export const dataSubjectRequestIn = z.object({
  externalRef,
  requesterName: shortText,
  requesterContact: z.string().max(500).optional(),
  representative: z.string().max(500).optional(),
  /** As the source names them; read onto the rights here when matched. */
  rights: z.array(z.string().max(200)).min(1).max(20),
  channel: z.string().max(100).optional(),
  receivedAt: z.iso.datetime(),
  description: longText.optional(),
  jurisdiction: z.enum(['uk', 'eu', 'uk_eu']).optional(),
  regime: z.enum(['gdpr', 'dpa_part3']).optional(),
  owner: z.string().max(320).optional(),
  status: z
    .enum([
      'received',
      'verifying',
      'in_progress',
      'paused',
      'responded',
      'refused',
      'withdrawn',
      'closed'
    ])
    .optional(),
  identityRequestedAt: z.iso.datetime().optional(),
  identityVerifiedAt: z.iso.datetime().optional(),
  identityMethod: z.string().max(500).optional(),
  clarificationRequestedAt: z.iso.datetime().optional(),
  clarificationReceivedAt: z.iso.datetime().optional(),
  extended: z.boolean().optional(),
  extendedAt: z.iso.datetime().optional(),
  extensionReason: longText.optional(),
  respondedAt: z.iso.datetime().optional(),
  responseSummary: longText.optional(),
  closedAt: z.iso.datetime().optional(),
  closureRationale: longText.optional()
});

/**
 * A personal data breach handled in another platform, with its real dates.
 * Read by the importer only. Who was told, and when, comes with it, so its
 * seventy-two hours here reads as it did there.
 */
export const breachIn = z.object({
  externalRef,
  title: shortText,
  description: longText.optional(),
  controllerRole: z
    .enum(['controller', 'joint_controller', 'processor'])
    .optional(),
  regime: z.enum(['gdpr', 'dpa_part3']).optional(),
  laws: z.enum(['uk', 'eu', 'uk_eu']).optional(),
  /** EEA member States where affected people live, by ISO code. */
  affectedStates: z.array(z.string().max(100)).max(40).optional(),
  discoveredAt: z.iso.datetime(),
  occurredAt: z.iso.datetime().optional(),
  containedAt: z.iso.datetime().optional(),
  /** As the source names them; read onto confidentiality, integrity and availability. */
  categories: z.array(z.string().max(200)).max(10).optional(),
  subjectsAffected: z.number().int().nonnegative().optional(),
  recordsAffected: z.number().int().nonnegative().optional(),
  specialCategory: z.boolean().optional(),
  likelyConsequences: longText.optional(),
  measuresTaken: longText.optional(),
  dataUnintelligible: z.boolean().optional(),
  pecrServiceBreach: z.boolean().optional(),
  status: z
    .enum(['discovered', 'assessing', 'contained', 'notified', 'closed'])
    .optional(),
  owner: z.string().max(320).optional(),
  authorityDecision: z.enum(['notified', 'not_required']).optional(),
  /** Which authority was told, by code or name, where more than one is owed. */
  authority: z.string().max(200).optional(),
  authorityNotifiedAt: z.iso.datetime().optional(),
  authorityRef: z.string().max(200).optional(),
  authorityRationale: longText.optional(),
  lateReason: longText.optional(),
  /** Whether the people affected were told, or judged not to need telling. */
  subjectsDecision: z.enum(['told', 'not_required']).optional(),
  subjectsNotifiedAt: z.iso.datetime().optional(),
  subjectsRationale: longText.optional(),
  pecrNotifiedAt: z.iso.datetime().optional(),
  closedAt: z.iso.datetime().optional(),
  closureRationale: longText.optional()
});

/**
 * A complaint from a data subject handled in another platform, with its real
 * dates. Read by the importer only. Its acknowledgement, latest update and
 * outcome come with it, so its thirty days and the organisation's own
 * targets read here as they did there.
 */
export const complaintIn = z.object({
  externalRef,
  complainantName: shortText,
  complainantContact: z.string().max(500).optional(),
  representative: z.string().max(500).optional(),
  channel: z.string().max(100).optional(),
  receivedAt: z.iso.datetime(),
  subject: z
    .enum([
      'request_handling',
      'accuracy',
      'security',
      'disclosure',
      'retention',
      'marketing',
      'lawfulness',
      'transparency',
      'automated_decision',
      'other'
    ])
    .optional(),
  description: longText.optional(),
  jurisdiction: z.enum(['uk', 'eu', 'uk_eu']).optional(),
  controllerRole: z
    .enum(['controller', 'joint_controller', 'processor'])
    .optional(),
  /** The request it is about, by its ID in the same source. */
  requestRef: z.string().max(200).optional(),
  owner: z.string().max(320).optional(),
  status: z
    .enum([
      'received',
      'acknowledged',
      'investigating',
      'outcome_sent',
      'withdrawn',
      'closed'
    ])
    .optional(),
  acknowledgedAt: z.iso.datetime().optional(),
  acknowledgementChannel: z.string().max(100).optional(),
  acknowledgementLateReason: longText.optional(),
  /** The latest progress update the complainant was given. */
  lastUpdateAt: z.iso.datetime().optional(),
  outcome: z
    .enum(['upheld', 'partly_upheld', 'not_upheld', 'passed_to_controller'])
    .optional(),
  outcomeAt: z.iso.datetime().optional(),
  outcomeChannel: z.string().max(100).optional(),
  outcomeSummary: longText.optional(),
  remedialAction: longText.optional(),
  toldOfRegulatorRight: z.boolean().optional(),
  outcomeLateReason: longText.optional(),
  closedAt: z.iso.datetime().optional(),
  closureRationale: longText.optional()
});

/**
 * A freedom of information request handled in another platform, with its
 * real dates. Read by the importer only. Clarification, the extensions that
 * move its deadline, the grounds it was refused on and its latest review
 * come with it, so its twenty working days read here as they did there.
 */
export const informationRequestIn = z.object({
  externalRef,
  requesterName: shortText,
  correspondenceAddress: z.string().max(500).optional(),
  /** General information, environmental, or both: read onto the entity's Act. */
  kind: z.enum(['general', 'environmental', 'both']).optional(),
  channel: z
    .enum(['email', 'web_form', 'post', 'social_media', 'phone', 'in_person'])
    .optional(),
  receivedAt: z.iso.datetime(),
  description: longText.optional(),
  owner: z.string().max(320).optional(),
  status: z.enum(['open', 'responded', 'closed']).optional(),
  clarificationSoughtAt: z.iso.datetime().optional(),
  clarificationReceivedAt: z.iso.datetime().optional(),
  /** EIR reg 7: the applicant told it is complex and voluminous. */
  complexityExtendedAt: z.iso.datetime().optional(),
  /** FOIA s.10(3): the notice that the public interest is being weighed. */
  publicInterestNoticeAt: z.iso.datetime().optional(),
  publicInterestDate: z.iso.datetime().optional(),
  publicInterestExemption: z.string().max(100).optional(),
  respondedAt: z.iso.datetime().optional(),
  outcome: z
    .enum([
      'released_in_full',
      'released_in_part',
      'withheld_in_full',
      'refused_request',
      'not_held'
    ])
    .optional(),
  responseSummary: longText.optional(),
  /** Provisions relied on to withhold, as the source names them. */
  exemptions: z.array(z.string().max(100)).max(20).optional(),
  /** A request refused as a whole, other than under an exception. */
  refusedAs: z.enum(['cost_limit', 'vexatious', 'repeated']).optional(),
  lateReason: longText.optional(),
  published: z.boolean().optional(),
  closedAt: z.iso.datetime().optional(),
  closureRationale: longText.optional(),
  reviewRequestedAt: z.iso.datetime().optional(),
  reviewGrounds: longText.optional(),
  reviewDecidedAt: z.iso.datetime().optional(),
  reviewOutcome: z
    .enum(['upheld', 'varied', 'reversed', 'declined'])
    .optional(),
  reviewSummary: longText.optional()
});

export const evidenceBatch = z.object({
  records: z.array(evidenceIn).min(1).max(MAX_BATCH)
});
export const aiUseCaseBatch = z.object({
  records: z.array(aiUseCaseIn).min(1).max(MAX_BATCH)
});

export type ProcessingActivityIn = z.infer<typeof processingActivityIn>;
export type VendorIn = z.infer<typeof vendorIn>;
export type DpaIn = z.infer<typeof dpaIn>;
export type EvidenceIn = z.infer<typeof evidenceIn>;
export type ScanBatchIn = z.infer<typeof scanBatchIn>;
export type AiUseCaseIn = z.infer<typeof aiUseCaseIn>;
export type InformationAssetIn = z.infer<typeof informationAssetIn>;
export type RiskIn = z.infer<typeof riskIn>;
export type MitigationIn = z.infer<typeof mitigationIn>;
export type PolicyDocumentIn = z.infer<typeof policyDocumentIn>;
export type PolicyIn = z.infer<typeof policyIn>;
export type AssessmentIn = z.infer<typeof assessmentIn>;
export type DataSubjectRequestIn = z.infer<typeof dataSubjectRequestIn>;
export type BreachIn = z.infer<typeof breachIn>;
export type ComplaintIn = z.infer<typeof complaintIn>;
export type InformationRequestIn = z.infer<typeof informationRequestIn>;

export type IngestOutcome = {
  received: number;
  created: number;
  updated: number;
  skipped: Array<{ externalRef: string; reason: string }>;
};
