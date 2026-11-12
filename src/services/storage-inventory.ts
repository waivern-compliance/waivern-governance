import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  consentScans,
  digitalProperties,
  entities,
  evidence,
  organisations,
  referenceCounters,
  scanFindings,
  storageDecisions,
  storageItems,
  storageProposals,
  tasks,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  entityEprivacy,
  recordEprivacy,
  type EprivacyScope
} from '@/lib/ie-eprivacy/scope';
import {
  cleanBannerChecks,
  DEFAULT_LIFESPAN_THRESHOLD_MONTHS,
  IE_BASES,
  irishGapsOf,
  irishPropertyGaps,
  isIrishBasis,
  type IrishBasis
} from '@/lib/ie-eprivacy/storage';
import {
  failingChecks,
  itemKey,
  MAX_STRIPPED_BYTES,
  observedStorage,
  registrable,
  reportSummary,
  stripReport,
  validateReport,
  type ObservedItem
} from '@/lib/pecr/analyser-report';
import { RESCAN_INTERVALS, rescanDueAt, rescanState } from '@/lib/pecr/rescan';
import {
  BASES,
  BASIS_KEYS,
  gapsOf,
  summariseGaps,
  type ConditionKey,
  type Gap,
  type StorageBasis
} from '@/lib/pecr/statutory';

import { eprivacyScopeFor } from './entities';
import type { Actor } from './templates';
import {
  assertEntityIn,
  assertMemberOf,
  assertRecordIn
} from './tenancy-guards';
import { raiseTask } from './workflow';

/**
 * The inventory of cookies and similar technologies, per website or app, and
 * the PECR Schedule A1 basis each relies on.
 *
 * Modelled on the other registers: observations come from the Consent
 * Analyser, and every judgement — that something is on the inventory, that it
 * is no longer used, what it relies on — is a named person's, with reasons.
 * Nothing here gives an item a basis because a scanner thought it looked like
 * analytics.
 */

export type DigitalProperty = typeof digitalProperties.$inferSelect;
export type StorageItem = typeof storageItems.$inferSelect;
export type StorageDecision = typeof storageDecisions.$inferSelect;
export type StorageProposal = typeof storageProposals.$inferSelect;
export type ConsentScan = typeof consentScans.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class InventoryRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryRefused';
  }
}

export const ITEM_KINDS = [
  'cookie',
  'local_storage',
  'session_storage',
  'pixel',
  'sdk',
  'other'
] as const;

async function nextReference(organisationId: string, year: number) {
  const rows = await db.execute<{ next_value: number | string }>(sql`
    insert into ${referenceCounters} (organisation_id, prefix, year, next_value)
    values (${organisationId}, 'WEB', ${year}, 1)
    on conflict (organisation_id, prefix, year)
      do update set next_value = ${referenceCounters}.next_value + 1
    returning next_value
  `);
  return `WEB-${year}-${String(Number(rows[0]?.next_value ?? 1)).padStart(4, '0')}`;
}

const trimmed = (v: string | null | undefined) => v?.trim() || null;

function validUrl(v: string | null | undefined, what: string): string | null {
  const value = trimmed(v);
  if (value && !/^https?:\/\//.test(value))
    throw new InventoryRefused(`${what} should start with https://.`);
  return value;
}

export async function createProperty(input: {
  organisationId: string;
  entityId: string;
  name: string;
  url: string;
  kind?: 'website' | 'app';
  ownerId?: string | null;
  informationUrl?: string | null;
  objectionMechanism?: string | null;
  /** UK PECR, the Irish ePrivacy Regulations or both; absent, the entity's. */
  eprivacyScope?: string | null;
  actor: Actor;
}) {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) throw new InventoryRefused('Give the website or app a name.');
  if (!url)
    throw new InventoryRefused(
      'Give its address, or for an app its store link or identifier.'
    );
  if ((input.kind ?? 'website') === 'website' && !/^https?:\/\//.test(url)) {
    throw new InventoryRefused(
      "A website's address should start with https://."
    );
  }
  const informationUrl = validUrl(
    input.informationUrl,
    "The cookie notice's address"
  );

  return withOrganisation(input.organisationId, async () => {
    await assertEntityIn(input.organisationId, input.entityId);
    const eprivacyScope = await eprivacyScopeFor(
      input.entityId,
      input.eprivacyScope
    );
    if (input.ownerId)
      await assertMemberOf(input.organisationId, input.ownerId);
    const reference = await nextReference(
      input.organisationId,
      new Date().getUTCFullYear()
    );
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(digitalProperties)
        .values({
          organisationId: input.organisationId,
          entityId: input.entityId,
          reference,
          name,
          url,
          kind: input.kind ?? 'website',
          ownerId: input.ownerId ?? null,
          informationUrl,
          objectionMechanism: trimmed(input.objectionMechanism),
          eprivacyScope
        })
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.entityId,
        action: 'pecr.property_created',
        subjectType: 'digital_property',
        subjectId: row.id,
        after: { reference, name, url, kind: row.kind, eprivacyScope }
      });
      return row;
    });
  });
}

async function lockedProperty(
  tx: Tx,
  propertyId: string,
  organisationId: string
) {
  const [row] = await tx
    .select()
    .from(digitalProperties)
    .where(
      and(
        eq(digitalProperties.id, propertyId),
        eq(digitalProperties.organisationId, organisationId)
      )
    )
    .for('update');
  if (!row) throw new Error('No such website or app');
  return row;
}

