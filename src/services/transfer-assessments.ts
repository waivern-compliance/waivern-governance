import { eq, inArray, sql, type SQL } from 'drizzle-orm';

import { assessments, templates, templateVersions } from '@/db/schema';

/**
 * Which assessments count as a transfer assessment on file, for the register
 * and for agreements alike: a UK transfer risk assessment (kind `tra`) or an
 * EU transfer impact assessment (kind `tia`), approved. A draft, a withdrawn
 * or a rejected one has decided nothing. And the law enforcement transfer
 * assessment (Part 3, which shares the `tra` kind) answers the s.73 test, not
 * the UK GDPR's, so it never counts as the TRA for a GDPR transfer: it is
 * known by citing s.73.
 */
export function heldTransferAssessment(): SQL {
  return sql`${inArray(templates.kind, ['tra', 'tia'])} and ${eq(
    assessments.status,
    'approved'
  )} and ${templateVersions.definition}::text not like '%uk.dpa2018.s73%'`;
}
