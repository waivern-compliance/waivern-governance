import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Attachments } from '@/components/documents/Attachments';
import { EditForm } from '@/components/EditForm';
import { NotPermitted } from '@/components/NotPermitted';
import { can } from '@/lib/rbac';
import { savedKey } from '@/lib/saved-key';
import { getActiveSession } from '@/lib/session';
import { NOTICE_WORDS } from '@/lib/thirdparty/contracts';
import { contractPeople, loadContract } from '@/services/contracts';
import { documentsFor } from '@/services/documents';

import { inputClass, Label } from '../../requests/fields';
import {
  endContractAction,
  setContractViewersAction,
  updateContractAction
} from '../actions';
import { ContractFields, ViewerFields } from '../ContractFields';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

export default async function ContractPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const org = active.membership.organisationId;
  const loaded = await loadContract(id, org, {
    userId: active.userId,
    grants: active.membership.grants
  });
  if (!loaded) notFound();
  const { contract, supplierName, entityName, ownerEmail, termsVisible } =
    loaded;
  if (!can(active.membership.grants, 'record.read', contract.entityId)) {
    return (
      <NotPermitted
        what={`${contract.reference} belongs to another part of the organisation, and`}
        organisationName={active.membership.organisationName}
      />
    );
  }
  const mayEdit =
    can(active.membership.grants, 'record.write', contract.entityId) &&
    !contract.endedAt;

  const [candidates, files] = await Promise.all([
    contractPeople(org, contract.entityId),
    termsVisible
      ? documentsFor(org, 'supplier_contract', contract.id)
      : Promise.resolve([])
  ]);
  // Those who can open the contract, and the current owner even if they have
  // since left or lost access, so saving the form does not quietly take the
  // contract away from them.
  const members = [
    ...candidates,
    ...(contract.ownerId && !candidates.some((m) => m.id === contract.ownerId)
      ? [
          {
            id: contract.ownerId,
            email: `${ownerEmail ?? 'former member'} (no longer has access)`
          }
        ]
      : [])
  ].sort((a, b) => a.email.localeCompare(b.email));
  const named = new Set(loaded.named.map((n) => n.id));
  // Whoever is already named stays offered, even if they have since left.
  const shareable = [
    ...members.filter((m) => m.id !== contract.createdBy),
    ...loaded.named.filter((n) => !members.some((m) => m.id === n.id))
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/contracts"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Supplier contracts
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-sm text-ink-soft">
            {contract.reference}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {contract.title}
          </h1>
        </div>
        <p className="text-xs text-ink-soft">
          <Link
            href={`/app/third-parties/${contract.supplierId}`}
            className="hover:text-brand"
          >
            {supplierName}
          </Link>{' '}
          · signed by {entityName} · {ownerEmail ?? 'no owner'}
        </p>
        <p
          className={`text-xs ${
            loaded.notice === 'passed' ||
            loaded.notice === 'due_soon' ||
            loaded.notice === 'renewed'
              ? 'text-amber-900'
              : 'text-ink-soft'
          }`}
        >
          {contract.endedAt
            ? `Ended ${day(contract.endedAt)}${contract.endedReason ? `: ${contract.endedReason}` : ''}. It is kept as it was.`
            : `${NOTICE_WORDS[loaded.notice]}${
                loaded.noticeBy && loaded.notice !== 'renewed'
                  ? `: notice by ${day(loaded.noticeBy)}`
                  : ''
              }${contract.autoRenews ? '. Renews automatically.' : '.'}`}
        </p>
      </header>

      {mayEdit ? (
        <EditForm
          key={savedKey(contract)}
          action={updateContractAction.bind(null, contract.id)}
          className="space-y-4 rounded border border-line bg-surface p-5"
        >
          <h2 className="text-sm font-semibold">The contract</h2>
          <ContractFields
            values={contract}
            members={members}
            withTerms={termsVisible}
          />
          <button
            type="submit"
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Save the contract
          </button>
        </EditForm>
      ) : (
        <section className="space-y-2 rounded border border-line bg-surface p-5 text-sm">
          <p>
            <span className="text-ink-soft">Term:</span>{' '}
            {day(contract.startsAt) || 'start not recorded'} to{' '}
            {day(contract.endsAt) || 'no end date'}
            {contract.noticeDays !== null
              ? `, ${contract.noticeDays} days' notice`
              : ''}
          </p>
          {termsVisible ? (
            <p>
              <span className="text-ink-soft">Value:</span>{' '}
              {contract.value
                ? `${contract.currency} ${contract.value}`
                : 'Not recorded'}
            </p>
          ) : null}
        </section>
      )}

      {termsVisible ? null : (
        <p className="rounded border-l-2 border-line px-3 py-2 text-xs text-ink-soft">
          Its value and signed copy are shown only to whoever added it, the
          people they named, and those who may see every contract&rsquo;s terms.
        </p>
      )}

      {termsVisible ? (
        <>
          {loaded.mayShare && mayEdit ? (
            <EditForm
              key={savedKey(loaded.named)}
              action={setContractViewersAction.bind(null, contract.id)}
              className="space-y-3 rounded border border-line bg-surface p-5"
            >
              <ViewerFields
                members={shareable}
                checked={named}
              />
              <button
                type="submit"
                className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand"
              >
                Save who may see the terms
              </button>
            </EditForm>
          ) : (
            <p className="text-xs text-ink-soft">
              Also shown the terms:{' '}
              {loaded.named.map((n) => n.email).join(', ') || 'nobody else'}
            </p>
          )}
          <Attachments
            subjectType="supplier_contract"
            subjectId={contract.id}
            entityId={contract.entityId}
            revalidate={`/app/contracts/${contract.id}`}
            documents={files}
            mayEdit={mayEdit}
            mayUpload={can(
              active.membership.grants,
              'file.upload',
              contract.entityId
            )}
            what="The signed contract"
          />
        </>
      ) : null}

      {mayEdit ? (
        <EditForm
          action={endContractAction.bind(null, contract.id)}
          className="space-y-2 rounded border border-line bg-surface p-5"
        >
          <label className="block space-y-1">
            <Label
              text="End it"
              hint="When it expires, is terminated or is replaced. It is kept, and owes no more reminders."
            />
            <input
              name="reason"
              placeholder="Replaced by CON-2027-0002"
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            className="rounded border border-red-800 px-4 py-2 text-sm text-red-900 hover:bg-red-50"
          >
            End the contract
          </button>
        </EditForm>
      ) : null}
    </main>
  );
}
