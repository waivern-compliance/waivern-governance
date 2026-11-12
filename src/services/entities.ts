import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import {
  breaches,
  digitalProperties,
  dsrIntakeLinks,
  entities,
  marketingActivities,
  organisations,
  processingActivities
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  isDataProtectionLaw,
  ukLawApplies,
  type DataProtectionLaw
} from '@/lib/dpa2018/applies';
import { isRegime, type Regime } from '@/lib/dpa2018/part3';
import { cleanDpo, dpoMissing, type Dpo } from '@/lib/dpa2018/public-authority';
import {
  REGIME,
  REGULATOR,
  type FoiAct,
  type TimeProfile
} from '@/lib/foi/statutory';
import {
  cleanEstablishment,
  type Establishment
} from '@/lib/gdpr/establishment';
import { appliesEu, lawsLabel, narrowedTo } from '@/lib/gdpr/regimes';
import { cleanEprivacyScope, entityEprivacy } from '@/lib/ie-eprivacy/scope';

import { recordEntityAgreement, type EntityAgreementInput } from './agreements';
import { forgetFrameOrigins } from './frame-origins';
import type { Actor } from './templates';
import { assertMemberOf, NotInOrganisation } from './tenancy-guards';

/**
 * An organisation's legal entities: adding one, renaming one, and choosing the
 * default.
 *
 * Entities sit inside an organisation; the organisation itself — a separate
 * account — is created only when Waivern approves a request (see
 * `organisation-requests.ts`). Who may call these is for the caller: the
 * Organisation page allows an owner over the whole organisation only.
 *
 * Nothing is removed here. Records, grants and retention profiles point at
 * entities, and an entity that held records is part of their history.
 */

export class EntityRefused extends Error {}

const NAME_LIMIT = 120;
const REF_LIMIT = 60;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new EntityRefused("Give the legal entity's name.");
  if (name.length > NAME_LIMIT)
    throw new EntityRefused('That name is too long.');
  return name;
}

function cleanRef(value: string | null | undefined): string | null {
  const ref = (value ?? '').trim();
  if (!ref) return null;
  if (ref.length > REF_LIMIT)
    throw new EntityRefused('That reference is too long.');
  return ref;
}

/**
 * Ingest and export find an entity by its name or its reference, either one, so
 * no two entities may share either — including one entity's name being
 * another's reference.
 */
async function assertDistinct(
  tx: Tx,
  organisationId: string,
  name: string,
  ref: string | null,
  except?: string
) {
  const others = await tx
    .select({ name: entities.name, ref: entities.legalEntityRef })
    .from(entities)
    .where(
      except
        ? and(
            eq(entities.organisationId, organisationId),
            ne(entities.id, except)
          )
        : eq(entities.organisationId, organisationId)
    );
  const taken = new Set(
    others
      .flatMap((o) => [o.name, o.ref])
      .filter(Boolean)
      .map((v) => v!.toLowerCase())
  );
  if (taken.has(name.toLowerCase())) {
    throw new EntityRefused(
      `Another legal entity is already called or referenced “${name}”.`
    );
  }
  if (ref && taken.has(ref.toLowerCase())) {
    throw new EntityRefused(
      `Another legal entity is already called or referenced “${ref}”.`
    );
  }
}

export async function entitiesOf(organisationId: string) {
  return withOrganisation(organisationId, () =>
    db
      .select()
      .from(entities)
      .where(eq(entities.organisationId, organisationId))
      .orderBy(asc(entities.name))
  );
}

/**
 * Add a legal entity.
 *
 * On Waivern's hosted service a new entity is a new controller, and Waivern may
 * hold none of its records without a Data Processing Agreement, so the owner
 * adding it accepts the terms and the agreement for it in the same transaction:
 * either both are recorded or neither is.
 */
