/**
 * What this product is called.
 *
 * One place, because the name appears in a browser tab, a masthead, a sign-in
 * page, an exported spreadsheet's provenance header, an audit manifest handed
 * to a regulator, and the instructions given to a language model. A rename
 * that reached five of those and missed the sixth would leave a document
 * asserting it came from something that no longer exists.
 */

/** The full name, wherever it is written out. */
export const PRODUCT_NAME = 'Waivern Governance Tool';

/**
 * The two halves, for the wordmark and anywhere the vendor is set apart from
 * the product. Kept derived from the name above so they cannot drift from it.
 */
export const PRODUCT_VENDOR = 'Waivern';
export const PRODUCT_SUFFIX = PRODUCT_NAME.slice(PRODUCT_VENDOR.length).trim();

/** One line describing it, used in metadata and on the sign-in page. */
export const PRODUCT_DESCRIPTION = 'Privacy and AI governance workflow';

/** Waivern's own website, for the line at the foot of a public form. */
export const VENDOR_URL = 'https://www.waivern.com';

/**
 * Where people tell Waivern which countries and laws to cover next, linked
 * from the hosted sign-in page.
 */
export const EXPANSION_SURVEY_URL = 'https://forms.gle/pSGsLSdvQQ6qbykQA';

/** The ways to reach Waivern, the same as on its website's home page. */
export const VENDOR_CONTACT_URL = `${VENDOR_URL}/contact`;
export const VENDOR_BOOKING_URL =
  'https://calendly.com/vincent-nunan-waivern/waivern-consultancy-session';
/** Where to write to Waivern about anything. */
export const VENDOR_EMAIL = 'info@waivern.com';

/** Waivern's own policies, linked at the foot of every page of the hosted service. */
export const VENDOR_PRIVACY_POLICY_URL = `${VENDOR_URL}/privacy-policy`;
export const VENDOR_COOKIE_POLICY_URL = `${VENDOR_URL}/cookie-policy`;

/** The open-source code of this tool. */
export const SOURCE_CODE_URL =
  'https://github.com/waivern-compliance/waivern-governance';
