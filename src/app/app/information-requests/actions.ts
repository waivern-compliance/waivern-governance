'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable } from '@/lib/edit-result';
import { can, mayConfigureInformationRequests } from '@/lib/rbac';
import { NotPermitted, requireCapability } from '@/lib/session';
import { issueIntakeLink, revokeIntakeLink } from '@/services/dsr-intake';
import {
  decideInformationRequestReview,
  extendInformationRequestReview,
  recordRegulatorEvent,
  requestInformationRequestReview,
  withdrawInformationRequestReview,
  type RegulatorEventKind,
  type ReviewOutcome
} from '@/services/information-request-reviews';
import {
  closeInformationRequest,
  convertToSubjectAccessRequest,
  loadInformationRequest,
  recordClarification,
  recordInformationRequest,
  recordInformationRequestDecision,
  respondToInformationRequest,
  setInformationRequestOutcome,
  updateInformationRequest,
  type ResponseOutcome
} from '@/services/information-requests';

import { setFormOrigins } from '../intake-form-origins';

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
      outcome: text(formData.get('outcome')) as ResponseOutcome,
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
          'foia' | 'eir' | 'foisa' | 'eisr' | '') || null,
      provision: text(formData.get('provision')) || null,
      detail: {
        held: text(formData.get('held')) || undefined,
        applied: text(formData.get('applied')) === 'no' ? false : undefined,
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

export async function setOutcomeAction(
  requestId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const result = await refused(async () => {
    await setInformationRequestOutcome({
      organisationId: active.membership.organisationId,
      requestId,
      outcome: text(formData.get('outcome')) as ResponseOutcome,
      actor: actorOf(active)
    });
  }, 'Saved.');
  revalidate(requestId);
  return result;
}

const REGIMES = ['foia', 'eir', 'foisa', 'eisr'] as const;

export async function requestReviewAction(
  requestId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const requestedAt = when(formData.get('requestedAt'));
  if (!requestedAt)
    return { ok: false, message: 'Give the date the review was asked for.' };
  const late = text(formData.get('late'));
  const result = await refused(async () => {
    await requestInformationRequestReview({
      organisationId: active.membership.organisationId,
      requestId,
      regimes: formData
        .getAll('regimes')
        .map(String)
        .filter((r) => (REGIMES as readonly string[]).includes(r)),
      requestedAt,
      channel: text(formData.get('channel')),
      grounds: text(formData.get('grounds')),
      late:
        late === 'accept' || late === 'decline'
          ? {
              accept: late === 'accept',
              reason: text(formData.get('lateReason'))
            }
          : null,
      reviewerName: text(formData.get('reviewerName')) || null,
      reviewerNotInvolved: formData.get('reviewerNotInvolved') === 'on',
      schoolDaysDeadline: when(formData.get('schoolDaysDeadline')),
      actor: actorOf(active)
    });
  }, 'Recorded.');
  revalidate(requestId);
  return result;
}

export async function extendReviewAction(
  requestId: string,
  reviewId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const result = await refused(async () => {
    await extendInformationRequestReview({
      organisationId: active.membership.organisationId,
      requestId,
      reviewId,
      reason: text(formData.get('reason')),
      actor: actorOf(active)
    });
  }, 'Extended.');
  revalidate(requestId);
  return result;
}

const OUTCOMES: readonly ReviewOutcome[] = ['upheld', 'varied', 'reversed'];

export async function decideReviewAction(
  requestId: string,
  reviewId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const outcome = text(formData.get('outcome')) as ReviewOutcome;
  if (!OUTCOMES.includes(outcome))
    return { ok: false, message: 'Choose what the review came to.' };
  const decidedAt = when(formData.get('decidedAt'));
  if (!decidedAt)
    return { ok: false, message: 'Give the date the review notice was sent.' };
  const released = text(formData.get('informationReleased'));
  const result = await refused(async () => {
    await decideInformationRequestReview({
      organisationId: active.membership.organisationId,
      requestId,
      reviewId,
      outcome,
      decidedAt,
      summary: text(formData.get('summary')),
      informationReleased:
        released === '' ? null : released === 'yes' ? true : false,
      noticeChecked: formData.get('noticeChecked') === 'on',
      lateReason: text(formData.get('lateReason')) || null,
      reviewerName: text(formData.get('reviewerName')) || null,
      reviewerNotInvolved: formData.get('reviewerNotInvolved') === 'on',
      actor: actorOf(active)
    });
  }, 'Recorded.');
  revalidate(requestId);
  return result;
}

export async function withdrawReviewAction(
  requestId: string,
  reviewId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const result = await refused(async () => {
    await withdrawInformationRequestReview({
      organisationId: active.membership.organisationId,
      requestId,
      reviewId,
      note: text(formData.get('note')),
      actor: actorOf(active)
    });
  }, 'Recorded.');
  revalidate(requestId);
  return result;
}

const EVENT_KINDS: readonly RegulatorEventKind[] = [
  'application',
  'enquiry',
  'information_notice',
  'decision_notice',
  'complied',
  'appeal_lodged',
  'appeal_decided',
  'enforcement_notice',
  'closed'
];

export async function recordRegulatorEventAction(
  requestId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { active } = await forRequest(requestId);
  const kind = text(formData.get('kind')) as RegulatorEventKind;
  if (!EVENT_KINDS.includes(kind))
    return { ok: false, message: 'Choose what happened.' };
  const occurredAt = when(formData.get('occurredAt'));
  if (!occurredAt) return { ok: false, message: 'Give the date it happened.' };
  const result = await refused(async () => {
    await recordRegulatorEvent({
      organisationId: active.membership.organisationId,
      requestId,
      kind,
      caseReference: text(formData.get('caseReference')) || null,
      note: text(formData.get('note')),
      occurredAt,
      detail: {
        finding: text(formData.get('finding')) || undefined,
        complyBy: text(formData.get('complyBy')) || undefined,
        appellant: text(formData.get('appellant')) || undefined
      },
      actor: actorOf(active)
    });
  }, 'Recorded.');
  revalidate(requestId);
  return result;
}

export async function issueFoiFormAction(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const active = await requireCapability('foi.handle');
  if (!mayConfigureInformationRequests(active.membership.grants))
    return {
      ok: false,
      message:
        'Only somebody who configures the whole organisation can publish a form.'
    };
  const result = await refused(async () => {
    await issueIntakeLink({
      organisationId: active.membership.organisationId,
      entityId: text(formData.get('entityId')),
      label: text(formData.get('label')),
      kind: 'foi',
      actor: actorOf(active)
    });
  }, 'Created. Copy the address into your freedom of information page.');
  revalidatePath('/app/information-requests');
  return result;
}

export async function revokeFoiFormAction(
  linkId: string,
  _prev: Result
): Promise<Result> {
  const active = await requireCapability('foi.handle');
  if (!mayConfigureInformationRequests(active.membership.grants))
    return {
      ok: false,
      message:
        'Only somebody who configures the whole organisation can withdraw a form.'
    };
  const result = await refused(async () => {
    await revokeIntakeLink({
      linkId,
      organisationId: active.membership.organisationId,
      kind: 'foi',
      actor: actorOf(active)
    });
  }, 'Withdrawn. The address now says the form is not taking requests.');
  revalidatePath('/app/information-requests');
  return result;
}

export async function setFoiFormOriginsAction(
  linkId: string,
  _prev: Result,
  formData: FormData
): Promise<Result> {
  return setFormOrigins('foi', linkId, formData);
}