export async function updateProperty(input: {
  propertyId: string;
  organisationId: string;
  changes: Partial<{
    name: string;
    url: string;
    ownerId: string | null;
    informationUrl: string | null;
    objectionMechanism: string | null;
    cmp: string | null;
    rescanIntervalMonths: number | null;
    eprivacyScope: string;
    /** Under the Irish Regulations: months before consent is asked again, and why where over six. */
    consentRenewalMonths: number | null;
    consentRenewalJustification: string | null;
    /** The banner checks confirmed, by key (`BANNER_CHECKS`). */
    bannerChecks: string[];
    /** The processing activity its consent is recorded under. */
    processingActivityId: string | null;
  }>;
  actor: Actor;
}) {
  const { bannerChecks: ticked, ...given } = input.changes;
  const changes: Omit<typeof given, never> & {
    bannerChecks?: Record<string, boolean>;
  } = {
    ...given,
    ...(ticked !== undefined ? { bannerChecks: cleanBannerChecks(ticked) } : {})
  };
  if (
    changes.consentRenewalMonths != null &&
    (!Number.isInteger(changes.consentRenewalMonths) ||
      changes.consentRenewalMonths < 1 ||
      changes.consentRenewalMonths > 60)
  )
    throw new InventoryRefused(
      'Give how many whole months consent lasts, from 1 to 60.'
    );
  if (changes.consentRenewalJustification !== undefined)
    changes.consentRenewalJustification = trimmed(
      changes.consentRenewalJustification
    );
  if (
    changes.rescanIntervalMonths != null &&
    !(RESCAN_INTERVALS as readonly number[]).includes(
      changes.rescanIntervalMonths
    )
  ) {
    throw new InventoryRefused('Choose how often it is scanned again.');
  }
  if (changes.name !== undefined && !changes.name.trim())
    throw new InventoryRefused('Give the website or app a name.');
  if (changes.url !== undefined && !changes.url.trim())
    throw new InventoryRefused('Give its address.');
  if (changes.informationUrl !== undefined)
    changes.informationUrl = validUrl(
      changes.informationUrl,
      "The cookie notice's address"
    );
  if (changes.objectionMechanism !== undefined)
    changes.objectionMechanism = trimmed(changes.objectionMechanism);

  return withOrganisation(input.organisationId, async () => {
    if (changes.ownerId)
      await assertMemberOf(input.organisationId, changes.ownerId);
    if (changes.processingActivityId)
      await assertRecordIn(
        input.organisationId,
        'processing_activity',
        changes.processingActivityId
      );
    return db.transaction(async (tx) => {
      const before = await lockedProperty(
        tx,
        input.propertyId,
        input.organisationId
      );
      const { eprivacyScope: chosenScope, ...rest } = changes;
      const eprivacyScope =
        chosenScope === undefined
          ? undefined
          : await eprivacyScopeFor(before.entityId, chosenScope);
      const [after] = await tx
        .update(digitalProperties)
        .set({
          ...rest,
          ...(eprivacyScope ? { eprivacyScope } : {}),
          updatedAt: new Date()
        })
        .where(eq(digitalProperties.id, input.propertyId))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: before.entityId,
        action: 'pecr.property_updated',
        subjectType: 'digital_property',
        subjectId: input.propertyId,
        before: {
          informationUrl: before.informationUrl,
          objectionMechanism: before.objectionMechanism,
          rescanIntervalMonths: before.rescanIntervalMonths,
          eprivacyScope: before.eprivacyScope,
          consentRenewalMonths: before.consentRenewalMonths,
          bannerChecks: before.bannerChecks,
          processingActivityId: before.processingActivityId,
          changed: Object.keys(changes)
        },
        after: {
          informationUrl: after.informationUrl,
          objectionMechanism: after.objectionMechanism,
          rescanIntervalMonths: after.rescanIntervalMonths,
          eprivacyScope: after.eprivacyScope,
          consentRenewalMonths: after.consentRenewalMonths,
          bannerChecks: after.bannerChecks,
          processingActivityId: after.processingActivityId
        }
      });
      return after;
    });
  });
}

/** Add an item by hand: something a scan cannot see, such as an app SDK or a server-set cookie behind a login. */
export async function addItem(input: {
  propertyId: string;
  organisationId: string;
  name: string;
  kind?: (typeof ITEM_KINDS)[number];
  domain?: string | null;
  party?: 'first' | 'third' | 'unknown';
  expiry?: string | null;
  purpose?: string | null;
  supplierId?: string | null;
  actor: Actor;
}) {
  const name = input.name.trim();
  if (!name)
    throw new InventoryRefused(
      'Give the cookie or item its name, as it appears in the browser or the code.'
    );
  const kind = input.kind ?? 'cookie';
  if (!(ITEM_KINDS as readonly string[]).includes(kind))
    throw new InventoryRefused('Choose what kind of item it is.');

  return withOrganisation(input.organisationId, async () => {
    if (input.supplierId)
      await assertRecordIn(input.organisationId, 'supplier', input.supplierId);
    return db.transaction(async (tx) => {
      const property = await lockedProperty(
        tx,
        input.propertyId,
        input.organisationId
      );
      const domain = trimmed(input.domain);
      const key = itemKey(kind, domain, name);
      const [row] = await tx
        .insert(storageItems)
        .values({
          organisationId: input.organisationId,
          propertyId: property.id,
          key,
          name,
          kind,
          domain,
          party: input.party ?? 'unknown',
          expiry: trimmed(input.expiry),
          purpose: trimmed(input.purpose),
          supplierId: input.supplierId ?? null,
          source: 'manual'
        })
        .onConflictDoNothing()
        .returning();
      if (!row)
        throw new InventoryRefused('That item is already on this inventory.');
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: property.entityId,
        action: 'pecr.item_added',
        subjectType: 'storage_item',
        subjectId: row.id,
        after: {
          property: property.reference,
          name,
          kind,
          domain,
          source: 'manual'
        }
      });
      return row;
    });
  });
}

