/**
 * Commercial contracts with suppliers.
 *
 * Separate from the Article 28 terms on `dpa`. A processor agreement is about
 * what a supplier may do with personal data; a contract is about what we pay
 * and for how long, and its date that matters is the last day to give notice
 * (`lib/renewals.ts`).
 */

/** An ISO 4217 code: three capital letters. */
export function isCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}
