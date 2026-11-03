"use client";

import { useRefusableAction } from "@/lib/use-refusable-action";
import { setEmailNotificationsAction, type ProfileResult } from "./actions";

/**
 * The opt-in. Off unless the person turns it on; greyed out for good where the
 * deployment cannot send it (the shared hosted service).
 */
export function EmailNotificationsForm({ on, disabled }: { on: boolean; disabled: boolean }) {
  const save = useRefusableAction<ProfileResult>(setEmailNotificationsAction, { resetOnSuccess: false });
  return (
    <form {...save.formProps} className="space-y-3">
      <label className={`flex items-start gap-3 text-sm ${disabled ? "cursor-not-allowed text-ink-soft opacity-60" : ""}`}>
        <input
          type="checkbox"
          name="emailNotifications"
          defaultChecked={on}
          disabled={disabled}
          aria-describedby="email-notifications-help"
          className="mt-0.5 accent-brand disabled:cursor-not-allowed"
        />
        <span>Email me alerts and actions</span>
      </label>
      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={save.pending}
            className="rounded border border-line bg-surface px-3 py-1.5 text-xs hover:border-brand focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
          >
            {save.pending ? "Saving…" : "Save"}
          </button>
          {save.result ? (
            <p role={save.result.ok ? "status" : "alert"} className={`text-xs ${save.result.ok ? "text-emerald-800" : "text-red-800"}`}>
              {save.result.message}
            </p>
          ) : null}
        </div>
      )}
    </form>
  );
}
