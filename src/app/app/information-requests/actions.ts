'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable } from '@/lib/edit-result';
import { can } from '@/lib/rbac';
import { NotPermitted, requireCapability } from '@/lib/session';
import {
  closeInformationRequest,
  convertToSubjectAccessRequest,
  loadInformationRequest,
  recordClarification,
  recordInformationRequest,
  recordInformationRequestDecision,
  respondToInformationRequest,
  updateInformationRequest
} from '@/services/information-requests';

type Result = { ok: boolean; message: string } | null;

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const when = (v: FormDataEntryValue | null) => {
  const raw = text(v);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

function actorOf(active: { userId: string; email: string }) {
  return {
    actorKind: 'user' as const,
    actorUserId: active.userId,
    actorLabel: active.email
  };
}

/**
 * A refusal from either register, worded for the person, shown beside the
 * form with what they typed kept. Converting a request records a subject
 * access request, whose own refusals come through here too.
 */
async function refused(work: () => Promise<void>, ok: string): Promise<Result> {
  const result = await refusable(work);
  return result?.ok ? { ok: true, message: ok } : result;
}

/**
 * The session, checked against the entity of the request being changed, not
 * only the organisation: a handler scoped to one entity must not reach
 * another's requests by guessing an id.
 */
async function forRequest(requestId: string) {
  const active = await requireCapability('foi.handle');
  const request = await loadInformationRequest(
    requestId,
    active.membership.organisationId
  );
  if (!request) throw new NotPermitted('foi.handle');
  if (!can(active.membership.grants, 'foi.handle', request.entityId))
    throw new NotPermitted('foi.handle', request.entityId);
  return { active, request };
}

function revalidate(requestId: string) {
  revalidatePath('/app/information-requests');
  revalidatePath(`/app/information-requests/${requestId}`);
}

export async function recordInformationRequestAction(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const entityId = text(formData.get('entityId'));
  const receivedAt = when(formData.get('receivedAt'));
  if (!entityId)
    return { ok: false, message: 'Choose the entity the request was made to.' };
  if (!receivedAt)
    return {
      ok: false,
      message: 'When did it arrive? The twenty working days run from then.'
    };
  const active = await requireCapability('foi.handle', { entityId });

  let id: string | null = null;
  const result = await refused(async () => {
    const request = await recordInformationRequest({
      organisationId: active.membership.organisationId,
      entityId,
      kind: (text(formData.get('kind')) || 'general') as
        'general' | 'environmental' | 'both',
      channel: text(formData.get('channel')) || 'email',
      receivedAt,
      description: text(formData.get('description')),
      requesterName: text(formData.get('requesterName')),
      correspondenceAddress:
        text(formData.get('correspondenceAddress')) || null,
      pseudonymous: formData.get('pseudonymous') === 'on',
      preferredMeans: text(formData.get('preferredMeans')) || null,
      ownerId: formData.get('ownMe') === 'on' ? active.userId : null,
      actor: actorOf(active)
    });
    id = request.id;
  }, 'Recorded.');
  if (!id) return result;

  revalidatePath('/app/information-requests');
  redirect(`/app/information-requests/${id}`);
}

export async function updateInformationRequestAction(
  requestId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active, request } = await forRequest(requestId);
  const result = await refused(async () => {
    await updateInformationRequest({
      organisationId: active.membership.organisationId,
      requestId,
      regimes: formData.getAll('regimes').map(String),
      description: text(formData.get('description')),
      correspondenceAddress:
        text(formData.get('correspondenceAddress')) || null,
      pseudonymous: formData.get('pseudonymous') === 'on',
      preferredMeans: text(formData.get('preferredMeans')) || null,
      schoolDaysDeadline:
        request.timeProfile === 'school'
          ? when(formData.get('schoolDaysDeadline'))
          : undefined,
      commissionSetDeadline:
        request.act === 'foia'
          ? when(formData.get('commissionSetDeadline'))
          : undefined,
      actor: actorOf(active)
    });
  }, 'Saved.');
  revalidate(requestId);
  return result;
}

