import type { templateKind } from '@/db/schema/enums';

type TemplateKind = (typeof templateKind.enumValues)[number];

export type AssessableSubject = 'ai_use_case' | 'supplier' | 'cyber_scope';

/**
 * Which kinds of assessment can be about which kind of record. A DPIA about a
 * supplier, or a supplier record about an AI system, would bind an assessment
 * to something it does not describe, and the register reading it back would
 * report nonsense.
 */
export const KINDS_FOR: Record<AssessableSubject, readonly TemplateKind[]> = {
  ai_use_case: ['ai_risk', 'screening', 'dpia', 'eia'],
  supplier: ['supplier_record'],
  cyber_scope: ['cyber_essentials']
};

/**
 * Kinds that mean nothing without their subject: a readiness assessment is
 * readiness of one certification scope, and the scope's status is read from
 * it. Started only from the record, never from the assessments list.
 */
export const SUBJECT_REQUIRED: Partial<
  Record<TemplateKind, AssessableSubject>
> = { cyber_essentials: 'cyber_scope' };
