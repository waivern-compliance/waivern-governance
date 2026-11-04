import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  memberships,
  notifications,
  organisations,
  roleAssignments,
  tasks,
  users
} from '@/db/schema';
import { appRole } from '@/db/schema/enums';
import {
  isEmailedKind,
  memberEmail,
  memberEmailConfig,
  STALE_AFTER_HOURS,
  type MemberNotice
} from '@/lib/email/member';
import { sendEmail, type EmailConfig } from '@/lib/email/resend';
import { log } from '@/lib/log';
import { pathFor } from '@/lib/records';

/**
 * Hands recorded notifications (`notification`) to email, for the people who
 * asked for them. Run by the sweep, after the governance work.
 *
 * Where member email is not switched on, nothing is read or marked: the
 * notifications stay the record they always were. Where it is, each one is
 * dealt with once and its `outcome` says what happened — how many people were
 * emailed, or why nobody was. A send that fails is left to be tried again on
 * the next sweep, until it is too old to be worth sending.
 */

const BATCH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set<string>(appRole.enumValues);

type Recipient = { userId: string; email: string; optedIn: boolean };

/**
 * Who a notification is for. It names a person by user id or email address,
 * or a role — everybody holding it over the task's legal entity. Only active
 * members of the organisation count; a bare address with no account (an
 * outside contributor) cannot have opted in, so is never emailed from here.
 */
async function recipientsOf(
  organisationId: string,
  recipient: string,
  entityId: string | null
): Promise<Recipient[]> {
  const base = db
    .selectDistinct({
      userId: users.id,
      email: users.email,
      optedIn: users.emailNotifications
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId));
  const active = and(
    eq(memberships.organisationId, organisationId),
    eq(memberships.isActive, true)
  );

  if (UUID.test(recipient))
    return base.where(and(active, eq(users.id, recipient)));
  if (recipient.includes('@'))
    return base.where(
      and(active, eq(users.email, recipient.trim().toLowerCase()))
    );
  if (ROLES.has(recipient)) {
    return base
      .innerJoin(
        roleAssignments,
        eq(roleAssignments.membershipId, memberships.id)
      )
      .where(
        and(
          active,
          eq(
            roleAssignments.role,
            recipient as (typeof appRole.enumValues)[number]
          ),
          entityId
            ? or(
                eq(roleAssignments.scope, 'organisation'),
                eq(roleAssignments.entityId, entityId)
              )
            : eq(roleAssignments.scope, 'organisation')
        )
      );
  }
  return [];
}

type Planned = {
  id: string;
  /** Set when it needs no sending: why. */
  outcome?: string;
  emails?: Array<{ to: string; message: ReturnType<typeof memberEmail> }>;
};

/** Where a notification's link goes: its task's record, else what its body names. */
function pathOf(
  body: string,
  task: { subjectType: string; subjectId: string } | null
): string {
  if (task) return pathFor(task.subjectType, task.subjectId) ?? '/app/tasks';
  const last = body.trim().split('\n').at(-1)?.trim() ?? '';
  return last.startsWith('/app') ? last : '/app/tasks';
}

export type DeliveryResult = {
  emailed: number;
  dealtWith: number;
  failed: number;
};

