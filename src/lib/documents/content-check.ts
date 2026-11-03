/**
 * Whether a file's bytes are what its declared type says they are.
 *
 * The type on an upload is the one the browser declared, which is the one the
 * filename's extension suggested, which is whatever the person — or whoever
 * sent them the file — called it. An executable renamed `contract.pdf` arrives
 * as `application/pdf`. So the first few bytes are checked against the format
 * they claim to be, and a mismatch is refused rather than stored and handed
 * back to somebody later under a reassuring icon.
 *
 * This is a check of format, not of safety: a real PDF can still carry
 * something nasty, which is what the virus scan is for. No database import, so
 * it stays testable on its own.
 */

const startsWith = (bytes: Buffer, signature: number[], at = 0) =>
  bytes.length >= at + signature.length && signature.every((b, i) => bytes[at + i] === b);

/** "%PDF-", which readers accept anywhere in the first kilobyte. */
const isPdf = (bytes: Buffer) => bytes.subarray(0, 1024).includes("%PDF-");

/**
 * An Office Open XML package: a zip whose parts name the application.
 *
 * Part names sit uncompressed in the zip's directory, so checking for them
 * needs no unzipping. A plain zip renamed `.docx` fails here.
 */
const isOoxml = (bytes: Buffer, part: "word/" | "xl/") =>
  startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
  bytes.includes("[Content_Types].xml") &&
  bytes.includes(part);

const isPng = (bytes: Buffer) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const isJpeg = (bytes: Buffer) => startsWith(bytes, [0xff, 0xd8, 0xff]);

/**
 * Text that is text: valid UTF-8, with no NUL bytes, which no text file has
 * and nearly every binary one does.
 */
function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const CHECKS: Record<string, (bytes: Buffer) => boolean> = {
  "application/pdf": isPdf,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => isOoxml(b, "word/"),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => isOoxml(b, "xl/"),
  "text/plain": isUtf8Text,
  "text/csv": isUtf8Text,
  "image/png": isPng,
  "image/jpeg": isJpeg,
};

/**
 * True when the bytes match the declared type. A type with no check is not on
 * the allowlist, so it is false rather than waved through.
 */
export function contentMatchesType(contentType: string, bytes: Buffer): boolean {
  const check = CHECKS[contentType];
  return check ? check(bytes) : false;
}
