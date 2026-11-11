import { mayExportOrganisation, type Grant } from './rbac';

export type ExportRequestCheck =
  | { ok: true }
  /** Answer with this status and message. */
  | { ok: false; status: 403; error: string }
  /** Send the person back to the Exports page, which says why. */
  | { ok: false; status: 303; reason: 'confirm' };

/**
 * Whether a request to export everything the organisation holds may go ahead.
 *
 * Pure, so each guard is tested on its own: who is asking, whether the form
 * came from this site, and whether they typed the organisation's name.
 */
export function checkExportRequest(input: {
  grants: readonly Grant[];
  /** The request's Origin header, if it sent one. */
  origin: string | null;
  /** This deployment's address as the browser reached it. */
  ownOrigin: string;
  organisationName: string;
  typed: string;
}): ExportRequestCheck {
  if (!mayExportOrganisation(input.grants)) {
    return {
      ok: false,
      status: 403,
      error:
        "Exporting all of the organisation's data is for an owner of the whole organisation"
    };
  }
  // The session cookie is not sent on a cross-site POST, but a form on another
  // site has no business starting this, so it is refused outright.
  if (input.origin && input.origin !== input.ownOrigin) {
    return { ok: false, status: 403, error: 'Not from this site' };
  }
  if (input.typed.trim() !== input.organisationName.trim()) {
    return { ok: false, status: 303, reason: 'confirm' };
  }
  return { ok: true };
}
