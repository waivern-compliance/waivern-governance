import type {
  AiUseCaseIn,
  ProcessingActivityIn,
  VendorIn
} from '@/lib/integration/contracts';

/** Which column each field is read from, and what happens to the others. */
export type ImportMapping = {
  /** Field key to column name, as in the header row. */
  fields: Record<string, string>;
  /** Keep the columns no field reads, with the record, to read later. */
  keepUnmapped: boolean;
};

type Legacy = Record<string, string>;

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
    };