export async function addEntity(input: {
  organisationId: string;
  name: string;
  legalEntityRef?: string | null;
  actor: Actor;
  agreementRequired?: boolean;
  agreement?: EntityAgreementInput & { user: { id: string; email: string } };
}) {
  const name = cleanName(input.name);
  const legalEntityRef = cleanRef(input.legalEntityRef);
  const agreement = input.agreement;
  if (input.agreementRequired && !agreement)
    throw new EntityRefused(
      'Accept the terms and the Data Processing Agreement for the new legal entity.'
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      await assertDistinct(tx, input.organisationId, name, legalEntityRef);
      const [created] = await tx
        .insert(entities)
        .values({ organisationId: input.organisationId, name, legalEntityRef })
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.created',
        subjectType: 'entity',
        subjectId: created.id,
        entityId: created.id,
        after: { name, legalEntityRef }
      });
      if (agreement)
        await recordEntityAgreement(tx, {
          ...agreement,
          organisationId: input.organisationId,
          entity: created,
          actor: input.actor
        });
      return created;
    })
  );
}

async function entityIn(tx: Tx, organisationId: string, entityId: string) {
  const [row] = await tx
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.organisationId, organisationId)
      )
    );
  if (!row)
    throw new NotInOrganisation('No such legal entity in this organisation.');
  return row;
}

/**
 * Change an entity's name or reference. Its records follow it, being linked by
 * id; whatever outside names it — the Portal's ingest, a script — has to be
 * told.
 */
export async function renameEntity(input: {
  organisationId: string;
  entityId: string;
  name: string;
  legalEntityRef?: string | null;
  actor: Actor;
}) {
  const name = cleanName(input.name);
  const legalEntityRef = cleanRef(input.legalEntityRef);
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      if (before.name === name && before.legalEntityRef === legalEntityRef)
        return before;
      await assertDistinct(
        tx,
        input.organisationId,
        name,
        legalEntityRef,
        before.id
      );
      const [after] = await tx
        .update(entities)
        .set({ name, legalEntityRef, updatedAt: new Date() })
        .where(eq(entities.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.renamed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: { name: before.name, legalEntityRef: before.legalEntityRef },
        after: { name, legalEntityRef }
      });
      return after;
    })
  );
}

/** Where a record arrives with no entity named, it lands in the default. There is one. */
export async function makeDefaultEntity(input: {
  organisationId: string;
  entityId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const chosen = await entityIn(tx, input.organisationId, input.entityId);
      if (chosen.isDefault) return chosen;
      const [previous] = await tx
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(
          and(
            eq(entities.organisationId, input.organisationId),
            eq(entities.isDefault, true)
          )
        );
      await tx
        .update(entities)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(entities.organisationId, input.organisationId),
            eq(entities.isDefault, true)
          )
        );
      const [after] = await tx
        .update(entities)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(entities.id, chosen.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.made_default',
        subjectType: 'entity',
        subjectId: chosen.id,
        entityId: chosen.id,
        before: { default: previous?.name ?? null },
        after: { default: chosen.name }
      });
      return after;
    })
  );
}

/**
 * Mark an entity as a provider of a public electronic communications service,
 * or not. Its breaches in providing that service then run the PECR reg 5A
 * clock beside Article 33's.
 */
export async function setPublicCommsProvider(input: {
  organisationId: string;
  entityId: string;
  provider: boolean;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      if (before.publicCommsProvider === input.provider) return before;
      if (input.provider)
        ukLawOnly(before, 'A public communications provider under PECR');
      const [after] = await tx
        .update(entities)
        .set({ publicCommsProvider: input.provider, updatedAt: new Date() })
        .where(eq(entities.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.provider_flag_changed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: { publicCommsProvider: before.publicCommsProvider },
        after: { publicCommsProvider: input.provider }
      });
      return after;
    })
  );
}

