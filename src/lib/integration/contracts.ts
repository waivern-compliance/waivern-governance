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

export type IngestOutcome = {
  received: number;
  created: number;
  updated: number;
  skipped: Array<{ externalRef: string; reason: string }>;
};
