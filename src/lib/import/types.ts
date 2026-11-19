import type {
  AiUseCaseIn,
  AssessmentIn,
  BreachIn,
  ComplaintIn,
  DataSubjectRequestIn,
  InformationAssetIn,
  InformationRequestIn,
  MitigationIn,
  PolicyDocumentIn,
  PolicyIn,
  ProcessingActivityIn,
  RiskIn,
  VendorIn
} from '@/lib/integration/contracts';

/** Which column each field is read from, and what happens to the others. */
export type ImportMapping = {
  /** Field key to column name, as in the header row. */
  fields: Record<string, string>;
  /** Keep the columns no field reads, with the record, to read later. */
  keepUnmapped: boolean;
  /**
   * For a field whose values mean something only in the source's own terms,
   * such as a risk rating of "High" or a status of "In review": what each
   * value is here, as a person chose it (a point on the scale, or one of the
   * choice's values). Keyed by field, then by the value as written, in lower
   * case.
   */
  values?: Record<string, Record<string, string>>;
  /**
   * A choice made once for every row, where the file has no column for it:
   * the kind of every assessment in an export of DPIAs, say. Keyed by field.
   */
  everyRow?: Record<string, string>;
  /**
   * For case history: closed cases that ended before this date are left out,
   * as the organisation's own retention period for them has run (decision 10).
   */
  closedBefore?: string;
};

/**
 * Something the old platform recorded happening to a record, such as an
 * acceptance or an approval: kept and shown as that platform's account, never
 * as something done here, and never written to the audit chain.
 */
export type SourceEvent = {
  /** When, as the source dated it; null where it gave no date. */
  at: string | null;
  what: string;
  /** Who, as the source named them. */
  by?: string;
  detail?: string;
};

/** One question and its answer, as another platform asked it. */
export type SourceAnswer = {
  question: string;
  answer: string;
};

type Legacy = Record<string, string>;

/** A link between registers an import made, kept on its row for undo. */
export type ImportLink =
  | {
      kind: 'asset_activity' | 'asset_supplier' | 'asset_risk';
      /** The asset. */
      from: string;
      to: string;
    }
  | {
      /** A risk named this assessment there; the import set its assessment. */
      kind: 'risk_assessment';
      /** The risk. */
      from: string;
      to: string;
    }
  | {
      kind: 'policy_activity' | 'policy_ai_system';
      /** The policy. */
      from: string;
      to: string;
    }
  | {
      /** A `record_link` row the import made, by its id. */
      kind: 'record_link';
      id: string;
    };

/** One row, converted and checked, ready to write. */
export type ImportRecord =
  | {
      kind: 'processing_activity';
      data: Omit<ProcessingActivityIn, 'entity'>;
      legacy: Legacy;
    }
  | {
      kind: 'supplier';
      data: VendorIn & { externalRef: string };
      legacy: Legacy;
    }
  | {
      kind: 'dpa';
      data: {
        externalRef: string;
        supplier: string;
        title: string;
        documentRef?: string;
        signedAt?: string;
        expiresAt?: string;
        transferMechanism?: string;
        subProcessors: string[];
        file?: string;
      };
      legacy: Legacy;
    }
  | {
      kind: 'evidence';
      data: {
        externalRef: string;
        kind: 'document' | 'scan' | 'attestation' | 'link';
        title: string;
        description?: string;
        uri?: string;
        collectedAt?: string;
        attachTo?: string;
        file?: string;
      };
      legacy: Legacy;
    }
  | {
      kind: 'ai_use_case';
      data: Omit<AiUseCaseIn, 'entity' | 'automatedDecisions'>;
      legacy: Legacy;
    }
  | {
      kind: 'information_asset';
      data: InformationAssetIn;
      legacy: Legacy;
    }
  | {
      kind: 'risk';
      data: RiskIn;
      legacy: Legacy;
    }
  | {
      kind: 'mitigation';
      data: MitigationIn;
      legacy: Legacy;
    }
  | {
      kind: 'policy_document';
      data: PolicyDocumentIn & { file?: string };
      legacy: Legacy;
    }
  | {
      kind: 'policy';
      data: PolicyIn & { file?: string };
      legacy: Legacy;
    }
  | {
      kind: 'assessment';
      data: AssessmentIn & { file?: string };
      legacy: Legacy;
    }
  | {
      kind: 'data_subject_request';
      data: DataSubjectRequestIn & { file?: string };
      legacy: Legacy;
    }
  | {
      kind: 'breach';
      data: BreachIn & { file?: string };
      legacy: Legacy;
    }
  | {
      kind: 'data_protection_complaint';
      data: ComplaintIn & { file?: string };
      legacy: Legacy;
    }
  | {
      kind: 'information_request';
      data: InformationRequestIn & { file?: string };
      legacy: Legacy;
    };

/**
 * What the organisation's model last suggested for a batch's columns, kept to
 * show beside the matching until a person previews. Never itself a mapping.
 */
export type ImportSuggestion = {
  model: string;
  promptVersion: string;
  at: string;
  byLabel: string;
  /** Field key to column name, as the model matched them and the checks kept. */
  fields: Record<string, string>;
  notes: string | null;
  /** Said to the person when anything was stripped before sending. */
  minimisation: string | null;
  /**
   * Why the latest request suggested nothing, when it did not. An earlier
   * suggestion's fields are kept, rather than lost to a request that failed.
   */
  failure: string | null;
  /**
   * The matching as the person had it on the page when they asked, previewed
   * or not, so asking does not undo what they had chosen.
   */
  basis?: ImportMapping;
};
