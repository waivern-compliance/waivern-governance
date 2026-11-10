import { createHash } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  dsrIntakeLinks,
  entities,
  formAppearanceLogos,
  formAppearances
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  AppearanceRefused,
  checkAppearance,
  checkLogo,
  type Background
} from '@/lib/form-appearance';
import { formIsOpen } from '@/lib/intake-forms';

import { RequestRefused } from './data-subject-requests';
import type { Actor } from './templates';

/**
 * How public forms look.
 *
 * The organisation sets one appearance, which every form uses, so a logo is
 * uploaded once and a new or reissued form starts in it. A form can have its
 * own instead, for a group whose entities carry different brands; clearing
 * it puts the form back on the organisation's.
 */

export type Appearance = {
  showPoweredBy: boolean;
  accentColour: string | null;
  background: Background;
  logoSha256: string | null;
};

/** Where a form's appearance comes from. */
export type AppearanceSource = 'form' | 'organisation' | 'standard';

export const STANDARD_APPEARANCE: Appearance = {
  showPoweredBy: true,
  accentColour: null,
  background: null,
  logoSha256: null
};

type Row = typeof formAppearances.$inferSelect;

const appearanceOf = (row: Row): Appearance => ({
  showPoweredBy: row.showPoweredBy,
  accentColour: row.accentColour,
  background: row.background as Background,
  logoSha256: row.logoSha256
});

/** The form's own row, else the organisation's, else the standard look. */
function resolve(rows: readonly Row[], linkId: string) {
  const own = rows.find((r) => r.linkId === linkId);
  const org = rows.find((r) => r.linkId === null);
  const row = own ?? org;
  return {
    row: row ?? null,
    source: (own
      ? 'form'
      : org
        ? 'organisation'
        : 'standard') as AppearanceSource,
    appearance: row ? appearanceOf(row) : STANDARD_APPEARANCE
  };
}

/**
 * A form's appearance, for its public page. Read before any organisation is
 * known, like the page itself: the published address is the authority.
 */
export async function appearanceForLink(
  organisationId: string,
  linkId: string
): Promise<Appearance> {
  const rows = await db
    .select()
    .from(formAppearances)
    .where(
      and(
        eq(formAppearances.organisationId, organisationId),
        or(eq(formAppearances.linkId, linkId), isNull(formAppearances.linkId))
      )
    );
  return resolve(rows, linkId).appearance;
}

/** The organisation's appearance and each form's own, for the registers. */
export async function formAppearancesFor(organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select()
      .from(formAppearances)
      .where(eq(formAppearances.organisationId, organisationId));
    const org = rows.find((r) => r.linkId === null);
    return {
      organisation: org ? appearanceOf(org) : STANDARD_APPEARANCE,
      /** A form's appearance, and whether it is its own or inherited. */
      forLink: (linkId: string) => {
        const { appearance, source } = resolve(rows, linkId);
        return { appearance, source };
      }
    };
  });
}

/**
 * Set the organisation's appearance (`linkId` null) or one form's own.
 * `logo` undefined keeps the current one, null removes it.
 */