/**
 * Whether the entity is subject to the Irish ePrivacy Regulations, S.I. No. 336
 * of 2011. A person's answer, recorded either way: an unanswered entity under
 * EU law is asked on the Organisation page. Allowed only where EU law applies.
 * Turning it off is refused while a website, app or marketing activity is
 * recorded under the Irish Regulations alone, because it would then be under no
 * ePrivacy law at all; one under both keeps PECR.
 */
export async function setIeEprivacy(input: {
  organisationId: string;
  entityId: string;
  applies: boolean;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      if (before.ieEprivacy === input.applies) return before;
      if (input.applies && !appliesEu(before.dataProtectionLaw)) {
        throw new EntityRefused(
          `${before.name} is recorded as subject to UK law only. The Irish ePrivacy Regulations are recorded beside EU law, so record that it is subject to EU law first.`
        );
      }
      if (!input.applies) {
        const irishOnly = [
          ...(await tx
            .select({ reference: digitalProperties.reference })
            .from(digitalProperties)
            .where(
              and(
                eq(digitalProperties.entityId, before.id),
                eq(digitalProperties.eprivacyScope, 'ie')
              )
            )),
          ...(await tx
            .select({ reference: marketingActivities.reference })
            .from(marketingActivities)
            .where(
              and(
                eq(marketingActivities.entityId, before.id),
                eq(marketingActivities.eprivacyScope, 'ie')
              )
            ))
        ];
        if (irishOnly.length > 0) {
          throw new EntityRefused(
            `${irishOnly.map((r) => r.reference).join(', ')} ${irishOnly.length === 1 ? 'is' : 'are'} recorded under the Irish ePrivacy Regulations only. Change ${irishOnly.length === 1 ? 'it' : 'them'} first.`
          );
        }
      }
      const [after] = await tx
        .update(entities)
        .set({ ieEprivacy: input.applies, updatedAt: new Date() })
        .where(eq(entities.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.ie_eprivacy_changed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: { ieEprivacy: before.ieEprivacy },
        after: { ieEprivacy: input.applies }
      });
      return after;
    })
  );
}

/**
 * The scope a website, app or marketing activity of this entity will hold:
 * the one chosen, else the entity's (`cleanEprivacyScope`). Runs inside the
 * caller's organisation scope.
 */
export async function eprivacyScopeFor(
  entityId: string,
  chosen: string | null | undefined
) {
  const [row] = await db
    .select({
      name: entities.name,
      dataProtectionLaw: entities.dataProtectionLaw,
      ieEprivacy: entities.ieEprivacy
    })
    .from(entities)
    .where(eq(entities.id, entityId));
  if (!row) throw new Error('No such entity');
  return cleanEprivacyScope(row, chosen);
}

/**
 * Whether any entity is subject to an ePrivacy law, so the cookie and
 * marketing registers are worth offering. With no entity yet, as when an
 * organisation is first set up, its default will be UK law, so yes.
 */
export async function anyEntityUnderEprivacy(
  organisationId: string
): Promise<boolean> {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        name: entities.name,
        dataProtectionLaw: entities.dataProtectionLaw,
        ieEprivacy: entities.ieEprivacy
      })
      .from(entities)
      .where(eq(entities.organisationId, organisationId));
    return rows.length === 0 || rows.some((r) => entityEprivacy(r) !== null);
  });
}

/** The UK-law settings are refused on an entity subject to EU law only. */
function ukLawOnly(
  entity: { name: string; dataProtectionLaw: DataProtectionLaw },
  what: string
) {
  if (!ukLawApplies(entity.dataProtectionLaw)) {
    throw new Error(
      `${what} is a UK law setting, and ${entity.name} is recorded as subject to EU law only. Change that first.`
    );
  }
}

/**
 * Which data protection law the entity is subject to: UK, EU or both. Where
 * UK law does not apply, the Data Protection Act 2018's questions, decisions
 * and flags are not shown for it. Narrowing to EU only is refused while a UK
 * law setting is on, so the record never says both.
 */
