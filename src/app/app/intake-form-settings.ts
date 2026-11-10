import { revalidatePath } from 'next/cache';

import { refusable, type EditResult } from '@/lib/edit-result';
import { LOGO_MAX_BYTES } from '@/lib/form-appearance';
import {
  mayConfigureInformationRequests,
  mayConfigureRequests
} from '@/lib/rbac';
import { requireCapability } from '@/lib/session';
import {
  setIntakeLinkFrameOrigins,
  type IntakeFormKind
} from '@/services/dsr-intake';
import {
  clearFormAppearance,
  setFormAppearance
} from '@/services/form-appearance';

/** What differs between the two registers' public forms. */
const REGISTER = {
  data_protection: {
    capability: 'dsr.handle',
    mayConfigure: mayConfigureRequests,
    path: '/app/requests'
  },
  foi: {
    capability: 'foi.handle',
    mayConfigure: mayConfigureInformationRequests,
    path: '/app/information-requests'
  }
} as const;

/** The session, if it may change this register's forms; a refusal otherwise. */
async function configurer(kind: IntakeFormKind) {
  const register = REGISTER[kind];
  const active = await requireCapability(register.capability);
  if (!register.mayConfigure(active.membership.grants))
    return {
      refused: {
        ok: false,
        message:
          'Only somebody who configures the whole organisation can change a form.'
      }
    } as const;
  return {
    refused: null,
    register,
    active,
    actor: {
      actorKind: 'user' as const,
      actorUserId: active.userId,
      actorLabel: active.email
    }
  };
}

/**
 * Set the websites that may show a public form in a frame, for either
 * register's action. Only somebody who configures the whole organisation may.
 */
export async function setFormOrigins(
  kind: IntakeFormKind,
  linkId: string,
  formData: FormData
): Promise<EditResult> {
  const who = await configurer(kind);
  if (who.refused) return who.refused;
  const result = await refusable(() =>
    setIntakeLinkFrameOrigins({
      linkId,
      organisationId: who.active.membership.organisationId,
      kind,
      origins: String(formData.get('origins') ?? ''),
      actor: who.actor
    })
  );
  revalidatePath(who.register.path);
  return result?.ok
    ? {
        ok: true,
        message:
          'Saved. The form can now be shown on those websites, and no others.'
      }
    : result;
}

/**
 * How a public form looks, from either register: the organisation's
 * appearance (`linkId` null), which every form uses, or one form's own.
 * Checks what it can before reading the upload, so a large file is refused
 * without being read.
 */
export async function setFormAppearanceFrom(
  kind: IntakeFormKind,
  linkId: string | null,
  formData: FormData
): Promise<EditResult> {
  const who = await configurer(kind);
  if (who.refused) return who.refused;
  const organisationId = who.active.membership.organisationId;

  if (linkId && formData.get('inherit') === 'on') {
    const cleared = await refusable(() =>
      clearFormAppearance({ organisationId, linkId, kind, actor: who.actor })
    );
    revalidatePath(who.register.path);
    return cleared?.ok
      ? {
          ok: true,
          message: "Saved. It now uses the organisation's appearance."
        }
      : cleared;
  }

  const mode = String(formData.get('backgroundMode') ?? '');
  const colour = String(formData.get('backgroundColour') ?? '').trim();
  if (mode === 'colour' && !colour)
    return {
      ok: false,
      message: 'Give the background colour as a hex code, such as #ffffff.'
    };
  const file = formData.get('logo');
  const uploading = file instanceof File && file.size > 0;
  const removing = formData.get('removeLogo') === 'on';
  if (uploading && removing)
    return {
      ok: false,
      message:
        'Choose a new logo or remove the current one, not both. Clear the file or untick removing it.'
    };
  if (uploading && file.size > LOGO_MAX_BYTES)
    return {
      ok: false,
      message: `The logo is ${Math.ceil(file.size / 1024)} KB. Keep it to ${LOGO_MAX_BYTES / 1024} KB: a logo on a form needs no more.`
    };
  const logo = uploading
    ? new Uint8Array(await file.arrayBuffer())
    : removing
      ? null
      : undefined;

  const result = await refusable(() =>
    setFormAppearance({
      organisationId,
      linkId,
      kind: linkId ? kind : undefined,
      showPoweredBy: formData.get('showPoweredBy') === 'on',
      accent: String(formData.get('accent') ?? ''),
      background:
        mode === 'transparent'
          ? 'transparent'
          : mode === 'colour'
            ? colour
            : '',
      logo,
      actor: who.actor
    })
  );
  // Both registers show the organisation's appearance.
  revalidatePath('/app/requests');
  revalidatePath('/app/information-requests');
  return result?.ok
    ? {
        ok: true,
        message: linkId
          ? 'Saved, for this form only.'
          : 'Saved. Every form without its own appearance now looks like this.'
      }
    : result;
}