async function lockedItem(tx: Tx, itemId: string, organisationId: string) {
  const [row] = await tx
    .select({ item: storageItems, property: digitalProperties })
    .from(storageItems)
    .innerJoin(
      digitalProperties,
      eq(digitalProperties.id, storageItems.propertyId)
    )
    .where(
      and(
        eq(storageItems.id, itemId),
        eq(storageItems.organisationId, organisationId)
      )
    )
    .for('update', { of: storageItems });
  if (!row) throw new Error('No such item');
  return row;
}

/** What an item is for, who receives it, and whether it is still used. */
export async function updateItem(input: {
  itemId: string;
  organisationId: string;
  changes: Partial<{
    purpose: string | null;
    supplierId: string | null;
    expiry: string | null;
    party: 'first' | 'third' | 'unknown';
    status: 'active' | 'removed';
  }>;
  actor: Actor;
}) {
  const changes = { ...input.changes };
  if (changes.purpose !== undefined) changes.purpose = trimmed(changes.purpose);
  if (changes.expiry !== undefined) changes.expiry = trimmed(changes.expiry);
  return withOrganisation(input.organisationId, async () => {
    if (changes.supplierId)
      await assertRecordIn(
        input.organisationId,
        'supplier',
        changes.supplierId
      );
    return db.transaction(async (tx) => {
      const { item, property } = await lockedItem(
        tx,
        input.itemId,
        input.organisationId
      );
      const [after] = await tx
        .update(storageItems)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(storageItems.id, input.itemId))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: property.entityId,
        action:
          changes.status && changes.status !== item.status
            ? 'pecr.item_status_set'
            : 'pecr.item_updated',
        subjectType: 'storage_item',
        subjectId: input.itemId,
        before: { status: item.status, changed: Object.keys(changes) },
        after: {
          property: property.reference,
          name: item.name,
          status: after.status
        }
      });
      return after;
    });
  });
}

/**
 * Record the basis an item relies on.
 *
 * Only the conditions the basis actually has are kept, and the reasoning is
 * required. What is still missing — information, a way to object, a supplier —
 * is not refused here: it is shown as a gap, because the decision and the
 * fixing of the website are usually done by different people at different times.
 */
export async function recordStorageDecision(input: {
  itemId: string;
  organisationId: string;
  basis: StorageBasis;
  conditions?: Partial<Record<ConditionKey, boolean>>;
  rationale: string;
  /** The law it is recorded under: UK PECR (the default) or the Irish Regulations. */
  law?: 'uk' | 'ie';
  actor: Actor;
}) {
  const law = input.law ?? 'uk';
  if (law !== 'uk' && law !== 'ie')
    throw new InventoryRefused('Choose UK PECR or the Irish Regulations.');
  if (
    law === 'uk'
      ? !BASIS_KEYS.includes(input.basis)
      : !isIrishBasis(input.basis)
  )
    throw new InventoryRefused(
      law === 'ie' && BASIS_KEYS.includes(input.basis)
        ? `The Irish Regulations have no ${BASES[input.basis].label.toLowerCase()} exception: only consent, or storage solely to carry a communication or strictly necessary for a service the person asked for (reg 5(5)).`
        : 'Choose the basis it relies on, or record that there is none.'
    );
  const rationale = input.rationale.trim();
  if (!rationale) throw new InventoryRefused('Say why this basis applies.');
  const basis =
    law === 'ie' ? IE_BASES[input.basis as IrishBasis] : BASES[input.basis];
  const conditions = Object.fromEntries(
    basis.conditions.map((c) => [c.key, Boolean(input.conditions?.[c.key])])
  );

  return withOrganisation(input.organisationId, async () => {
    return db.transaction(async (tx) => {
      const { item, property } = await lockedItem(
        tx,
        input.itemId,
        input.organisationId
      );
      // Recorded only under a law the website or app answers to.
      const [entity] = await tx
        .select({
          dataProtectionLaw: entities.dataProtectionLaw,
          ieEprivacy: entities.ieEprivacy
        })
        .from(entities)
        .where(eq(entities.id, property.entityId));
      const scope = entity
        ? recordEprivacy(entity, property.eprivacyScope)
        : null;
      const answers =
        law === 'uk' ? scope !== 'ie' : scope === 'ie' || scope === 'uk_ie';
      if (!answers)
        throw new InventoryRefused(
          law === 'ie'
            ? 'This website or app is not recorded as under the Irish Regulations.'
            : 'This website or app is not recorded as under UK PECR.'
        );
      const [row] = await tx
        .insert(storageDecisions)
        .values({
          organisationId: input.organisationId,
          itemId: item.id,
          law,
          basis: input.basis,
          conditions,
          statutoryBasis: basis.citation,
          rationale,
          decidedBy: input.actor.actorUserId,
          decidedByLabel: input.actor.actorLabel
        })
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: property.entityId,
        action: 'pecr.basis_decided',
        subjectType: 'storage_item',
        subjectId: item.id,
        after: {
          property: property.reference,
          name: item.name,
          basis: input.basis,
          law,
          conditions,
          decisionId: row.id
        }
      });
      return row;
    });
  });
}

/** Does a report's address belong to this property? Compared on the registrable domain. */
export function sameSite(a: string, b: string): boolean {
  const host = (u: string) => {
    try {
      return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname;
    } catch {
      return u;
    }
  };
  return registrable(host(a)) === registrable(host(b));
}

const SEVERITY: Record<string, 'medium' | 'low'> = {
  FAIL: 'medium',
  PARTIAL: 'low'
};

/**
 * Checks whose failure the DUAA's statistics exception may answer: cookies set
 * before consent. Not those still collecting after Reject — rejecting is
 * objecting, and para 5 needs the person not to have objected.
 */
const EXEMPTION_MAY_APPLY = new Set(['B.2']);

/**
 * Take a Consent Analyser report into the inventory.
 *
 * The report is validated, stripped of screenshots and cookie values, and kept
 * as evidence. What the scan saw updates each existing item's observations;
 * anything new, and anything scanned before but not seen now, becomes a
 * proposal for a person. Failing checks become scan findings, as from any
 * scanner, each of which a person may turn into a risk.
 */