export async function setDataProtectionLaw(input: {
  organisationId: string;
  entityId: string;
  law: DataProtectionLaw;
  actor: Actor;
}) {
  if (!isDataProtectionLaw(input.law))
    throw new EntityRefused('Choose UK law, EU law, or both.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      if (before.dataProtectionLaw === input.law) return before;
      // The establishment record answers for each law; narrowing away from a
      // law it answers for is refused, as for the UK law settings below.
      if (input.law === 'uk' && hasEuEstablishmentFacts(before)) {
        throw new EntityRefused(
          `${before.name} has EU establishment, lead authority, representative or public body details recorded. Clear them first.`
        );
      }
      if (input.law === 'eu' && hasUkEstablishmentFacts(before)) {
        throw new EntityRefused(
          `${before.name} has a UK representative or exemption recorded. Clear that first.`
        );
      }
      // The Irish ePrivacy Regulations are declared only beside EU law.
      if (!appliesEu(input.law) && before.ieEprivacy === true) {
        throw new EntityRefused(
          `${before.name} is marked as subject to the Irish ePrivacy Regulations, which Govern records only beside EU law. Turn that off first.`
        );
      }
      if (!ukLawApplies(input.law)) {
        const on = [
          before.publicAuthority ? 'public authority' : null,
          before.competentAuthority ? 'competent authority' : null,
          before.publicCommsProvider ? 'public communications provider' : null
        ].filter(Boolean);
        if (on.length > 0) {
          throw new EntityRefused(
            `${before.name} is marked as a ${on.join(' and ')}, which only UK law knows. Turn that off first.`
          );
        }
      }
      // Records follow the entity's law down: one under both laws keeps the law
      // that remains. One under the dropped law alone is for a person to
      // decide (move it, or close it), so the change is refused naming it.
      const records = [
        ...(await tx
          .select({
            reference: processingActivities.reference,
            laws: processingActivities.laws
          })
          .from(processingActivities)
          .where(eq(processingActivities.entityId, before.id))),
        ...(await tx
          .select({ reference: breaches.reference, laws: breaches.laws })
          .from(breaches)
          .where(eq(breaches.entityId, before.id)))
      ];
      const stranded = records.filter(
        (r) => narrowedTo(r.laws, input.law) === null
      );
      if (stranded.length > 0) {
        throw new EntityRefused(
          `${stranded.map((r) => r.reference).join(', ')} ${stranded.length === 1 ? 'is' : 'are'} recorded under the ${lawsLabel(stranded[0].laws)} only, which ${before.name} would no longer be subject to. Change the laws on ${stranded.length === 1 ? 'that record' : 'those records'} first (with the entity under both laws while you do).`
        );
      }
      const narrowed = records.filter(
        (r) => narrowedTo(r.laws, input.law) !== r.laws
      );
      if (narrowed.length > 0 && input.law !== 'uk_eu') {
        await tx
          .update(processingActivities)
          .set({ laws: input.law, updatedAt: new Date() })
          .where(
            and(
              eq(processingActivities.entityId, before.id),
              eq(processingActivities.laws, 'uk_eu')
            )
          );
        await tx
          .update(breaches)
          .set({ laws: input.law, updatedAt: new Date() })
          .where(
            and(eq(breaches.entityId, before.id), eq(breaches.laws, 'uk_eu'))
          );
      }
      const [after] = await tx
        .update(entities)
        .set({
          dataProtectionLaw: input.law,
          // Established in the UK means subject to the UK GDPR (Article 3(1)),
          // so EU law only means not established there. Widening back to both
          // then asks for a UK representative until someone says otherwise.
          ...(input.law === 'eu' ? { ukEstablishment: false } : {}),
          updatedAt: new Date()
        })
        .where(eq(entities.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.data_protection_law_changed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: { dataProtectionLaw: before.dataProtectionLaw },
        after: {
          dataProtectionLaw: input.law,
          ...(narrowed.length > 0
            ? { recordsNarrowed: narrowed.map((r) => r.reference) }
            : {})
        }
      });
      return after;
    })
  );
}

