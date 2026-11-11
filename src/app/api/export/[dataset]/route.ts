import { NextResponse } from 'next/server';

import { exportFilename } from '@/lib/csv';
import { can } from '@/lib/rbac';
import { getActiveSession, visibleEntityIds } from '@/lib/session';
import {
  DATASET_LABEL,
  recordExport,
  renderDataset,
  type Dataset
} from '@/services/exports';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * A spreadsheet, for a person who has been asked for one.
 *
 * Behind the session rather than the signed integration API, because the caller
 * is a human with a browser. Every export is scoped to what that person can
 * already see, and every export is recorded — taking the risk register out of
 * the building is an act worth knowing about, in a platform whose whole
 * argument is an unbroken record of who did what.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dataset: string }> }
) {
  const { dataset } = await params;
  const active = await getActiveSession();
  if (!active)
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  if (!(dataset in DATASET_LABEL)) {
    return NextResponse.json({ error: 'No such export' }, { status: 404 });
  }
  const key = dataset as Dataset;

  // Requests carry the requesters' personal data, held by the people who
  // handle them; everything else follows record access.
  const needed =
    key === 'audit'
      ? 'audit.export'
      : key === 'requests'
        ? 'dsr.handle'
        : key === 'information-requests'
          ? 'foi.handle'
          : 'record.read';
  if (!can(active.membership.grants, needed)) {
    return NextResponse.json(
      {
        error: `Exporting the ${DATASET_LABEL[key].toLowerCase()} is not part of your access`
      },
      { status: 403 }
    );
  }

  const org = active.membership.organisationId;
  const entityIds = visibleEntityIds(active, needed);
  const actor = {
    actorKind: 'user' as const,
    actorUserId: active.userId,
    actorLabel: active.email
  };

  const { body, rows, complete } = await renderDataset(
    key,
    org,
    active.membership.organisationName,
    entityIds
  );

  await recordExport({
    organisationId: org,
    dataset: key,
    rows,
    complete,
    actor
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(
        key,
        active.membership.organisationName,
        new Date()
      )}"`,
      'cache-control': 'no-store'
    }
  });
}
