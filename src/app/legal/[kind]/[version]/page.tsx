import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { versionLabel } from '@/components/legal/AgreementParts';
import { LegalText } from '@/components/legal/LegalText';
import { Mark } from '@/components/Wordmark';
import { waivernHosted } from '@/lib/hosting';
import {
  currentDocument,
  documentPath,
  documentVersion,
  isLegalDocumentKind,
  versionsOf
} from '@/lib/legal/documents';
import { PRODUCT_SUFFIX, PRODUCT_VENDOR } from '@/lib/product';

export const dynamic = 'force-dynamic';

type Params = Promise<{ kind: string; version: string }>;

function find(kind: string, version: string) {
  if (!waivernHosted() || !isLegalDocumentKind(kind)) return null;
  return documentVersion(kind, version);
}

export async function generateMetadata({
  params
}: {
  params: Params;
}): Promise<Metadata> {
  const { kind, version } = await params;
  const doc = find(kind, version);
  return doc ? { title: `${doc.title} (${versionLabel(doc.version)})` } : {};
}

/**
 * One version of a contract document, public and printable.
 *
 * Public so it can be read before signing in, and saved or printed at any time
 * afterwards: the terms are made available in a way that lets them be stored
 * and reproduced (Electronic Commerce (EC Directive) Regulations 2002, reg 9(3)).
 * Every version stays here at its own address, so anybody can see exactly what
 * they accepted, with the digest their acceptance was recorded against.
 */
export default async function LegalDocumentPage({
  params
}: {
  params: Params;
}) {
  const { kind, version } = await params;
  const doc = find(kind, version);
  if (!doc) notFound();
  const current = currentDocument(doc.kind);
  const others = versionsOf(doc.kind).filter((d) => d.version !== doc.version);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14 print:max-w-none print:py-0">
      <header className="space-y-3">
        <Link
          href="/"
          className="flex w-fit items-center gap-3 text-ink hover:text-brand print:hidden"
        >
          <Mark className="h-9 w-9 text-navy" />
          <span className="text-lg font-semibold tracking-tight">
            {PRODUCT_VENDOR}{' '}
            <span className="font-normal text-ink-soft">{PRODUCT_SUFFIX}</span>
          </span>
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="text-sm text-ink-soft">
          Waivern Limited, for its hosted {PRODUCT_VENDOR} {PRODUCT_SUFFIX}{' '}
          service. Version of {versionLabel(doc.version)}
          {doc.version === current.version
            ? ', the current version.'
            : '. This version has been replaced.'}
        </p>
        {doc.version !== current.version ? (
          <p className="text-sm">
            <Link
              href={documentPath(current)}
              className="text-brand underline underline-offset-2"
            >
              Read the current version
            </Link>
          </p>
        ) : null}
      </header>

      <LegalText body={doc.body} />

      <footer className="space-y-2 border-t border-line pt-4 text-xs text-ink-soft">
        <p>
          SHA-256 of this version:{' '}
          <span className="break-all font-mono">{doc.sha256}</span>. Every
          acceptance records this digest, so the text accepted can always be
          matched to it.
        </p>
        {others.length ? (
          <p>
            Other versions:{' '}
            {others.map((o, i) => (
              <span key={o.version}>
                {i ? ', ' : ''}
                <Link
                  href={documentPath(o)}
                  className="underline underline-offset-2"
                >
                  {versionLabel(o.version)}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </footer>
    </main>
  );
}
