import { revalidatePath } from 'next/cache';

import { refusable, type EditResult } from '@/lib/edit-result';
import {
  mayConfigureInformationRequests,
  mayConfigureRequests
} from '@/lib/rbac';
import { requireCapability } from '@/lib/session';
import {
  setIntakeLinkAppearance,
  setIntakeLinkFrameOrigins,
  type IntakeFormKind
} from '@/services/dsr-intake';

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

/** Set how a public form looks, for either register's action. */
export async function setFormAppearance(
  kind: IntakeFormKind,
  linkId: string,
  formData: FormData
): Promise<EditResult> {
  const who = await configurer(kind);
  if (who.refused) return who.refused;
  const mode = String(formData.get('backgroundMode') ?? '');
  const file = formData.get('logo');
  const upload =
    file instanceof File && file.size > 0
      ? new Uint8Array(await file.arrayBuffer())
      : undefined;
  const result = await refusable(() =>
    setIntakeLinkAppearance({
      linkId,
      organisationId: who.active.membership.organisationId,
      kind,
      showPoweredBy: formData.get('showPoweredBy') === 'on',
      accent: String(formData.get('accent') ?? ''),
      background:
        mode === 'transparent'
          ? 'transparent'
          : mode === 'colour'
            ? String(formData.get('backgroundColour') ?? '')
            : '',
      logo: upload ?? (formData.get('removeLogo') === 'on' ? null : undefined),
      actor: who.actor
    })
  );
  revalidatePath(who.register.path);
  return result?.ok ? { ok: true, message: 'Saved.' } : result;
}
