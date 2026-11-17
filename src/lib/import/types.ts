import type {
  AiUseCaseIn,
  AssessmentIn,
  InformationAssetIn,
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
   * For a field whose values mean something only on the source's own scale,
   * such as a risk rating of "High": what each value is here, as a person
   * chose it. Keyed by field, then by the value as written, in lower case.
   */
  values?: Record<string, Record<string, string>>;
  /**
   * A choice made once for every row, where the file has no column for it:
   * the kind of every assessment in an export of DPIAs, say. Keyed by field.
   */
  everyRow?: Record<string, string>;
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
    };
