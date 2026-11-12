'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable, type EditResult } from '@/lib/edit-result';
import { isPlatformAdmin } from '@/lib/platform';
import { mayDeleteEntity } from '@/lib/rbac';
import { requestOrigin } from '@/lib/request-origin';
import {
  getActiveSession,
  requireCapability,
  requireSession,
  type ActiveSession
} from '@/lib/session';
import {
  confirmEntityErasure,
  openEntityErasure,
  requestEntityErasure,
  type ErasureView
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

/**
 * What the confirmation page shows for the token in its address. The token
 * comes here in the body of a POST, never in a URL a server would log.
 */
export async function openErasureAction(token: string): Promise<ErasureView> {
  return openEntityErasure(token, async (erasure) => {
    const active = await getActiveSession(erasure.organisationId);
    if (!active)
      return 'Sign in as the person who asked for this deletion, then open the link from your email again. Nothing has been deleted.';
    if (active.userId !== erasure.requestedBy)
      return 'This link was sent to somebody else. Only the person who asked can confirm it. Nothing has been deleted.';
    if (
      !mayDeleteEntity(
        active.membership.grants,
        erasure.entityId,
        isPlatformAdmin(active.email)
      )
    )
      return 'You are no longer allowed to delete this legal entity. Nothing has been deleted.';
    return null;
  });
}

export async function confirmErasureAction(
  token: string,
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const me = await requireSession();

  let erasureId = '';
  let confirmationSent = false;
  const result = await refusable(async () => {
    ({ erasureId, confirmationSent } = await confirmEntityErasure({
      token,
      userId: me.userId,
      typed: String(formData.get('confirm') ?? ''),
      actor: actorOf(me),
      authorise: ({ organisationId, entityId }) =>
        requireDeleter(entityId, organisationId)
    }));
  });
  if (!result?.ok) return result;
  revalidatePath('/app', 'layout');
  redirect(
    `/app/admin/organisation/delete-entity?${new URLSearchParams({ deleted: erasureId, ...(confirmationSent ? { emailed: '1' } : {}) })}`
  );
}