function hasEuEstablishmentFacts(e: typeof entities.$inferSelect) {
  return (
    e.euEstablishments.length > 0 ||
    Boolean(e.euMainEstablishment) ||
    Boolean(e.euLeadAuthority) ||
    Boolean(e.euRepresentative) ||
    Boolean(e.euRepresentativeExemption) ||
    e.euPublicBody
  );
}

function hasUkEstablishmentFacts(e: typeof entities.$inferSelect) {
  return Boolean(e.ukRepresentative) || Boolean(e.ukRepresentativeExemption);
}

/** The establishment as `lib/gdpr/establishment.ts` reads it. */
export function establishmentOf(
  e: typeof entities.$inferSelect
): Establishment {
  return {
    ukEstablishment: e.ukEstablishment,
    euEstablishments: e.euEstablishments,
    euMainEstablishment: e.euMainEstablishment,
    euLeadAuthority: e.euLeadAuthority,
    euRepresentative: e.euRepresentative,
    euRepresentativeExemption: e.euRepresentativeExemption,
    ukRepresentative: e.ukRepresentative,
    ukRepresentativeExemption: e.ukRepresentativeExemption,
    euPublicBody: e.euPublicBody
  };
}

/**
 * Where the entity is established, who represents it and which EU authority
 * leads (Articles 3, 27, 56), for the laws it is subject to. Answers about a
 * law it is not subject to are refused. Audited before and after.
 */
export async function setEstablishment(input: {
  organisationId: string;
  entityId: string;
  establishment: Parameters<typeof cleanEstablishment>[1];
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      const cleaned = cleanEstablishment(
        before.dataProtectionLaw,
        input.establishment
      );
      const was = establishmentOf(before);
      if (isDeepStrictEqual(was, cleaned)) return before;
      const [after] = await tx
        .update(entities)
        .set({ ...cleaned, updatedAt: new Date() })
        .where(eq(entities.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.establishment_changed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: was,
        after: cleaned
      });
      return after;
    })
  );
}

/** Whether any entity of the organisation is subject to UK law, for what is offered organisation-wide. */
export async function anyEntityUnderUkLaw(
  organisationId: string
): Promise<boolean> {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({ law: entities.dataProtectionLaw })
      .from(entities)
      .where(eq(entities.organisationId, organisationId));
    return rows.length === 0 || rows.some((r) => ukLawApplies(r.law));
  });
}

/**
 * Mark an entity as a public authority (Data Protection Act 2018 s.7), or not.
 * Its activities then may not rest on legitimate interests or recognised
 * legitimate interests for its tasks, and it must have a data protection
 * officer.
 */
export async function setPublicAuthority(input: {
  organisationId: string;
  entityId: string;
  publicAuthority: boolean;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      if (before.publicAuthority === input.publicAuthority) return before;
      if (!input.publicAuthority && before.foiAct)
        throw new EntityRefused(
          `${before.name} answers requests under the ${REGIME[before.foiAct].label}, which makes it a public authority. Turn freedom of information off first.`
        );
      if (input.publicAuthority)
        ukLawOnly(
          before,
          'A public authority within the Data Protection Act 2018 s.7'
        );
      const [after] = await tx
        .update(entities)
        .set({ publicAuthority: input.publicAuthority, updatedAt: new Date() })
        .where(eq(entities.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.public_authority_changed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: { publicAuthority: before.publicAuthority },
        after: { publicAuthority: input.publicAuthority }
      });
      return after;
    })
  );
}

const FOI_ACTS: readonly FoiAct[] = ['foia', 'foisa'];
const TIME_PROFILES: readonly TimeProfile[] = ['standard', 'school', 'archive'];
const COVERED_FOR_LIMIT = 300;

