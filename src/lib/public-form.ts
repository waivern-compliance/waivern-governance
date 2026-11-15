import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * What the forms anybody can send (the public request forms, trial sign-up)
 * share to keep scripts out without storing anything about a visitor: a
 * keyed hash of their address for rate limiting, and a signed note of when
 * the form was opened.
 */

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value) return value;
  // Without a secret the address hashes could be reversed by trying every
  // IPv4 address, so production refuses to run a public form at all.
  if (process.env.NODE_ENV === 'production')
    throw new Error('AUTH_SECRET is required for public forms');
  return 'govern-development-only';
}

/** A visitor's address, made unreadable, for rate limiting alone. */
export function hashVisitor(purpose: string, address: string): string {
  return createHmac('sha256', secret())
    .update(`${purpose}:${address}`)
    .digest('hex');
}

/**
 * A signed note of when a form was opened, so a submission can be judged too
 * quick to be a person, or open too long to trust.
 */
export function openingToken(key: string, at = new Date()): string {
  const issued = String(at.getTime());
  const mac = createHmac('sha256', secret())
    .update(`${key}.${issued}`)
    .digest('base64url');
  return `${issued}.${mac}`;
}

/** When the form was opened, or null if the note was not signed here. */
export function openedAt(key: string, token: string): Date | null {
  const [issued, mac] = token.split('.');
  if (!issued || !mac) return null;
  const expected = createHmac('sha256', secret())
    .update(`${key}.${issued}`)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const at = new Date(Number(issued));
  return Number.isNaN(at.getTime()) ? null : at;
}