export async function ingestAnalyserReport(input: {
  propertyId: string;
  organisationId: string;
  report: unknown;
  source: 'upload' | 'api';
  /** Record it even though the report's address is a different site. */
  acceptOtherSite?: boolean;
  analyserUrl?: string | null;
  /** For a run started from here: the scan record waiting for this report. */
  scanId?: string;
  actor: Actor;
}) {
  const validated = validateReport(input.report);
  if (!validated.ok) throw new InventoryRefused(validated.reason);
  const stripped = stripReport(validated.report);
  if (JSON.stringify(stripped).length > MAX_STRIPPED_BYTES) {
    throw new InventoryRefused(
      'That report is too large to keep, even without its screenshots.'
    );
  }
  const summary = reportSummary(stripped);
  const observed = observedStorage(stripped);
  const failures = failingChecks(stripped);

  return withOrganisation(input.organisationId, async () => {
    return db.transaction(async (tx) => {
      const property = await lockedProperty(
        tx,
        input.propertyId,
        input.organisationId
      );
      if (
        summary.targetUrl &&
        !sameSite(summary.targetUrl, property.url) &&
        !input.acceptOtherSite
      ) {
        throw new InventoryRefused(
          `That report is for ${summary.targetUrl}, not ${property.url}. Check it is the right report, or confirm it belongs here.`
        );
      }
      if (summary.runId) {
        const [already] = await tx
          .select({ id: consentScans.id })
          .from(consentScans)
          .where(
            and(
              eq(consentScans.propertyId, property.id),
              eq(consentScans.analyserRunId, summary.runId),
              eq(consentScans.status, 'done')
            )
          );
        if (already && already.id !== input.scanId)
          throw new InventoryRefused(
            `Run ${summary.runId} is already recorded for this property.`
          );
      }

      const now = new Date();
      const scannedAt =
        summary.testedAt && !Number.isNaN(Date.parse(summary.testedAt))
          ? new Date(summary.testedAt)
          : now;
      const [ev] = await tx
        .insert(evidence)
        .values({
          organisationId: input.organisationId,
          entityId: property.entityId,
          kind: 'scan',
          title: `Consent Analyser run ${summary.runId ?? '(no run id)'} - ${summary.targetUrl ?? property.url}`,
          description: `${observed.length} cookies or similar items seen; ${failures.length} checks failed or partly passed.`,
          uri: summary.targetUrl ?? property.url,
          collectedAt: scannedAt,
          payload: stripped as unknown as Record<string, unknown>
        })
        .returning();

      const scanValues = {
        status: 'done' as const,
        completedAt: now,
        analyserRunId: summary.runId,
        targetUrl: summary.targetUrl,
        mode: summary.mode,
        // A run started from here already knows its region; a report's own probe
        // location is used only where it says one.
        ...(summary.probeLocation ? { region: summary.probeLocation } : {}),
        summary: summary as unknown as Record<string, unknown>,
        evidenceId: ev.id,
        observed: observed.length
      };
      const [scan] = input.scanId
        ? await tx
            .update(consentScans)
            .set(scanValues)
            .where(
              and(
                eq(consentScans.id, input.scanId),
                eq(consentScans.propertyId, property.id)
              )
            )
            .returning()
        : await tx
            .insert(consentScans)
            .values({
              organisationId: input.organisationId,
              propertyId: property.id,
              source: input.source,
              analyserUrl: input.analyserUrl ?? null,
              startedAt: now,
              startedBy: input.actor.actorUserId,
              startedByLabel: input.actor.actorLabel,
              ...scanValues
            })
            .returning();
      if (!scan) throw new Error('No such scan');

      await tx
        .update(digitalProperties)
        .set({
          lastScannedAt: scannedAt,
          ...(summary.cmp && summary.cmp !== 'Unknown'
            ? { cmp: summary.cmp }
            : {}),
          updatedAt: now
        })
        .where(eq(digitalProperties.id, property.id));

      const outcome = await applyObservations(tx, {
        organisationId: input.organisationId,
        propertyId: property.id,
        scanId: scan.id,
        observed,
        seenAt: scannedAt
      });

      await raiseScanTasks(tx, { property, scan, outcome, actor: input.actor });

      for (const f of failures) {
        await tx
          .insert(scanFindings)
          .values({
            organisationId: input.organisationId,
            entityId: property.entityId,
            evidenceId: ev.id,
            scanRef: summary.runId ?? scan.id,
            url: summary.targetUrl ?? property.url,
            category: 'consent_check',
            severity: SEVERITY[f.result] ?? 'low',
            title: `${property.name} - ${f.itemId}: ${f.description}`,
            detail: [
              f.notes,
              EXEMPTION_MAY_APPLY.has(f.itemId)
                ? "Under UK PECR as amended, statistics cookies may be set without consent if Schedule A1 para 5's conditions are met. Check the cookie inventory before treating this as a breach."
                : null
            ]
              .filter(Boolean)
              .join(' '),
            advisory: {
              recommendation: f.recommendation,
              result: f.result,
              check: f.itemId
            },
            externalRef: `consent-analyser:${property.id}:${summary.runId ?? scan.id}:${f.itemId}`
          })
          .onConflictDoNothing();
      }

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: property.entityId,
        action: 'pecr.scan_ingested',
        subjectType: 'digital_property',
        subjectId: property.id,
        after: {
          property: property.reference,
          scanId: scan.id,
          runId: summary.runId,
          source: input.source,
          targetUrl: summary.targetUrl,
          observed: observed.length,
          proposedNew: outcome.proposedNew,
          proposedNotSeen: outcome.proposedNotSeen,
          newlyBeforeConsent: outcome.newlyBeforeConsent,
          failingChecks: failures.length
        }
      });
      return { scan, ...outcome, findings: failures.length };
    });
  });
}

