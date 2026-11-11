import { NextResponse } from 'next/server';

import { log } from '@/lib/log';
import { mayExportOrganisation } from '@/lib/rbac';
import { requestOrigin } from '@/lib/request-origin';
import { getActiveSession } from '@/lib/session';
import {
  ExportRefused,
  maxExportBytes,
  openOrganisationExport
} from '@/services/organisation-export';

export const dynamic = 'force-dynamic';

/**
 * Everything the organisation holds, as one zip, for an owner taking it away.
 *
 * A POST from the Exports page, carrying the organisation's name typed out as
 * confirmation. A route rather than a server action because the answer is a
 * download, streamed as it is built. Refusals go back to the page, which says
 * why.
 */
export async function POST(request: Request) {
  const active = await getActiveSession();
  if (!active) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (!mayExportOrganisation(active.membership.grants)) {
    return NextResponse.json(
      {
        error:
          "Exporting all of the organisation's data is for an owner of the whole organisation"
      },
      { status: 403 }
    );
  }
  // The session cookie is not sent on a cross-site POST, but a form on another
  // site has no business starting this, so it is refused outright.
  const origin = request.headers.get('origin');
  if (origin && origin !== (await requestOrigin())) {
    return NextResponse.json({ error: 'Not from this site' }, { status: 403 });
  }

  const form = await request.formData();
  const typed = String(form.get('confirm') ?? '').trim();
  if (typed !== active.membership.organisationName.trim()) {
    return backToPage('confirm');
  }

  let opened;
  try {
    opened = await openOrganisationExport({
      organisationId: active.membership.organisationId,
      actor: {
        actorKind: 'user',
        actorUserId: active.userId,
        actorLabel: active.email
      },
      via: 'web',
      maxBytes: maxExportBytes()
    });
  } catch (error) {
    if (error instanceof ExportRefused) return backToPage(error.reason);
    throw error;
  }

  const archive = opened.stream();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await archive.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        log('error', 'organisation_export.failed', {
          error: error instanceof Error ? error.name : 'unknown'
        });
        controller.error(error);
      }
    },
    // The person closed the tab or lost the connection. The archive is
    // incomplete, so no completion is recorded; the start already is.
    async cancel() {
      await archive.return(undefined);
      await opened.close();
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${opened.filename}"`,
      'cache-control': 'no-store'
    }
  });
}

function backToPage(reason: string) {
  return new Response(null, {
    status: 303,
    headers: { location: `/app/exports?everything=${reason}#everything` }
  });
}
