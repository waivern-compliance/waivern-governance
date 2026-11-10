import { revalidatePath } from 'next/cache';

import { refusable, type EditResult } from '@/lib/edit-result';
import {
  mayConfigureInformationRequests,
  mayConfigureRequests
} from '@/lib/rbac';
import { requireCapability } from '@/lib/session';
import {
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

/**
 * Set the websites that may show a public form in a frame, for either
 * register's action. Only somebody who configures the whole organisation may.
 */
export async function setFormOrigins(
  kind: IntakeFormKind,
  linkId: string,
  formData: FormData
): Promise<EditResult> {
  const register = REGISTER[kind];
  const active = await requireCapability(register.capability);
  if (!register.mayConfigure(active.membership.grants))
    return {
      ok: false,
      message:
        'Only somebody who configures the whole organisation can change a form.'
    };
  const result = await refusable(() =>
    setIntakeLinkFrameOrigins({
      linkId,
      organisationId: active.membership.organisationId,
      kind,
      origins: String(formData.get('origins') ?? ''),
      actor: {
        actorKind: 'user',
        actorUserId: active.userId,
        actorLabel: active.email
      }
    })
  );
  revalidatePath(register.path);
  return result?.ok
    ? {
        ok: true,
        message:
          'Saved. The form can now be shown on those websites, and no others.'
      }
    : result;
}
