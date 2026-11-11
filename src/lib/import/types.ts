import type {
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

/** One row, converted and checked, ready to write. */
export type ImportRecord =
  | {
      kind: 'processing_activity';
      data: Omit<ProcessingActivityIn, 'entity'>;
      legacy: Record<string, string>;
    }
  | {
      kind: 'supplier';
      data: VendorIn & { externalRef: string };
      legacy: Record<string, string>;
    };
