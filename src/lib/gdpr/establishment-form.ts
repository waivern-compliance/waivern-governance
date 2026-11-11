import type { cleanEstablishment } from './establishment';

/**
 * The establishment form's fields, as `cleanEstablishment` takes them. Pure, so
 * the parsing is tested apart from the server action. Only the fieldsets for
 * the entity's laws are rendered: `ukEstablishment` is left out when its field
 * is absent, and absent EU fields read as nothing recorded.
 */
export function establishmentFromForm(
  formData: FormData
): Parameters<typeof cleanEstablishment>[1] {
  const text = (k: string) => String(formData.get(k) ?? '').trim();
  const representative = (prefix: string) => ({
    name: text(`${prefix}Name`),
    contact: text(`${prefix}Contact`),
    country: text(`${prefix}Country`) || null
  });
  return {
    ...(formData.has('ukEstablishment')
      ? { ukEstablishment: text('ukEstablishment') === 'yes' }
      : {}),
    euEstablishments: formData.getAll('euEstablishments').map(String),
    euMainEstablishment: text('euMainEstablishment') || null,
    euLeadAuthority: text('euLeadAuthority') || null,
    euRepresentative: representative('euRep'),
    euRepresentativeExemption: text('euRepExemption') || null,
    ukRepresentative: representative('ukRep'),
    ukRepresentativeExemption: text('ukRepExemption') || null,
    euPublicBody: formData.get('euPublicBody') === 'on'
  };
}
