import type { Db } from '@/db/client';
import { memberships, roleAssignments, users } from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { log } from '@/lib/log';
import type { AppRole } from '@/lib/rbac';
import { SIMULATED_DOMAIN } from '@/lib/trial-rules';

import { createUseCase } from './ai-register';
import { recordBreach } from './breaches';
import { recordComplaint } from './complaints';
import { recordRequest } from './data-subject-requests';
import { createRisk } from './risks';
import { createActivity } from './ropa';
import type { Actor } from './templates';
import { createSupplier, recordDpa } from './third-party';

/**
 * The fictional company a trial starts with, so somebody sees the tool doing
 * something within minutes rather than facing empty registers.
 *
 * Everything here is made up: the company, its people, its suppliers, the
 * people who asked and complained. Contact details are at `example.com`,
 * which is reserved and reaches nobody, and the colleagues are at
 * `simulated.invalid`, which cannot receive mail at all.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const DEMO = {
  organisationName: 'Brackenfield Home Goods (demo)',
  entityName: 'Brackenfield Home Goods Ltd'
} as const;

/**
 * The trial's simulated colleagues, and what each is asked to do. Approvals,
 * reviews and tasks that name their roles go to them, in the app only.
 */
export const COLLEAGUES: ReadonlyArray<{
  name: string;
  local: string;
  title: string;
  role: AppRole;
}> = [
  {
    name: 'Priya Raman',
    local: 'priya.raman',
    title: 'Head of Legal',
    role: 'approver'
  },
  {
    name: 'Owen Castell',
    local: 'owen.castell',
    title: 'Privacy analyst',
    role: 'privacy_analyst'
  },
  {
    name: 'Hana Okoro',
    local: 'hana.okoro',
    title: 'Data science lead',
    role: 'ai_governance'
  }
];