/**
 * What one scan saw, applied to the inventory.
 *
 * Observations on items already there are facts and are updated: when it was
 * last seen, whether before consent or after a refusal, the scanner's
 * category. Anything not on the inventory, or retired from it, becomes a `new`
 * proposal; an item a scan found before and does not find now becomes a
 * `not_seen` one. Items added by hand are never proposed as not seen — a scan
 * may simply not reach them. Nothing is proposed twice while one is pending.
 */
async function applyObservations(
  tx: Tx,
  input: {
    organisationId: string;
    propertyId: string;
    scanId: string;
    observed: ObservedItem[];
    seenAt: Date;
  }
) {
  const [items, pending] = await Promise.all([
    tx
      .select()
      .from(storageItems)
      .where(eq(storageItems.propertyId, input.propertyId)),
    tx
      .select({ key: storageProposals.key, change: storageProposals.change })
      .from(storageProposals)
      .where(
        and(
          eq(storageProposals.propertyId, input.propertyId),
          eq(storageProposals.status, 'pending')
        )
      )
  ]);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const pendingKeys = new Set(pending.map((p) => `${p.change}:${p.key}`));
  const seen = new Set(input.observed.map((o) => o.key));
  let proposedNew = 0;
  let proposedNotSeen = 0;
  let newlyBeforeConsent = 0;

  for (const o of input.observed) {
    const item = byKey.get(o.key);
    if (item) {
      if (
        item.status === 'active' &&
        o.seenBeforeConsent &&
        item.seenBeforeConsent !== true
      )
        newlyBeforeConsent += 1;
      await tx
        .update(storageItems)
        .set({
          lastSeenAt: input.seenAt,
          seenBeforeConsent: o.seenBeforeConsent,
          seenAfterReject: o.seenAfterReject,
          suggestedCategory: o.category ?? item.suggestedCategory,
          expiry: item.expiry ?? o.expiry,
          party: item.party === 'unknown' ? o.party : item.party,
          updatedAt: new Date()
        })
        .where(eq(storageItems.id, item.id));
    }
    if (
      (!item || item.status !== 'active') &&
      !pendingKeys.has(`new:${o.key}`)
    ) {
      await tx.insert(storageProposals).values({
        organisationId: input.organisationId,
        propertyId: input.propertyId,
        scanId: input.scanId,
        change: 'new',
        itemId: item?.id ?? null,
        key: o.key,
        observed: o as unknown as Record<string, unknown>
      });
      proposedNew += 1;
    }
  }

  for (const item of items) {
    if (
      item.status !== 'active' ||
      item.source !== 'scan' ||
      seen.has(item.key)
    )
      continue;
    if (pendingKeys.has(`not_seen:${item.key}`)) continue;
    await tx.insert(storageProposals).values({
      organisationId: input.organisationId,
      propertyId: input.propertyId,
      scanId: input.scanId,
      change: 'not_seen',
      itemId: item.id,
      key: item.key,
      observed: { name: item.name, domain: item.domain, kind: item.kind }
    });
    proposedNotSeen += 1;
  }
  return { proposedNew, proposedNotSeen, newlyBeforeConsent };
}

/**
 * What a scan leaves for a person to do.
 *
 * A scan settles any rescan reminder for the property: the reminder asked for
 * exactly this. And if it found anything the inventory does not reflect — new
 * items, items gone, or an item on the inventory now set before consent —
 * one task says so, keyed on the scan so taking it in again raises nothing.
 */
async function raiseScanTasks(
  tx: Tx,
  input: {
    property: DigitalProperty;
    scan: ConsentScan;
    outcome: {
      proposedNew: number;
      proposedNotSeen: number;
      newlyBeforeConsent: number;
    };
    actor: Actor;
  }
) {
  const { property, scan, outcome } = input;
  await tx
    .update(tasks)
    .set({
      status: 'done',
      completedAt: new Date(),
      completedByLabel: input.actor.actorLabel
    })
    .where(
      and(
        eq(tasks.organisationId, property.organisationId),
        eq(tasks.subjectType, 'digital_property'),
        eq(tasks.subjectId, property.id),
        eq(tasks.type, 'pecr_rescan'),
        inArray(tasks.status, ['open', 'in_progress'])
      )
    );

  const found = [
    outcome.newlyBeforeConsent &&
      `${outcome.newlyBeforeConsent} now set before consent`,
    outcome.proposedNew && `${outcome.proposedNew} new`,
    outcome.proposedNotSeen && `${outcome.proposedNotSeen} no longer seen`
  ].filter(Boolean);
  if (found.length === 0) return;
  await raiseTask(tx, {
    organisationId: property.organisationId,
    entityId: property.entityId,
    type: 'pecr_scan_changes',
    title: `${property.reference}: cookie scan found changes (${found.join(', ')})`,
    description:
      'Accept or reject what the scan proposed, and give anything new a basis. ' +
      (outcome.newlyBeforeConsent
        ? 'Items set before consent need a basis that allows it - strictly necessary, statistics or appearance with its conditions met - or they must wait for consent.'
        : ''),
    subjectType: 'digital_property',
    subjectId: property.id,
    ...(property.ownerId
      ? { assigneeUserId: property.ownerId }
      : { assigneeRole: 'privacy_admin' as const }),
    idempotencyKey: `pecr-scan-changes:${scan.id}`,
    actor: input.actor
  });
}

/**
 * Properties whose next scan is due within the lead time, or overdue, for the
 * sweep to remind somebody about.
 */
