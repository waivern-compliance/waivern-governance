import { and, eq, gte, inArray, lt, min } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  informationRequestRegulatorEvents,
  informationRequestReviews,
  informationRequests
} from '@/db/schema';
import {
  foiFigures,
  reportPeriod,
  reportPeriods,
  type FoiFigures,
  type ReportPeriod
} from '@/lib/foi/report';

import { reviewClockOf } from './information-request-reviews';
import { clockOf, decisionsOf, REFUSING } from './information-requests';

const inEntities = <T extends { entityId: unknown }>(
  table: T,
  entityIds: string[] | null
) => (entityIds ? inArray(table.entityId as never, entityIds) : undefined);

/**
 * The figures for a period, for the requests the caller may see.
 * `entityIds` null means all entities.
 */
export async function foiReport(
  organisationId: string,
  entityIds: string[] | null,
  periodKey?: string,
  now = new Date()
): Promise<{
  period: ReportPeriod;
  periods: ReportPeriod[];
  figures: FoiFigures;
}> {
  return withOrganisation(organisationId, async () => {
    const period = reportPeriod(periodKey, now);
    const scope = and(
      eq(informationRequests.organisationId, organisationId),
      inEntities(informationRequests, entityIds)
    );
    const [[first], rows] =
      entityIds && entityIds.length === 0
        ? [[{ at: null }], []]
        : await Promise.all([
            db
              .select({ at: min(informationRequests.receivedAt) })
              .from(informationRequests)
              .where(scope),
            // Only the period's requests: the figures are for what arrived in it.
            db
              .select()
              .from(informationRequests)
              .where(
                and(
                  scope,
                  gte(informationRequests.receivedAt, period.from),
                  lt(informationRequests.receivedAt, period.to)
                )
              )
          ]);
    const ids = rows.map((r) => r.id);
    const [decisions, reviewRows, events] = await Promise.all([
      decisionsOf(organisationId, ids),
      ids.length
        ? db
            .select()
            .from(informationRequestReviews)
            .where(inArray(informationRequestReviews.requestId, ids))
        : [],
      ids.length
        ? db
            .select({
              requestId: informationRequestRegulatorEvents.requestId,
              kind: informationRequestRegulatorEvents.kind
            })
            .from(informationRequestRegulatorEvents)
            .where(inArray(informationRequestRegulatorEvents.requestId, ids))
        : []
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const figures = foiFigures({
      period,
      requests: rows.map((r) => ({
        id: r.id,
        regimes: r.regimes,
        receivedAt: r.receivedAt,
        status: r.status,
        clockState: clockOf(r, decisions.get(r.id) ?? [], now).state,
        outcome: r.outcome
      })),
      refusals: [...decisions.values()]
        .flat()
        .filter((d) => REFUSING.includes(d.kind))
        .map((d) => ({
          requestId: d.requestId,
          kind: d.kind,
          regime: d.regime,
          provision: d.provision,
          title: typeof d.detail.title === 'string' ? d.detail.title : null
        })),
      reviews: reviewRows.map((r) => ({
        requestId: r.requestId,
        status: r.status,
        outcome: r.outcome,
        clockState: reviewClockOf(r, byId.get(r.requestId)!, now).state
      })),
      regulatorEvents: events
    });
    return {
      period,
      periods: reportPeriods(first?.at ?? null, now),
      figures
    };
  });
}

/**
 * What needs doing now, for the dashboard: requests and reviews whose time is
 * close or gone, for the entities the caller may see.
 */
export async function foiAttention(
  organisationId: string,
  entityIds: string[] | null,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    if (entityIds && entityIds.length === 0)
      return { dueSoon: 0, overdue: 0, reviewsDueSoon: 0, reviewsOverdue: 0 };
    const open = await db
      .select()
      .from(informationRequests)
      .where(
        and(
          eq(informationRequests.organisationId, organisationId),
          eq(informationRequests.status, 'open'),
          inEntities(informationRequests, entityIds)
        )
      );
    const decisions = await decisionsOf(
      organisationId,
      open.map((r) => r.id)
    );
    const states = open.map(
      (r) => clockOf(r, decisions.get(r.id) ?? [], now).state
    );
    const reviews = await db
      .select({
        review: informationRequestReviews,
        request: informationRequests
      })
      .from(informationRequestReviews)
      .innerJoin(
        informationRequests,
        eq(informationRequests.id, informationRequestReviews.requestId)
      )
      .where(
        and(
          eq(informationRequestReviews.organisationId, organisationId),
          eq(informationRequestReviews.status, 'open'),
          inEntities(informationRequests, entityIds)
        )
      );
    const reviewStates = reviews.map(
      ({ review, request }) => reviewClockOf(review, request, now).state
    );
    return {
      dueSoon: states.filter((s) => s === 'due_soon').length,
      overdue: states.filter((s) => s === 'overdue').length,
      reviewsDueSoon: reviewStates.filter((s) => s === 'due_soon').length,
      reviewsOverdue: reviewStates.filter((s) => s === 'overdue').length
    };
  });
}
