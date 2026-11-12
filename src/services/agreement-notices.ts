import { and, asc, eq, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  auditEvents,
  entityAgreements,
  memberships,
  organisations,
  roleAssignments,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { emailConfig, sendEmail, type EmailConfig } from '@/lib/email/resend';
import {
  currentDocument,
  documentPath,
  LEGAL_DOCUMENT_KINDS,
  type LegalDocument
} from '@/lib/legal/documents';

/**
 * Telling an organisation's owners that the terms or the Data Processing
 * Agreement changed.
 *
 * A new version is not accepted again: it applies by notice (terms 12.1, Data
 * Processing Agreement 9.7), and the notice is this email. So it goes to every
 * active owner, whatever their notification settings, because it is a
 * contractual notice and not an alert they can opt out of. Their 30 days to end
 * the agreement run from the change, or from this email if it is later.
 *
 * The audit event is the record that notice was given: when, of which version
 * and digest, and to how many owners. It is also how each notice is sent only
 * once. Where email cannot be sent (anywhere but Waivern's hosted service, or
 * with Resend down), nothing is recorded, so the next sweep tries again.
 */

export const NOTICE_ACTION = 'agreements.change_notified';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Governance Tool'
};

const longDate = (version: string) =>
  new Date(`${version}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

function appUrl(env: Record<string, string | undefined> = process.env) {
  return (env.AUTH_URL ?? '').replace(/\/+$/, '');
}

/** The email that gives notice of a new version. */
export function changeNoticeEmail(
  doc: LegalDocument,
  organisationName: string,
  url = appUrl()
) {
  const name =
    doc.kind === 'terms' ? 'Terms of Service' : 'Data Processing Agreement';
  return {
    subject: `Waivern Governance Tool: the ${name} changed on ${longDate(doc.version)}`,
    text: [
      `The ${name} for the Waivern Governance Tool changed on ${longDate(doc.version)}.`,
      `It applies to ${organisationName} from that date. Nobody needs to accept it again.`,
      '',
      'What has changed:',
      doc.changes ?? 'See the new version.',
      '',
      `Read the new version: ${url}${documentPath(doc)}`,
      '',
      `If ${organisationName} does not agree to the change, an owner may end its use of the service by emailing info@waivern.com within 30 days of the change, or of this email if that is later (Terms of Service, clause 12.1). We will then close the organisation without charge.`,
      '',
      'You are receiving this because you are an owner of the organisation. It is a notice under the contract, so it is sent whatever your notification settings.'
    ].join('\n'),
    tag: `agreement_change_${doc.kind}`
  };
}

/**
 * Whether this organisation is bound by an earlier version of the document: it
 * has accepted some version, and an entity's latest acceptance is older than
 * the current one. An organisation that only ever accepted the current version
 * needs no notice of it.
 */
async function boundByEarlier(organisationId: string, doc: LegalDocument) {
  const column =
    doc.kind === 'terms'
      ? entityAgreements.termsVersion
      : entityAgreements.dpaVersion;
  const rows = await db
    .select({ entityId: entityAgreements.entityId, version: column })
    .from(entityAgreements)
    .where(eq(entityAgreements.organisationId, organisationId));
  const latest = new Map<string, string>();
  for (const r of rows)
    // An acceptance for an entity since deleted binds nobody.
    if (r.entityId && (latest.get(r.entityId) ?? '') < r.version)
      latest.set(r.entityId, r.version);
  return [...latest.values()].some((v) => v < doc.version);
}

async function alreadyNotified(organisationId: string, doc: LegalDocument) {
  const [row] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.action, NOTICE_ACTION),
        sql`${auditEvents.after} ->> 'kind' = ${doc.kind}`,
        sql`${auditEvents.after} ->> 'version' = ${doc.version}`
      )
    )
    .limit(1);
  return row !== undefined;
}

async function activeOwners(organisationId: string) {
  return db
    .selectDistinct({ id: users.id, email: users.email })
    .from(roleAssignments)
    .innerJoin(memberships, eq(memberships.id, roleAssignments.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organisationId, organisationId),
        eq(memberships.isActive, true),
        eq(roleAssignments.role, 'owner')
      )
    )
    .orderBy(asc(users.email));
}

/**
 * Email this organisation's owners about any current version they have not
 * yet been told of. Returns how many notices were sent. Run by the sweep.
 */
export async function notifyAgreementChanges(
  organisationId: string,
  options: { config?: EmailConfig | null; fetch?: typeof fetch } = {}
): Promise<number> {
  const config = options.config === undefined ? emailConfig() : options.config;
  if (!config) return 0;
  return withOrganisation(organisationId, async () => {
    const [org] = await db
      .select({ name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    if (!org) return 0;
    let sent = 0;
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      const doc = currentDocument(kind);
      if (!(await boundByEarlier(organisationId, doc))) continue;
      if (await alreadyNotified(organisationId, doc)) continue;
      const owners = await activeOwners(organisationId);
      if (owners.length === 0) continue;
      const outcome = await sendEmail(
        { to: owners.map((o) => o.email), ...changeNoticeEmail(doc, org.name) },
        { config, fetch: options.fetch }
      );
      if (!outcome.sent) continue;
      await db.transaction(async (tx) => {
        await appendAuditEvent(tx, {
          ...SYSTEM,
          organisationId,
          action: NOTICE_ACTION,
          subjectType: 'organisation',
          subjectId: organisationId,
          after: {
            kind,
            version: doc.version,
            sha256: doc.sha256,
            ownerIds: owners.map((o) => o.id),
            messageId: outcome.messageId
          }
        });
      });
      sent += 1;
    }
    return sent;
  });
}