export async function propertiesDueForRescan(
  organisationId: string,
  now = new Date()
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        property: digitalProperties,
        dataProtectionLaw: entities.dataProtectionLaw,
        ieEprivacy: entities.ieEprivacy
      })
      .from(digitalProperties)
      .innerJoin(entities, eq(entities.id, digitalProperties.entityId))
      .where(
        and(
          eq(digitalProperties.organisationId, organisationId),
          isNotNull(digitalProperties.rescanIntervalMonths)
        )
      );
    // A site whose entity is under neither ePrivacy law is not asked for.
    return rows.flatMap(({ property, dataProtectionLaw, ieEprivacy }) => {
      if (
        !recordEprivacy(
          { dataProtectionLaw, ieEprivacy },
          property.eprivacyScope
        )
      )
        return [];
      const dueAt = rescanDueAt(property);
      const state = rescanState(dueAt, now);
      return dueAt && state !== 'not_due' ? [{ property, dueAt, state }] : [];
    });
  });
}

/**
 * Accept or reject what a scan proposed.
 *
 * Accepting a new item puts it on the inventory with no basis — that is a
 * separate decision. Accepting a `not_seen` one marks it as not seen. Rejecting
 * either needs a reason: a scanner's noise, a cookie only set behind a login.
 */
export async function decideProposal(input: {
  proposalId: string;
  organisationId: string;
  accept: boolean;
  note?: string | null;
  actor: Actor;
}) {
  const note = trimmed(input.note);
  if (!input.accept && !note)
    throw new InventoryRefused('Say why it is being rejected.');

  return withOrganisation(input.organisationId, async () => {
    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(storageProposals)
        .where(
          and(
            eq(storageProposals.id, input.proposalId),
            eq(storageProposals.organisationId, input.organisationId)
          )
        )
        .for('update');
      if (!proposal) throw new Error('No such proposal');
      if (proposal.status !== 'pending')
        throw new InventoryRefused('That has already been decided.');
      const property = await lockedProperty(
        tx,
        proposal.propertyId,
        input.organisationId
      );

      let itemId = proposal.itemId;
      if (input.accept && proposal.change === 'new') {
        const o = proposal.observed as unknown as ObservedItem;
        if (itemId) {
          await tx
            .update(storageItems)
            .set({
              status: 'active',
              lastSeenAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(storageItems.id, itemId));
        } else {
          const [row] = await tx
            .insert(storageItems)
            .values({
              organisationId: input.organisationId,
              propertyId: property.id,
              key: proposal.key,
              name: o.name,
              kind: o.kind,
              domain: o.domain,
              party: o.party,
              expiry: o.expiry,
              suggestedCategory: o.category,
              seenBeforeConsent: o.seenBeforeConsent,
              seenAfterReject: o.seenAfterReject,
              firstSeenAt: proposal.createdAt,
              lastSeenAt: proposal.createdAt,
              source: 'scan'
            })
            .onConflictDoUpdate({
              target: [storageItems.propertyId, storageItems.key],
              set: { status: 'active', updatedAt: new Date() }
            })
            .returning();
          itemId = row.id;
        }
      } else if (input.accept && proposal.change === 'not_seen' && itemId) {
        await tx
          .update(storageItems)
          .set({ status: 'not_seen', updatedAt: new Date() })
          .where(eq(storageItems.id, itemId));
      }

      await tx
        .update(storageProposals)
        .set({
          status: input.accept ? 'accepted' : 'rejected',
          itemId,
          note,
          decidedBy: input.actor.actorUserId,
          decidedByLabel: input.actor.actorLabel,
          decidedAt: new Date()
        })
        .where(eq(storageProposals.id, proposal.id));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: property.entityId,
        action: input.accept
          ? 'pecr.proposal_accepted'
          : 'pecr.proposal_rejected',
        subjectType: 'digital_property',
        subjectId: property.id,
        after: {
          property: property.reference,
          change: proposal.change,
          key: proposal.key,
          itemId,
          note
        }
      });
      return { itemId };
    });
  });
}

export type LoadedItem = StorageItem & {
  /** The current basis under UK PECR. */
  decision: (StorageDecision & { decidedByEmail: string | null }) | null;
  /** The current basis under the Irish ePrivacy Regulations. */
  irishDecision: (StorageDecision & { decidedByEmail: string | null }) | null;
  history: Array<StorageDecision & { decidedByEmail: string | null }>;
  supplierName: string | null;
  gaps: string[];
  /** The same gaps with their kinds, for counting. */
  gapList: Gap[];
};

async function itemsWithDecisions(propertyIds: string[]) {
  if (propertyIds.length === 0)
    return {
      items: [] as StorageItem[],
      decisions: new Map<
        string,
        Array<StorageDecision & { decidedByEmail: string | null }>
      >()
    };
  const items = await db
    .select()
    .from(storageItems)
    .where(inArray(storageItems.propertyId, propertyIds))
    .orderBy(asc(storageItems.name));
  const rows = items.length
    ? await db
        .select({ decision: storageDecisions, decidedByEmail: users.email })
        .from(storageDecisions)
        .leftJoin(users, eq(users.id, storageDecisions.decidedBy))
        .where(
          inArray(
            storageDecisions.itemId,
            items.map((i) => i.id)
          )
        )
        .orderBy(desc(storageDecisions.decidedAt))
    : [];
  const decisions = new Map<
    string,
    Array<StorageDecision & { decidedByEmail: string | null }>
  >();
  for (const r of rows) {
    decisions.set(r.decision.itemId, [
      ...(decisions.get(r.decision.itemId) ?? []),
      { ...r.decision, decidedByEmail: r.decidedByEmail }
    ]);
  }
  return { items, decisions };
}

/** What an item is judged under: the laws its property answers to, and the organisation's lifespan threshold. */
type Judged = {
  /** Null where no ePrivacy law reaches the property; it is then read as PECR, as before. */
  scope: EprivacyScope | null;
  lifespanThresholdMonths: number;
};

