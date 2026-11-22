import { EditForm } from '@/components/EditForm';
import { savedKey } from '@/lib/saved-key';

import { setCyberEssentialsAction } from '../../cyber-essentials/actions';

/** Whether the organisation prepares for Cyber Essentials certification. */
export function CyberEssentialsForm({ enabled }: { enabled: boolean }) {
  return (
    <EditForm
      saved={savedKey(enabled)}
      action={setCyberEssentialsAction}
      className="space-y-3 rounded border border-line bg-surface p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Cyber Essentials</h2>
        <p className="max-w-prose text-sm text-ink-soft">
          Prepare for the government-backed Cyber Essentials certification:
          define what each certificate will cover, from the information asset
          register. It is a scheme an organisation chooses, or a contract asks
          for, not a legal duty. Turning it off hides the scopes and keeps them.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
        />
        We prepare for Cyber Essentials
      </label>
      <button
        type="submit"
        className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Save
      </button>
    </EditForm>
  );
}
