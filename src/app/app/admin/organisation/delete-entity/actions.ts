'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable, type EditResult } from '@/lib/edit-result';
import { isPlatformAdmin } from '@/lib/platform';
import { requestOrigin } from '@/lib/request-origin';
import {
  requireCapability,
  requireSession,
  type ActiveSession
} from '@/lib/session';
import {
  confirmEntityErasure,
  erasureForToken,
  requestEntityErasure
} from '@/services/entity-erasure';

/**
 * The person may delete this entity: an owner whose grant reaches it, or one
 * of the deployment's operators acting through their membership. Asked when
 * the link is requested and again when it is used, since a role can be taken
 * away in between.
 */
async function requireDeleter(
  entityId: string,
  organisationId?: string
): Promise<ActiveSession> {
  const active = await requireSession(organisationId);
  if (isPlatformAdmin(active.email)) return active;
  return requireCapability('entity.delete', {
    organisationId: active.membership.organisationId,
    entityId
  });
}

function actorOf(active: ActiveSession) {
  return {
    actorKind: 'user' as const,
    actorUserId: active.userId,
    actorLabel: active.email
  };
}

export async function requestErasureAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const entityId = String(formData.get('entityId') ?? '');
  if (!entityId) return { ok: false, message: 'Choose a legal entity.' };
  if (formData.get('understood') !== 'on')
    return {
      ok: false,
      message:
        'Confirm that you understand this cannot be undone and that it has been agreed.'
    };
  const active = await requireDeleter(entityId);

  let sentTo = '';
  const result = await refusable(async () => {
    ({ sentTo } = await requestEntityErasure({
      organisationId: active.membership.organisationId,
      entityId,
      userId: active.userId,
      actor: actorOf(active),
      origin: await requestOrigin()
    }));
  });
  if (!result?.ok) return result;
  return {
    ok: true,
    message: `We have emailed a link to ${sentTo}, the address we hold for you. Nothing is deleted until you open it, sign in and confirm.`
  };
}

export async function confirmErasureAction(
  token: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const link = await erasureForToken(token);
  if (link.state === 'not_found')
    return { ok: false, message: 'This link is not valid.' };
  const active = await requireDeleter(
    link.erasure.entityId,
    link.erasure.organisationId
  );

  let entityName = '';
  let confirmationSent = false;
  const result = await refusable(async () => {
    ({ entityName, confirmationSent } = await confirmEntityErasure({
      token,
      userId: active.userId,
      typed: String(formData.get('confirm') ?? ''),
      actor: actorOf(active)
    }));
  });
  if (!result?.ok) return result;
  revalidatePath('/app', 'layout');
  redirect(
    `/app/admin/organisation/delete-entity?${new URLSearchParams({ deleted: entityName, ...(confirmationSent ? { emailed: '1' } : {}) })}`
  );
}