function assembleItem(
  item: StorageItem,
  history: Array<StorageDecision & { decidedByEmail: string | null }>,
  property: DigitalProperty,
  supplierName: string | null,
  judged: Judged
): LoadedItem {
  const decision = history.find((d) => d.law === 'uk') ?? null;
  const irishDecision = history.find((d) => d.law === 'ie') ?? null;
  const scope = judged.scope ?? 'uk';
  const both = scope === 'uk_ie';
  const labelled = (law: string, gaps: Gap[]) =>
    both ? gaps.map((g) => ({ ...g, text: `${law}: ${g.text}` })) : gaps;
  const gapList =
    item.status === 'active'
      ? [
          ...(scope === 'ie'
            ? []
            : labelled(
                'PECR',
                gapsOf({
                  item,
                  decision: decision
                    ? { basis: decision.basis, conditions: decision.conditions }
                    : null,
                  property
                })
              )),
          ...(scope === 'uk'
            ? []
            : labelled(
                'Irish Regulations',
                irishGapsOf({
                  item,
                  decision: irishDecision
                    ? {
                        basis: irishDecision.basis,
                        conditions: irishDecision.conditions
                      }
                    : null,
                  property,
                  lifespanThresholdMonths: judged.lifespanThresholdMonths
                })
              ))
        ]
      : [];
  return {
    ...item,
    decision,
    irishDecision,
    history,
    supplierName,
    gaps: gapList.map((g) => g.text),
    gapList
  };
}

/**
 * Set how long a strictly necessary item may last under the Irish Regulations
 * before it is flagged (decision 11). Anything other than the default needs a
 * specific justification, kept and audited with the change.
 */
export async function setCookieLifespanThreshold(input: {
  organisationId: string;
  months: number;
  justification: string | null;
  actor: Actor;
}) {
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120)
    throw new InventoryRefused('Give a whole number of months, from 1 to 120.');
  const justification = trimmed(input.justification);
  if (input.months !== DEFAULT_LIFESPAN_THRESHOLD_MONTHS && !justification)
    throw new InventoryRefused(
      `Say specifically why ${input.months} months suits this organisation's cookies better than the default of ${DEFAULT_LIFESPAN_THRESHOLD_MONTHS}.`
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          months: organisations.cookieLifespanThresholdMonths,
          justification: organisations.cookieLifespanJustification
        })
        .from(organisations)
        .where(eq(organisations.id, input.organisationId))
        .for('update');
      const kept =
        input.months === DEFAULT_LIFESPAN_THRESHOLD_MONTHS
          ? null
          : justification;
      await tx
        .update(organisations)
        .set({
          cookieLifespanThresholdMonths: input.months,
          cookieLifespanJustification: kept,
          updatedAt: new Date()
        })
        .where(eq(organisations.id, input.organisationId));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'pecr.lifespan_threshold_changed',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before,
        after: { months: input.months, justification: kept }
      });
    })
  );
}

/** The threshold and its justification, for the settings form. */
export async function cookieLifespanSetting(organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const [org] = await db
      .select({
        months: organisations.cookieLifespanThresholdMonths,
        justification: organisations.cookieLifespanJustification
      })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    return (
      org ?? { months: DEFAULT_LIFESPAN_THRESHOLD_MONTHS, justification: null }
    );
  });
}

/** The organisation's threshold for a strictly necessary item's lifespan under the Irish Regulations. */
async function lifespanThreshold(organisationId: string): Promise<number> {
  const [org] = await db
    .select({ months: organisations.cookieLifespanThresholdMonths })
    .from(organisations)
    .where(eq(organisations.id, organisationId));
  return org?.months ?? DEFAULT_LIFESPAN_THRESHOLD_MONTHS;
}

export async function loadProperty(propertyId: string, organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select({
        property: digitalProperties,
        entityName: entities.name,
        entityLaw: entities.dataProtectionLaw,
        entityIeEprivacy: entities.ieEprivacy,
        ownerEmail: users.email
      })
      .from(digitalProperties)
      .innerJoin(entities, eq(entities.id, digitalProperties.entityId))
      .leftJoin(users, eq(users.id, digitalProperties.ownerId))
      .where(
        and(
          eq(digitalProperties.id, propertyId),
          eq(digitalProperties.organisationId, organisationId)
        )
      );
    if (!row) return null;
    const [{ items, decisions }, scans, proposals, supplierNames] =
      await Promise.all([
        itemsWithDecisions([propertyId]),
        db
          .select()
          .from(consentScans)
          .where(eq(consentScans.propertyId, propertyId))
          .orderBy(desc(consentScans.startedAt)),
        db
          .select()
          .from(storageProposals)
          .where(
            and(
              eq(storageProposals.propertyId, propertyId),
              eq(storageProposals.status, 'pending')
            )
          )
          .orderBy(asc(storageProposals.change), asc(storageProposals.key)),
        db.execute<{ id: string; name: string }>(
          sql`select id, name from supplier where organisation_id = ${organisationId}`
        )
      ]);
    // A scan taken in before its checks were counted is summarised again from
    // the report kept as evidence, so the latest one reads like any other.
    const latest = scans.find((s) => s.status === 'done');
    if (latest?.evidenceId && !('checks' in latest.summary)) {
      const [ev] = await db
        .select({ payload: evidence.payload })
        .from(evidence)
        .where(eq(evidence.id, latest.evidenceId));
      const valid = ev ? validateReport(ev.payload) : null;
      if (valid?.ok)
        latest.summary = { ...latest.summary, ...reportSummary(valid.report) };
    }
    const supplierName = new Map(supplierNames.map((s) => [s.id, s.name]));
    const scope = recordEprivacy(
      { dataProtectionLaw: row.entityLaw, ieEprivacy: row.entityIeEprivacy },
      row.property.eprivacyScope
    );
    const judged = {
      scope,
      lifespanThresholdMonths: await lifespanThreshold(organisationId)
    };
    const loaded = items.map((i) =>
      assembleItem(
        i,
        decisions.get(i.id) ?? [],
        row.property,
        i.supplierId ? (supplierName.get(i.supplierId) ?? null) : null,
        judged
      )
    );
    const irish = scope === 'ie' || scope === 'uk_ie';
    return {
      ...row,
      /** The ePrivacy laws its entity is under, so the page knows whether to ask. */
      entityEprivacy: entityEprivacy({
        name: row.entityName,
        dataProtectionLaw: row.entityLaw,
        ieEprivacy: row.entityIeEprivacy
      }),
      /** The laws this website or app is judged under. */
      scope,
      lifespanThresholdMonths: judged.lifespanThresholdMonths,
      /** What the website or app as a whole does not yet show under the Irish Regulations. */
      irishPropertyGaps: irish
        ? irishPropertyGaps({
            consentRenewalMonths: row.property.consentRenewalMonths,
            consentRenewalJustification:
              row.property.consentRenewalJustification,
            bannerChecks: row.property.bannerChecks,
            linkedToRopa: Boolean(row.property.processingActivityId),
            usesConsent: loaded.some(
              (i) =>
                i.status === 'active' && i.irishDecision?.basis === 'consent'
            )
          })
        : [],
      items: loaded,
      gapSummary: summariseGaps(loaded.map((i) => i.gapList)),
      rescanDueAt: rescanDueAt(row.property),
      scans,
      proposals,
      suppliers: supplierNames.map((s) => ({ id: s.id, name: s.name }))
    };
  });
}