/**
 * Which freedom of information Act the entity answers requests under, if any,
 * how long it has to respond, and what it is covered for where it is covered
 * only in part.
 *
 * Either Act makes the entity a public authority for the Data Protection Act
 * 2018 s.7 too, so setting one turns that on; turning the Act off leaves it,
 * since a body can be a public authority by regulations without either.
 */
export async function setFreedomOfInformation(input: {
  organisationId: string;
  entityId: string;
  act: FoiAct | null;
  timeProfile: TimeProfile;
  coveredFor?: string | null;
  actor: Actor;
}) {
  if (input.act !== null && !FOI_ACTS.includes(input.act))
    throw new EntityRefused(
      'Choose the Freedom of Information Act 2000, the Scottish Act, or neither.'
    );
  if (!TIME_PROFILES.includes(input.timeProfile))
    throw new EntityRefused(
      'Choose the standard time, a school or an archive.'
    );
  const coveredFor = input.coveredFor?.trim().replace(/\s+/g, ' ') || null;
  if (coveredFor && coveredFor.length > COVERED_FOR_LIMIT)
    throw new EntityRefused(
      `Keep what it is covered for to ${COVERED_FOR_LIMIT} characters.`
    );
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      const act = input.act;
      const timeProfile = act ? input.timeProfile : 'standard';
      const covered = act ? coveredFor : null;
      if (
        before.foiAct === act &&
        before.foiTimeProfile === timeProfile &&
        before.foiCoveredFor === covered
      )
        return before;
      if (act) {
        if (!ukLawApplies(before.dataProtectionLaw))
          throw new EntityRefused(
            `Freedom of information is UK law, and ${before.name} is recorded as subject to EU law only. Change that first.`
          );
      }
      const publicAuthority = act ? true : before.publicAuthority;
      const [after] = await tx
        .update(entities)
        .set({
          foiAct: act,
          foiTimeProfile: timeProfile,
          foiCoveredFor: covered,
          publicAuthority,
          updatedAt: new Date()
        })
        .where(eq(entities.id, before.id))
        .returning();
      // Without an Act there is nothing to ask for under it. Withdraw the
      // entity's freedom of information forms, so their addresses say so and
      // do not quietly reopen if an Act is set again later.
      const withdrawn = act
        ? []
        : await tx
            .update(dsrIntakeLinks)
            .set({
              revokedAt: new Date(),
              revokedBy: input.actor.actorUserId ?? null
            })
            .where(
              and(
                eq(dsrIntakeLinks.entityId, before.id),
                eq(dsrIntakeLinks.kind, 'foi'),
                isNull(dsrIntakeLinks.revokedAt)
              )
            )
            .returning({ id: dsrIntakeLinks.id, label: dsrIntakeLinks.label });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.foi_changed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: {
          foiAct: before.foiAct,
          foiTimeProfile: before.foiTimeProfile,
          foiCoveredFor: before.foiCoveredFor,
          publicAuthority: before.publicAuthority
        },
        after: {
          foiAct: act,
          foiTimeProfile: timeProfile,
          foiCoveredFor: covered,
          publicAuthority,
          regulator: act ? REGULATOR[act] : null,
          ...(withdrawn.length > 0
            ? { formsWithdrawn: withdrawn.map((f) => f.id) }
            : {})
        }
      });
      return after;
    })
  ).finally(forgetFrameOrigins);
}

/** Whether any entity of the organisation answers freedom of information requests. */
export async function anyEntityUnderFoi(
  organisationId: string
): Promise<boolean> {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({ act: entities.foiAct })
      .from(entities)
      .where(eq(entities.organisationId, organisationId));
    return rows.some((r) => r.act !== null);
  });
}

/**
 * Whether the entity is a competent authority for some of its functions
 * (s.30, Schedule 7), and the regime its new processing activities start
 * under. Part 3 is available only to a competent authority, so turning the
 * flag off sets the default back to the UK GDPR; records already under Part 3
 * keep their regime and the register flags them.
 */
