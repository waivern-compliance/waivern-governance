/**
 * The parts of the contract documents a browser may need: their shape, where
 * they are published and the summary of key terms. Kept apart from
 * `documents.ts`, which hashes the text with Node's crypto, so a client
 * component can use these without pulling that in.
 */

export const LEGAL_DOCUMENT_KINDS = ['terms', 'dpa'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export type LegalDocument = {
  kind: LegalDocumentKind;
  /** The date it takes effect, which is also how it is cited. */
  version: string;
  title: string;
  /** Markdown: headings, paragraphs, lists, tables, bold and italic. */
  body: string;
  sha256: string;
};

/** Enough of a document to name it in a form, without carrying its text. */
export type DocumentRef = Pick<LegalDocument, 'kind' | 'version' | 'title'>;

export function refOf(doc: LegalDocument): DocumentRef {
  return { kind: doc.kind, version: doc.version, title: doc.title };
}

export function isLegalDocumentKind(value: string): value is LegalDocumentKind {
  return (LEGAL_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** Where a document can be read, saved and printed outside the platform. */
export function documentPath(doc: Pick<LegalDocument, 'kind' | 'version'>) {
  return `/legal/${doc.kind}/${doc.version}`;
}

/**
 * The terms a court would expect somebody to have had pointed out to them.
 *
 * An unusual or onerous clause binds only if it was fairly brought to the other
 * side's attention before they agreed, and the more onerous it is the more
 * prominently it must be shown (Interfoto v Stiletto [1989] QB 433; Spreadex v
 * Cochrane [2012] EWHC 1290 (Comm)). These are shown above the boxes to tick,
 * in plain words, each with its clause, rather than left for the reader to
 * find. Keep them in step with the current terms.
 */
export const KEY_TERMS: ReadonlyArray<{ clause: string; text: string }> = [
  {
    clause: '8',
    text: 'The service is free and provided "as is", with no warranties, including none that it will be accurate, available or secure.'
  },
  {
    clause: '4',
    text: 'It is not legal advice. Every decision recorded in it is yours, and so is your compliance with the law.'
  },
  {
    clause: '9.3-9.4',
    text: "Waivern is not liable for lost data, lost profits, regulators' fines or decisions you make, and its total liability to you is limited to £10,000."
  },
  {
    clause: '9.5',
    text: 'Any claim must be brought within 12 months of when you knew, or should have known, of it.'
  },
  {
    clause: '10',
    text: 'You will indemnify Waivern against claims and fines arising from your data, your use of the service or your decisions.'
  },
  {
    clause: '6.4',
    text: 'Your records are held in the EU (Amsterdam), outside the UK.'
  },
  {
    clause: '7.3',
    text: 'Backups exist to recover the whole service, not your organisation alone. Keep your own copies of anything you need.'
  },
  {
    clause: '11-12',
    text: "Waivern may suspend the service, end it on 30 days' notice, and change these terms, giving 30 days' notice of a material change."
  }
];