export async function recordClarificationAction(
  requestId: string,
  step: 'sought' | 'received',
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const at = when(formData.get('at'));
  if (!at) return { ok: false, message: 'Give the date.' };
  const result = await refused(
    async () => {
      await recordClarification({
        organisationId: active.membership.organisationId,
        requestId,
        step,
        at,
        actor: actorOf(active)
      });
    },
    step === 'sought'
      ? 'Recorded. The clock waits for their answer.'
      : 'Recorded. The twenty working days start again from this date.'
  );
  revalidate(requestId);
  return result;
}

export async function respondAction(
  requestId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const respondedAt = when(formData.get('respondedAt'));
  if (!respondedAt) return { ok: false, message: 'When was it sent?' };
  const published = text(formData.get('published'));
  const result = await refused(async () => {
    await respondToInformationRequest({
      organisationId: active.membership.organisationId,
      requestId,
      respondedAt,
      summary: text(formData.get('summary')),
      link: text(formData.get('link')) || null,
      lateReason: text(formData.get('lateReason')) || null,
      published: published === '' ? null : published === 'yes',
      refusalNoticeChecked: formData.get('refusalNoticeChecked') === 'on',
      actor: actorOf(active)
    });
  }, 'Response recorded.');
  revalidate(requestId);
  return result;
}

export async function closeAction(
  requestId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const result = await refused(async () => {
    await closeInformationRequest({
      organisationId: active.membership.organisationId,
      requestId,
      rationale: text(formData.get('rationale')),
      actor: actorOf(active)
    });
  }, 'Closed.');
  revalidate(requestId);
  return result;
}

export async function convertAction(
  requestId: string,
  _prev: Result,
  _formData: FormData
): Promise<Result> {
  const { active, request } = await forRequest(requestId);
  // The new request is a data subject request, so the person converting it
  // must be allowed to handle those for this entity too.
  if (!can(active.membership.grants, 'dsr.handle', request.entityId))
    return {
      ok: false,
      message:
        'Converting it creates a subject access request, and you do not handle those for this entity. Ask someone who does.'
    };
  let dsrId: string | null = null;
  const result = await refused(async () => {
    const { dataSubjectRequest } = await convertToSubjectAccessRequest({
      organisationId: active.membership.organisationId,
      requestId,
      actor: actorOf(active)
    });
    dsrId = dataSubjectRequest.id;
  }, 'Converted.');
  if (!dsrId) return result;
  revalidate(requestId);
  revalidatePath('/app/requests');
  redirect(`/app/requests/${dsrId}`);
}

const DECISION_KINDS = [
  'held',
  'neither_confirm_nor_deny',
  'exemption',
  'public_interest_extension',
  'complexity_extension',
  'fees_notice',
  'fee_paid',
  'fee_lapsed',
  'cost_limit',
  'vexatious',
  'repeated',
  'transferred',
  'advice'
] as const;

export async function recordDecisionAction(
  requestId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const kind = text(formData.get('kind'));
  if (!(DECISION_KINDS as readonly string[]).includes(kind))
    return { ok: false, message: 'Choose what is being decided.' };
  const emissions = text(formData.get('emissions'));
  const number = (name: string) => {
    const raw = text(formData.get(name));
    return raw === '' ? undefined : Number(raw);
  };
  const result = await refused(async () => {
    await recordInformationRequestDecision({
      organisationId: active.membership.organisationId,
      requestId,
      kind: kind as (typeof DECISION_KINDS)[number],
      regime:
        (text(formData.get('regime')) as
          | 'foia'
          | 'eir'
          | 'foisa'
          | 'eisr'
          | '') || null,
      provision: text(formData.get('provision')) || null,
      detail: {
        held: text(formData.get('held')) || undefined,
        factorsFor: text(formData.get('factorsFor')) || undefined,
        factorsAgainst: text(formData.get('factorsAgainst')) || undefined,
        emissions:
          emissions === '' ? undefined : emissions === 'yes' ? true : false,
        estimatedDate: text(formData.get('estimatedDate')) || undefined,
        amount: number('amount'),
        estimatedHours: number('estimatedHours'),
        centralGovernment: formData.get('centralGovernment') === 'on',
        aggregated: formData.get('aggregated') === 'on'
      },
      rationale: text(formData.get('rationale')),
      effectiveAt: when(formData.get('effectiveAt')) ?? undefined,
      actor: actorOf(active)
    });
  }, 'Recorded.');
  revalidate(requestId);
  return result;
}
