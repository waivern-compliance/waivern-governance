import Link from 'next/link';

import { anyEntityUnderDataProtectionLaw } from '@/services/entities';

/**
 * Said on a privacy programme page reached by its address when no entity is
 * under UK or EU data protection law. The page still works - what is offered
 * is presentation, and somebody may be about to change an entity's law - but
 * an empty register with no reason reads as a fault.
 */
export async function OutsideProgrammeNote({
  organisationId,
  what
}: {
  organisationId: string;
  /** The register, in the plural: "processing records". */
  what: string;
}) {
  if (await anyEntityUnderDataProtectionLaw(organisationId)) return null;
  return (
    <p className="max-w-prose rounded border border-line bg-surface px-3 py-2 text-sm text-ink-soft">
      No entity here is recorded as subject to UK or EU data protection law, so{' '}
      {what} are not asked for. If one is, say so on the{' '}
      <Link
        href="/app/admin/organisation"
        className="underline hover:text-brand"
      >
        Organisation page
      </Link>
      .
    </p>
  );
}
