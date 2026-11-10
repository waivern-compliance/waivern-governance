/**
 * Whether a public form is open: not withdrawn, and for a freedom of
 * information form, an FOI Act still applies to its entity. Clearing the Act
 * withdraws its forms; this covers any made before that rule. One rule for
 * the page, the frame headers and the logo, so they cannot disagree.
 */
export function formIsOpen(form: {
  revokedAt: Date | null;
  kind: 'data_protection' | 'foi';
  foiAct: string | null;
}): boolean {
  return form.revokedAt === null && (form.kind !== 'foi' || !!form.foiAct);
}
