import { Attachments } from '@/components/documents/Attachments';
import { documentsFor, type StoredDocument } from '@/services/documents';

/**
 * The case file an imported case came with, where it had one. Read-only: it
 * is what the other platform held, not a file added here.
 */
export async function ImportedCaseFile({
  organisationId,
  subjectType,
  subjectId,
  entityId,
  revalidate
}: {
  organisationId: string;
  subjectType: StoredDocument['subjectType'];
  subjectId: string;
  entityId: string;
  revalidate: string;
}) {
  const files = await documentsFor(organisationId, subjectType, subjectId);
  return files.length > 0 ? (
    <Attachments
      subjectType={subjectType}
      subjectId={subjectId}
      entityId={entityId}
      revalidate={revalidate}
      documents={files}
      mayEdit={false}
      what="The case file it came with"
    />
  ) : null;
}