export async function setCompetentAuthority(input: {
  organisationId: string;
  entityId: string;
  competentAuthority: boolean;
  defaultRegime?: Regime;
  actor: Actor;
}) {
  const defaultRegime: Regime = input.competentAuthority
    ? (input.defaultRegime ?? 'gdpr')
    : 'gdpr';
  if (!isRegime(defaultRegime))
    throw new Error('Choose the regime new records start under.');
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const before = await entityIn(tx, input.organisationId, input.entityId);
      if (
        before.competentAuthority === input.competentAuthority &&
        before.defaultRegime === defaultRegime
      )
        return before;
      if (input.competentAuthority)
        ukLawOnly(
          before,
          'A competent authority under Part 3 of the Data Protection Act 2018'
        );
      const [after] = await tx
        .update(entities)
        .set({
          competentAuthority: input.competentAuthority,
          defaultRegime,
          updatedAt: new Date()
        })
        .where(eq(entities.id, before.id))
        .returning();
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'entity.competent_authority_changed',
        subjectType: 'entity',
        subjectId: before.id,
        entityId: before.id,
        before: {
          competentAuthority: before.competentAuthority,
          defaultRegime: before.defaultRegime
        },
        after: { competentAuthority: input.competentAuthority, defaultRegime }
      });
      return after;
    })
  );
}

/**
 * Record the data protection officer, for the whole organisation or — with an
 * `entityId` — for one entity that has its own. Null clears it. A member named
 * as the DPO must belong to this organisation.
 */
export async function setDpo(input: {
  organisationId: string;
  entityId?: string | null;
  dpo: Parameters<typeof cleanDpo>[0];
  actor: Actor;
}) {
  const dpo = cleanDpo(input.dpo);
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      if (dpo?.userId)
        await assertMemberOf(input.organisationId, dpo.userId, tx);
      if (input.entityId) {
        const before = await entityIn(tx, input.organisationId, input.entityId);
        await tx
          .update(entities)
          .set({ dpo, updatedAt: new Date() })
          .where(eq(entities.id, before.id));
        await appendAuditEvent(tx, {
          ...input.actor,
          organisationId: input.organisationId,
          action: 'entity.dpo_changed',
          subjectType: 'entity',
          subjectId: before.id,
          entityId: before.id,
          before: { dpo: before.dpo },
          after: { dpo }
        });
        return dpo;
      }
      const [before] = await tx
        .select()
        .from(organisations)
        .where(eq(organisations.id, input.organisationId));
      await tx
        .update(organisations)
        .set({ dpo })
        .where(eq(organisations.id, input.organisationId));
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'organisation.dpo_changed',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: { dpo: before?.dpo ?? null },
        after: { dpo }
      });
      return dpo;
    })
  );
}

/**
 * The organisation's DPO, each entity's effective one, and the public
 * authorities with none — which Article 37(1)(a) does not allow.
 */
export async function dpoPosition(organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const [org] = await db
      .select({ dpo: organisations.dpo })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    const rows = await db
      .select()
      .from(entities)
      .where(eq(entities.organisationId, organisationId))
      .orderBy(asc(entities.name));
    const organisationDpo: Dpo | null = org?.dpo ?? null;
    return {
      organisationDpo,
      entities: rows.map((e) => ({
        id: e.id,
        name: e.name,
        publicAuthority: e.publicAuthority || e.euPublicBody,
        competentAuthority: e.competentAuthority,
        ownDpo: e.dpo ?? null,
        effectiveDpo: e.dpo ?? organisationDpo,
        missing: dpoMissing(
          {
            // Article 37(1)(a) binds a public body under either law.
            publicAuthority: e.publicAuthority || e.euPublicBody,
            competentAuthority: e.competentAuthority,
            dpo: e.dpo ?? null
          },
          organisationDpo
        )
      }))
    };
  });
}