export async function propertyRegister(
  organisationId: string,
  entityIds: string[] | null
) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        property: digitalProperties,
        entityName: entities.name,
        dataProtectionLaw: entities.dataProtectionLaw,
        ieEprivacy: entities.ieEprivacy
      })
      .from(digitalProperties)
      .innerJoin(entities, eq(entities.id, digitalProperties.entityId))
      .where(
        entityIds === null
          ? eq(digitalProperties.organisationId, organisationId)
          : and(
              eq(digitalProperties.organisationId, organisationId),
              inArray(digitalProperties.entityId, entityIds)
            )
      )
      .orderBy(asc(digitalProperties.name));
    const ids = rows.map((r) => r.property.id);
    const [{ items, decisions }, pending] = await Promise.all([
      itemsWithDecisions(ids),
      ids.length
        ? db
            .select({
              propertyId: storageProposals.propertyId,
              n: sql<number>`count(*)::int`
            })
            .from(storageProposals)
            .where(
              and(
                inArray(storageProposals.propertyId, ids),
                eq(storageProposals.status, 'pending')
              )
            )
            .groupBy(storageProposals.propertyId)
        : []
    ]);
    const pendingBy = new Map(pending.map((p) => [p.propertyId, Number(p.n)]));
    const lifespanThresholdMonths = await lifespanThreshold(organisationId);
    return rows.map(
      ({ property, entityName, dataProtectionLaw, ieEprivacy }) => {
        const eprivacy = recordEprivacy(
          { dataProtectionLaw, ieEprivacy },
          property.eprivacyScope
        );
        const mine = items
          .filter((i) => i.propertyId === property.id)
          .map((i) =>
            assembleItem(i, decisions.get(i.id) ?? [], property, null, {
              scope: eprivacy,
              lifespanThresholdMonths
            })
          );
        const active = mine.filter((i) => i.status === 'active');
        const irish = eprivacy === 'ie' || eprivacy === 'uk_ie';
        return {
          property,
          entityName,
          /** What the website as a whole does not yet show under the Irish Regulations. */
          siteGaps: irish
            ? irishPropertyGaps({
                consentRenewalMonths: property.consentRenewalMonths,
                consentRenewalJustification:
                  property.consentRenewalJustification,
                bannerChecks: property.bannerChecks,
                linkedToRopa: Boolean(property.processingActivityId),
                usesConsent: active.some(
                  (i) => i.irishDecision?.basis === 'consent'
                )
              })
            : [],
          /** The ePrivacy law it is judged under; null where its entity is under neither. */
          eprivacy,
          active: active.length,
          // An item with no basis under any law it answers to.
          noBasis: active.filter(
            (i) =>
              (eprivacy !== 'ie' && !i.decision) || (irish && !i.irishDecision)
          ).length,
          withGaps: active.filter((i) => i.gaps.length > 0).length,
          beforeConsent: active.filter((i) => i.seenBeforeConsent).length,
          pending: pendingBy.get(property.id) ?? 0,
          gapSummary: summariseGaps(active.map((i) => i.gapList)),
          rescanDueAt: rescanDueAt(property)
        };
      }
    );
  });
}

/**
 * The legal entity a property, item or proposal belongs to, so an action can
 * check the person may write there before acting. Null if it is not in this
 * organisation.
 */
export async function inventoryEntity(
  of: { property: string } | { item: string } | { proposal: string },
  organisationId: string
): Promise<string | null> {
  return withOrganisation(organisationId, async () => {
    const base = db
      .select({ entityId: digitalProperties.entityId })
      .from(digitalProperties);
    const [row] =
      'property' in of
        ? await base.where(
            and(
              eq(digitalProperties.id, of.property),
              eq(digitalProperties.organisationId, organisationId)
            )
          )
        : 'item' in of
          ? await base
              .innerJoin(
                storageItems,
                eq(storageItems.propertyId, digitalProperties.id)
              )
              .where(
                and(
                  eq(storageItems.id, of.item),
                  eq(digitalProperties.organisationId, organisationId)
                )
              )
          : await base
              .innerJoin(
                storageProposals,
                eq(storageProposals.propertyId, digitalProperties.id)
              )
              .where(
                and(
                  eq(storageProposals.id, of.proposal),
                  eq(digitalProperties.organisationId, organisationId)
                )
              );
    return row?.entityId ?? null;
  });
}