export async function setFormAppearance(input: {
  organisationId: string;
  /** Null for the organisation's appearance, which every form uses. */
  linkId: string | null;
  /** For a form: the kind its register may change. */
  kind?: 'data_protection' | 'foi';
  showPoweredBy: boolean;
  accent: string;
  background: string;
  logo?: Uint8Array | null;
  actor: Actor;
}) {
  let checked: ReturnType<typeof checkAppearance>;
  let logoType: string | null = null;
  try {
    checked = checkAppearance(input);
    if (input.logo) logoType = checkLogo(input.logo);
  } catch (error) {
    if (error instanceof AppearanceRefused)
      throw new RequestRefused(error.message);
    throw error;
  }
  const logoSha256 = input.logo
    ? createHash('sha256').update(input.logo).digest('hex')
    : undefined;

  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      let label: string | null = null;
      let entityId: string | null = null;
      if (input.linkId) {
        const [link] = await tx
          .select({
            id: dsrIntakeLinks.id,
            label: dsrIntakeLinks.label,
            entityId: dsrIntakeLinks.entityId
          })
          .from(dsrIntakeLinks)
          .where(
            and(
              eq(dsrIntakeLinks.id, input.linkId),
              eq(dsrIntakeLinks.organisationId, input.organisationId),
              input.kind ? eq(dsrIntakeLinks.kind, input.kind) : undefined,
              isNull(dsrIntakeLinks.revokedAt)
            )
          )
          .for('update');
        if (!link)
          throw new RequestRefused('That form is withdrawn, or is not yours.');
        label = link.label;
        entityId = link.entityId;
      }
      const scope = and(
        eq(formAppearances.organisationId, input.organisationId),
        input.linkId
          ? eq(formAppearances.linkId, input.linkId)
          : isNull(formAppearances.linkId)
      );
      const [before] = await tx
        .select()
        .from(formAppearances)
        .where(scope)
        .for('update');
      // A form's own appearance starts from what it showed, so a new row
      // keeps the logo it inherited unless one is uploaded or removed.
      const inherited =
        !before && input.linkId
          ? (
              await tx
                .select()
                .from(formAppearances)
                .where(
                  and(
                    eq(formAppearances.organisationId, input.organisationId),
                    isNull(formAppearances.linkId)
                  )
                )
            )[0]
          : undefined;
      const values = {
        showPoweredBy: input.showPoweredBy,
        accentColour: checked.accentColour,
        background: checked.background,
        logoSha256:
          input.logo === null
            ? null
            : (logoSha256 ??
              before?.logoSha256 ??
              inherited?.logoSha256 ??
              null),
        updatedAt: new Date()
      };
      const [row] = before
        ? await tx
            .update(formAppearances)
            .set(values)
            .where(eq(formAppearances.id, before.id))
            .returning()
        : await tx
            .insert(formAppearances)
            .values({
              organisationId: input.organisationId,
              linkId: input.linkId,
              ...values
            })
            .returning();

      // The logo bytes follow the hash: a new upload, a removal, or (for a
      // form taking its own appearance) a copy of the one it inherited.
      if (input.logo && logoType)
        await tx
          .insert(formAppearanceLogos)
          .values({
            appearanceId: row.id,
            organisationId: input.organisationId,
            contentType: logoType,
            content: Buffer.from(input.logo)
          })
          .onConflictDoUpdate({
            target: formAppearanceLogos.appearanceId,
            set: { contentType: logoType, content: Buffer.from(input.logo) }
          });
      else if (input.logo === null)
        await tx
          .delete(formAppearanceLogos)
          .where(eq(formAppearanceLogos.appearanceId, row.id));
      else if (!before && inherited?.logoSha256) {
        const [copy] = await tx
          .select()
          .from(formAppearanceLogos)
          .where(eq(formAppearanceLogos.appearanceId, inherited.id));
        if (copy)
          await tx.insert(formAppearanceLogos).values({
            appearanceId: row.id,
            organisationId: input.organisationId,
            contentType: copy.contentType,
            content: copy.content
          });
      }

      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId,
        action: 'intake.appearance_set',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: {
          form: input.linkId,
          ...(before ? appearanceOf(before) : { inherited: true })
        },
        after: { form: input.linkId, label, ...appearanceOf(row) }
      });
      return appearanceOf(row);
    })
  );
}

/** Put a form back on the organisation's appearance, discarding its own. */
export async function clearFormAppearance(input: {
  organisationId: string;
  linkId: string;
  kind: 'data_protection' | 'foi';
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const [link] = await tx
        .select({
          id: dsrIntakeLinks.id,
          label: dsrIntakeLinks.label,
          entityId: dsrIntakeLinks.entityId
        })
        .from(dsrIntakeLinks)
        .where(
          and(
            eq(dsrIntakeLinks.id, input.linkId),
            eq(dsrIntakeLinks.organisationId, input.organisationId),
            eq(dsrIntakeLinks.kind, input.kind)
          )
        );
      if (!link) throw new RequestRefused('That form is not yours.');
      const [removed] = await tx
        .delete(formAppearances)
        .where(
          and(
            eq(formAppearances.organisationId, input.organisationId),
            eq(formAppearances.linkId, link.id)
          )
        )
        .returning();
      if (!removed) return;
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: link.entityId,
        action: 'intake.appearance_cleared',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: { form: link.id, label: link.label, ...appearanceOf(removed) },
        after: { form: link.id, inherited: true }
      });
    })
  );
}

/**
 * The logo an open form shows, for its public address. Read before any
 * organisation is known: the address is the only authority.
 */
export async function formLogo(
  slug: string
): Promise<{ contentType: string; content: Buffer } | null> {
  const [form] = await db
    .select({
      id: dsrIntakeLinks.id,
      organisationId: dsrIntakeLinks.organisationId,
      revokedAt: dsrIntakeLinks.revokedAt,
      kind: dsrIntakeLinks.kind,
      foiAct: entities.foiAct
    })
    .from(dsrIntakeLinks)
    .innerJoin(entities, eq(entities.id, dsrIntakeLinks.entityId))
    .where(eq(dsrIntakeLinks.slug, slug));
  if (!form || !formIsOpen(form)) return null;
  const rows = await db
    .select()
    .from(formAppearances)
    .where(
      and(
        eq(formAppearances.organisationId, form.organisationId),
        or(eq(formAppearances.linkId, form.id), isNull(formAppearances.linkId))
      )
    );
  const { row } = resolve(rows, form.id);
  if (!row?.logoSha256) return null;
  const [logo] = await db
    .select({
      contentType: formAppearanceLogos.contentType,
      content: formAppearanceLogos.content
    })
    .from(formAppearanceLogos)
    .where(eq(formAppearanceLogos.appearanceId, row.id));
  return logo ?? null;
}
