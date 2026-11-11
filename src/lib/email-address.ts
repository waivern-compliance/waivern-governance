/**
 * Whether text is shaped like an email address: something, an @, and a
 * domain with a dot. Enough to catch a slip in a form, not to prove the
 * address works. One rule for every place a person is named by address.
 */
export function isEmailAddress(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}
