import { NextResponse } from 'next/server';

import { log } from '@/lib/log';
import { checkExportRequest } from '@/lib/organisation-export-request';
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
  const form = await request.formData();
  const check = checkExportRequest({
    grants: active.membership.grants,
    origin: request.headers.get('origin'),
    ownOrigin: await requestOrigin(),
    organisationName: active.membership.organisationName,
    typed: String(form.get('confirm') ?? '')
  });
  if (!check.ok) {
    return check.status === 303
      ? backToPage(check.reason)
      : NextResponse.json({ error: check.error }, { status: 403 });
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
  const release = opened.close;
  // Gone before the stream noticed: end the reader at once rather than leave
  // it to the stall timeout. A pending read then fails and the stream ends.
  request.signal.addEventListener('abort', () => void release(), {
    once: true
  });
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
        try {
          controller.error(error);
        } catch {
          // Already cancelled: the reader went away first.
        }
      }
    },
    // The person closed the tab or lost the connection. The archive is
    // incomplete, so no completion is recorded; the start already is.
    async cancel() {
      await release();
      await archive.return(undefined);
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
