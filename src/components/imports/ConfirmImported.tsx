import { confirmImportedAction } from '@/app/app/admin/imports/actions';
import { RefusableForm } from '@/components/foi/RefusableForm';
import type { Confirmable } from '@/services/imports';

/** The button with which a person confirms an imported record they checked. */
export function ConfirmImported({
  type,
  id,
  revalidate,
  what
}: {
  type: Confirmable;
  id: string;
  /** The page to refresh once confirmed. */
  revalidate: string;
  /** What is being confirmed, for screen readers: "this agreement". */
  what: string;
}) {
  return (
    <RefusableForm
      action={confirmImportedAction.bind(null, type, id, revalidate)}
      submit="I have checked it: confirm it"
      pendingLabel="Confirming…"
      className="space-y-2"
    >
      <span className="sr-only">Confirm {what}</span>
    </RefusableForm>
  );
}
