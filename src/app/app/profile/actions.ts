"use server";

import { revalidatePath } from "next/cache";
import { memberEmailState } from "@/lib/email/member";
import { getActiveSession } from "@/lib/session";
import { setEmailNotifications } from "@/services/member-email";

export type ProfileResult = { ok: boolean; message: string } | null;

/** A person turning their own alert and action emails on or off. */
export async function setEmailNotificationsAction(_prev: ProfileResult, formData: FormData): Promise<ProfileResult> {
  const active = await getActiveSession();
  if (!active) return { ok: false, message: "Sign in to change this." };
  // Greyed out on the shared service, and refused here too, so a form posted
  // by hand cannot record a choice that would never be honoured.
  if (memberEmailState() === "hosted") {
    return { ok: false, message: "Alert and action emails are not available on the free hosted service." };
  }
  const on = formData.get("emailNotifications") === "on";
  await setEmailNotifications(active.userId, on);
  revalidatePath("/app/profile");
  return { ok: true, message: on ? "Alert and action emails are on." : "Alert and action emails are off." };
}
