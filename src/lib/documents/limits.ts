/**
 * What may be uploaded, and how big.
 *
 * A module of its own with no database import, because the upload form is a
 * client component and needs these to render — importing them from the service
 * pulls the Postgres driver into the browser bundle, which fails the build.
 * The same lesson as the country labels.
 */

/** Above this the platform is being used as a file server. */
export const MAX_BYTES = 10 * 1024 * 1024;

/**
 * An allowlist rather than a blocklist.
 *
 * These files are handed back to people later, so the set worth accepting for
 * a contract is small and dull. Nothing executable, and nothing a browser will
 * run — no HTML, and no SVG, which can carry script.
 *
 * Nor the pre-2007 Word and Excel formats: their container is the classic
 * home of macro malware, its contents cannot be checked against the type
 * claimed for them, and their text cannot be read. See `RETIRED`.
 */
export const ACCEPTED = new Map<string, string>([
  ['application/pdf', 'PDF'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Word (.docx)'
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Excel (.xlsx)'
  ],
  ['text/plain', 'Plain text'],
  ['text/csv', 'CSV'],
  ['image/png', 'PNG'],
  ['image/jpeg', 'JPEG']
]);

/**
 * Types once accepted and now refused, with what to send instead.
 *
 * Only new uploads are refused. Files already stored in these formats stay
 * where they are and download as before.
 */
export const RETIRED = new Map<string, string>([
  ['application/msword', 'Word (.doc)'],
  ['application/vnd.ms-excel', 'Excel (.xls)']
]);
