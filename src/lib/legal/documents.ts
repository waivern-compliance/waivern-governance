import { createHash } from 'node:crypto';

import { DPA_2026_11_09 } from './dpa-2026-11-09';
import type { LegalDocument, LegalDocumentKind } from './shared';
import { TERMS_2026_11_09 } from './terms-2026-11-09';

export * from './shared';

/**
 * The contract documents for Waivern's hosted service, every version that has
 * ever been in force.
 *
 * A version's text is never edited once published: people accepted exactly
 * that text, and the SHA-256 kept with each acceptance has to keep matching it.
 * To change a document, add a new version with its own text, the date it
 * takes effect and a summary of what changed, and make it current. Nobody is
 * asked to accept it again: under clause 12.1 of the terms (and 9.7 of the
 * Data Processing Agreement) it applies by notice. The sweep emails each
 * organisation's owners once (`services/agreement-notices.ts`), and they may
 * end the agreement within 30 days if they do not agree. Somebody accepting
 * for the first time accepts the current version.
 *
 * Only Waivern's hosted service shows these (`lib/hosting.ts`). Anybody else
 * running the open-source code makes their own arrangements with their users.
 */

function document(
  kind: LegalDocumentKind,
  version: string,
  title: string,
  body: string,
  /** What changed from the version before, for the email to owners. Required after the first. */
  changes?: string
): LegalDocument {
  const text = body.trim();
  return {
    kind,
    version,
    title,
    body: text,
    changes: changes?.trim() || null,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex')
  };
}

/** Oldest first; the last of each kind is the current one. */
const VERSIONS: readonly LegalDocument[] = [
  document('terms', '2026-11-09', 'Terms of Service', TERMS_2026_11_09),
  document('dpa', '2026-11-09', 'Data Processing Agreement', DPA_2026_11_09)
];

export function currentDocument(kind: LegalDocumentKind): LegalDocument {
  const current = VERSIONS.filter((d) => d.kind === kind).at(-1);
  if (!current) throw new Error(`No ${kind} document is published.`);
  return current;
}

export function documentVersion(
  kind: LegalDocumentKind,
  version: string
): LegalDocument | null {
  return VERSIONS.find((d) => d.kind === kind && d.version === version) ?? null;
}

export function versionsOf(kind: LegalDocumentKind): LegalDocument[] {
  return VERSIONS.filter((d) => d.kind === kind);
}

/** The version before this one, which an organisation may have accepted. */
export function previousVersion(doc: LegalDocument): LegalDocument | null {
  const all = versionsOf(doc.kind);
  const at = all.findIndex((d) => d.version === doc.version);
  return at > 0 ? all[at - 1] : null;
}
