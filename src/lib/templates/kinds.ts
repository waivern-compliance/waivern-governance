import type { TemplateKind } from '@/services/templates';

/**
 * Short names for each kind of template, wherever a list or a chart names
 * one. Keyed by every kind, so a new kind cannot be left to show its raw
 * value.
 */
export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  dpia: 'DPIA',
  tra: 'Transfer risk',
  tia: 'Transfer impact',
  lia: 'Legitimate interests',
  ai_risk: 'AI risk',
  screening: 'Screening',
  supplier_record: 'Supplier record',
  breach: 'Breach',
  eia: 'Equality impact',
  cyber_essentials: 'Cyber Essentials',
  custom: 'Custom'
};