export async function deliverNotifications(
  organisationId: string,
  options: {
    config?: EmailConfig | null;
    fetch?: typeof fetch;
    now?: Date;
  } = {}
): Promise<DeliveryResult> {
  const config =
    options.config === undefined ? memberEmailConfig() : options.config;
  const result: DeliveryResult = { emailed: 0, dealtWith: 0, failed: 0 };
  if (!config) return result;
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_HOURS * 3600_000);

  // Read and plan inside the organisation; send outside it, so a slow mail
  // service never holds a database transaction open.
  const planned = await withOrganisation(organisationId, async () => {
    const [org] = await db
      .select({ name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    const pending = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organisationId, organisationId),
          isNull(notifications.sentAt)
        )
      )
      .orderBy(asc(notifications.createdAt))
      .limit(BATCH);
    const taskIds = pending
      .map((n) => n.taskId)
      .filter((id): id is string => Boolean(id));
    const taskRows = taskIds.length
      ? await db
          .select({
            id: tasks.id,
            entityId: tasks.entityId,
            title: tasks.title,
            dueAt: tasks.dueAt,
            subjectType: tasks.subjectType,
            subjectId: tasks.subjectId
          })
          .from(tasks)
          .where(inArray(tasks.id, taskIds))
      : [];
    const taskById = new Map(taskRows.map((t) => [t.id, t]));

    const plans: Planned[] = [];
    for (const n of pending) {
      if (!isEmailedKind(n.kind)) {
        plans.push({ id: n.id, outcome: 'not emailed: not an alert kind' });
        continue;
      }
      if (n.createdAt < staleBefore) {
        plans.push({
          id: n.id,
          outcome: `not emailed: older than ${STALE_AFTER_HOURS} hours`
        });
        continue;
      }
      const task = n.taskId ? (taskById.get(n.taskId) ?? null) : null;
      const people = await recipientsOf(
        organisationId,
        n.recipient,
        task?.entityId ?? null
      );
      const wanting = people.filter((p) => p.optedIn);
      if (wanting.length === 0) {
        plans.push({
          id: n.id,
          outcome:
            people.length === 0
              ? 'not emailed: nobody to send to'
              : 'not emailed: nobody asked for email'
        });
        continue;
      }
      const notice: MemberNotice = {
        kind: n.kind,
        subject: n.subject,
        organisationName: org?.name ?? 'your organisation',
        task: task ? { title: task.title, dueAt: task.dueAt } : null,
        path: pathOf(n.body, task)
      };
      const message = memberEmail(notice);
      plans.push({
        id: n.id,
        emails: wanting.map((p) => ({ to: p.email, message }))
      });
    }
    return plans;
  });

  const outcomes: Array<{ id: string; outcome: string }> = [];
  for (const plan of planned) {
    if (plan.outcome) {
      outcomes.push({ id: plan.id, outcome: plan.outcome });
      continue;
    }
    let sent = 0;
    let failed = 0;
    // One email per person, so nobody sees who else was told.
    for (const e of plan.emails ?? []) {
      const outcome = await sendEmail(
        { ...e.message, to: [e.to] },
        { config, fetch: options.fetch }
      );
      if (outcome.sent) sent += 1;
      else failed += 1;
    }
    result.emailed += sent;
    result.failed += failed;
    // Nobody reached: leave it to be tried again. Anybody reached: done, so a
    // retry never emails the same person twice.
    if (sent > 0)
      outcomes.push({
        id: plan.id,
        outcome: `emailed ${sent}${failed ? `, ${failed} failed` : ''}`
      });
  }

  if (outcomes.length > 0) {
    await withOrganisation(organisationId, async () => {
      for (const o of outcomes) {
        await db
          .update(notifications)
          .set({ sentAt: now, outcome: o.outcome })
          .where(
            and(
              eq(notifications.id, o.id),
              eq(notifications.organisationId, organisationId)
            )
          );
      }
    });
  }
  result.dealtWith = outcomes.length;
  if (result.emailed || result.failed) {
    log('info', 'member_email.delivered', {
      emailed: result.emailed,
      failed: result.failed,
      dealtWith: result.dealtWith
    });
  }
  return result;
}

/** A person's own choice about alert and action emails. Theirs alone, so it is not tenant-scoped. */
export async function setEmailNotifications(userId: string, on: boolean) {
  await db
    .update(users)
    .set({ emailNotifications: on, emailNotificationsChangedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Read back a person's choice, for their profile page. */
export async function emailNotificationsFor(userId: string) {
  const [row] = await db
    .select({
      on: users.emailNotifications,
      changedAt: users.emailNotificationsChangedAt
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? { on: false, changedAt: null };
}
