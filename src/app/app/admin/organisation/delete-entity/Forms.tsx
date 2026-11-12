'use client';

import type { EditResult } from '@/lib/edit-result';
import { useRefusableAction } from '@/lib/use-refusable-action';

import { confirmErasureAction, requestErasureAction } from './actions';

function Outcome({ result }: { result: EditResult }) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? 'status' : 'alert'}
      className={
        result.ok
          ? 'rounded border border-line bg-surface px-3 py-2 text-sm'
          : 'text-sm text-red-800'
      }
    >
      {result.message}
    </p>
  );
}

/** Asks for the link. Nothing is deleted from here. */
export function RequestForm({
  entities
}: {
  entities: Array<{ id: string; name: string; blockedBy: string | null }>;
}) {
  const request = useRefusableAction<EditResult>(requestErasureAction);
  const open = entities.filter((e) => !e.blockedBy);
  return (
    <div className="space-y-3">
      <form
        {...request.formProps}
        className="space-y-4"
      >
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Legal entity to delete</span>
          <select
            name="entityId"
            required
            defaultValue=""
            className="block w-full rounded border border-line bg-white px-2 py-1.5"
          >
            <option
              value=""
              disabled
            >
              Choose an entity
            </option>
            {open.map((e) => (
              <option
                key={e.id}
                value={e.id}
              >
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="understood"
            required
            className="mt-1"
          />
          <span>
            I understand that deleting this legal entity is irrevocable, and the
            relevant stakeholders and decision-makers in my firm understand and
            have agreed to it.
          </span>
        </label>
        <button
          type="submit"
          disabled={request.pending || open.length === 0}
          className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {request.pending
            ? 'Sending…'
            : 'Email me a link to permanently delete this entity'}
        </button>
      </form>
      <Outcome result={request.result} />
    </div>
  );
}

/** The last step: type the words, and it is done. */
export function ConfirmForm({
  token,
  entityName,
  phrase
}: {
  token: string;
  entityName: string;
  phrase: string;
}) {
  const confirm = useRefusableAction<EditResult>(
    confirmErasureAction.bind(null, token),
    { resetOnSuccess: false }
  );
  return (
    <div className="space-y-3">
      <form
        {...confirm.formProps}
        className="space-y-4"
      >
        <label className="block space-y-1 text-sm">
          <span className="font-medium">
            Type <span className="font-mono">{phrase}</span> to confirm
          </span>
          <input
            name="confirm"
            required
            autoComplete="off"
            spellCheck={false}
            className="block w-full rounded border border-line bg-white px-2 py-1.5 font-mono"
          />
        </label>
        <button
          type="submit"
          disabled={confirm.pending}
          className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {confirm.pending
            ? 'Deleting…'
            : `Permanently delete ${entityName} and all its records`}
        </button>
      </form>
      <Outcome result={confirm.result} />
    </div>
  );
}
