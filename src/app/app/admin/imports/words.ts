/** Shared wording for the import pages. */

export const RECORD_TYPE_LABEL: Record<string, string> = {
  processing_activity: 'Processing activities',
  supplier: 'Suppliers and vendors',
  dpa: 'Processor agreements (DPAs)',
  evidence: 'Evidence',
  ai_use_case: 'AI systems',
  information_asset: 'Information assets',
  risk: 'Risks',
  mitigation: 'Mitigations',
  policy_document: 'Appropriate policy documents',
  policy: 'Policies'
};

/** Where a record of each kind is opened. */
export function recordHref(
  recordType: string,
  id: string,
  /** The record it is shown on: an agreement's supplier, a mitigation's risk. */
  parentId?: string | null
): string {
  switch (recordType) {
    case 'dpa':
      return `/app/third-parties/${parentId}`;
    case 'mitigation':
      return `/app/risks/${parentId}#${id}`;
    case 'policy':
      return `/app/policies/${id}`;
    case 'policy_document':
      return `/app/policy-documents/${id}`;
    case 'supplier':
      return `/app/third-parties/${id}`;
    case 'ai_use_case':
      return `/app/ai/${id}`;
    case 'evidence':
      return `/app/evidence#${id}`;
    case 'information_asset':
      return `/app/assets/${id}`;
    case 'risk':
      return `/app/risks/${id}`;
    default:
      return `/app/ropa/${id}`;
  }
}

export const STATUS_LABEL: Record<string, string> = {
  uploaded: 'columns to match',
  previewed: 'previewed, not imported',
  committed: 'imported',
  undone: 'undone'
};

export const ACTION_LABEL: Record<string, string> = {
  create: 'New',
  update: 'Updates the one imported before',
  merge: 'Adds to a supplier already recorded',
  refuse: 'Not imported',
  skip: 'Empty row'
};

const ORDER = ['create', 'update', 'merge', 'refuse', 'skip'] as const;
const SHORT: Record<string, string> = {
  create: 'new',
  update: 'updated',
  merge: 'added to',
  refuse: 'not imported',
  skip: 'empty'
};

/** "12 new, 3 updated, 2 not imported". */
export function countsWords(counts: Partial<Record<string, number>>): string {
  const parts = ORDER.filter((a) => counts[a]).map(
    (a) => `${counts[a]} ${SHORT[a]}`
  );
  return parts.length ? parts.join(', ') : 'nothing';
}