const DEMO_ACTOR: Actor = {
  actorKind: 'system',
  actorUserId: null,
  actorLabel: 'Trial demo data'
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

/** A colleague's address: theirs alone, in this trial alone, at a domain nobody can mail. */
export function colleagueAddress(local: string, organisationId: string) {
  return `${local}.${organisationId.slice(0, 8)}@${SIMULATED_DOMAIN}`;
}

/**
 * Add the simulated colleagues, in the transaction that creates the trial,
 * after its record exists: the database admits them to a trial only because
 * they are simulated (migration 0115).
 */
export async function addSimulatedColleagues(
  tx: Tx,
  organisationId: string
): Promise<Map<AppRole, string>> {
  const byRole = new Map<AppRole, string>();
  for (const c of COLLEAGUES) {
    const id = crypto.randomUUID();
    const email = colleagueAddress(c.local, organisationId);
    // No `returning`: until the membership below exists, this organisation
    // cannot see the person it has just created.
    await tx.insert(users).values({
      id,
      email,
      name: `${c.name} (simulated)`,
      simulated: true
    });
    const [membership] = await tx
      .insert(memberships)
      .values({ organisationId, userId: id })
      .returning();
    const [grant] = await tx
      .insert(roleAssignments)
      .values({
        membershipId: membership.id,
        role: c.role,
        scope: 'organisation'
      })
      .returning();
    await appendAuditEvent(tx, {
      ...DEMO_ACTOR,
      organisationId,
      action: 'role_assignment.granted',
      subjectType: 'role_assignment',
      subjectId: grant.id,
      after: { email, role: c.role, scope: 'organisation', simulated: true }
    });
    byRole.set(c.role, id);
  }
  return byRole;
}

/**
 * Fill a new trial with the demo company's records, through the same
 * services a person uses, so each comes with its tasks, clocks and audit
 * events. Never fatal: a trial that could not be filled is still a trial.
 */
export async function seedTrialDemo(input: {
  organisationId: string;
  entityId: string;
  ownerId: string;
  colleagues: Map<AppRole, string>;
}) {
  const { organisationId, entityId } = input;
  const base = { organisationId, actor: DEMO_ACTOR };
  const analyst = input.colleagues.get('privacy_analyst') ?? input.ownerId;
  const aiLead = input.colleagues.get('ai_governance') ?? input.ownerId;
  try {
    await createActivity({
      ...base,
      entityId,
      name: 'Online orders and delivery',
      description:
        'Taking orders on the website, payment through a card processor, and passing names and addresses to the courier.',
      purposes: ['Fulfil customer orders'],
      lawfulBasis: 'contract',
      dataCategories: ['contact_details', 'financial', 'contractual'],
      subjectCategories: ['customers'],
      recipients: ['Courier', 'Card processor'],
      retention: 'Six years from the order, for tax records.',
      ownerId: analyst
    });
    await createActivity({
      ...base,
      entityId,
      name: 'Customer newsletter',
      description: 'A monthly email of offers to customers who opted in.',
      purposes: ['Direct marketing'],
      lawfulBasis: 'consent',
      dataCategories: ['contact_details'],
      subjectCategories: ['customers'],
      retention: 'Until the customer unsubscribes.',
      ownerId: analyst
    });
    await createActivity({
      ...base,
      entityId,
      name: 'Warehouse staff recruitment',
      description:
        'Applications, interviews and right-to-work checks for warehouse roles.',
      purposes: ['Recruitment'],
      lawfulBasis: 'legal_obligation',
      dataCategories: ['contact_details', 'employment'],
      subjectCategories: ['staff'],
      retention: 'Six months after the role is filled.'
    });

    // Discovered twenty hours ago: the seventy-two hours to tell the
    // regulator are running, with most of them left.
    await recordBreach({
      ...base,
      entityId,
      title: 'Delivery manifest emailed to the wrong courier depot',
      description:
        "A spreadsheet of one day's deliveries, with 412 customers' names and addresses, was emailed to the wrong depot. The depot says it has deleted it; that has not been confirmed in writing.",
      discoveredAt: ago(20 * HOUR),
      occurredAt: ago(26 * HOUR),
      ownerId: analyst
    });

    const routing = await createUseCase({
      ...base,
      entityId,
      name: 'Delivery route optimiser',
      purpose:
        'Plans the order of deliveries each day, using addresses and time slots.',
      systemType: 'predictive',
      provenance: 'built_in_house',
      lifecycleStage: 'production',
      responsibleTeam: 'Data science',
      processesPersonalData: true,
      ownerId: aiLead,
      nextReviewAt: ahead(30 * DAY)
    });
    await createRisk({
      ...base,
      entityId,
      title: `${routing.reference}: rural customers get the latest slots`,
      description:
        'The optimiser favours dense routes, so customers in outlying villages are always offered the last slot of the day.',
      likelihood: 3,
      impact: 2,
      ownerId: aiLead
    });
    await createRisk({
      ...base,
      entityId,
      title: `${routing.reference}: addresses kept longer than the orders`,
      description:
        'The training set holds two years of delivery addresses, longer than the retention period for orders allows.',
      likelihood: 2,
      impact: 3,
      ownerId: aiLead
    });

    // Suppliers with gaps: one agreement unsigned and about to lapse, one
    // supplier with no agreement at all.
    const hosting = await createSupplier({
      ...base,
      name: 'Cloudmere Hosting (fictional)',
      description: 'Hosts the website and the order database.'
    });
    await recordDpa({
      ...base,
      supplierId: hosting.id,
      title: 'Cloudmere data processing addendum',
      signedAt: null,
      expiresAt: ahead(20 * DAY),
      subProcessors: ['Unnamed backup provider']
    });
    await createSupplier({
      ...base,
      name: 'Parcelwise Couriers (fictional)',
      description:
        'Delivers orders. Receives names, addresses and phone numbers. No agreement on file.'
    });

    await recordRequest({
      ...base,
      entityId,
      rights: ['access'],
      channel: 'email',
      receivedAt: ago(9 * DAY),
      description:
        'Asked for a copy of everything held about them, including call recordings.',
      requesterName: 'Alex Marsh (fictional)',
      requesterContact: 'alex.marsh@example.com',
      ownerId: analyst
    });
    await recordComplaint({
      ...base,
      entityId,
      channel: 'email',
      receivedAt: ago(4 * DAY),
      subject: 'request_handling',
      description:
        'Unhappy that a request to stop the newsletter took three weeks to act on.',
      complainantName: 'Jordan Pike (fictional)',
      complainantContact: 'jordan.pike@example.com',
      ownerId: analyst
    });
  } catch (error) {
    log('warn', 'trial.demo_failed', {
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown'
    });
  }
}
