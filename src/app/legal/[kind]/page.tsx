import { notFound, redirect } from 'next/navigation';

import { waivernHosted } from '@/lib/hosting';
import {
  currentDocument,
  documentPath,
  isLegalDocumentKind
} from '@/lib/legal/documents';

export const dynamic = 'force-dynamic';

/** The current version of a document, at an address that never changes. */
export default async function CurrentLegalDocument({
  params
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!waivernHosted() || !isLegalDocumentKind(kind)) notFound();
  redirect(documentPath(currentDocument(kind)));
}
