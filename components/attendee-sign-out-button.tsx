"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { forgetLauncherPosition } from "@/components/more-launcher-model";
import { postAccountSignOut } from "@/modules/attendee-accounts/sign-out-requests";

/**
 * The attendee counterpart of `SignOutButton`. It calls a different endpoint and
 * returns to a different sign-in page, because the two session types are
 * separate all the way down.
 */
export function AttendeeSignOutButton({
  className = "text-button",
  label = "Sign out",
  endStaffSession = false,
  labelClassName,
}: {
  className?: string;
  label?: string;
  /** The browser also has a staff session (#1009): end it too and land on the home page. */
  endStaffSession?: boolean;
  /** Wraps the words in a span with this class (and names the button with aria-label), so a phone header can show the icon alone (#1894). */
  labelClassName?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // A shared tab must not carry a staff member's More position to the next sign-in.
    if (endStaffSession) forgetLauncherPosition();
    try {
      await postAccountSignOut(endStaffSession);
    } finally {
      router.replace(endStaffSession ? "/" : "/account/sign-in");
      router.refresh();
    }
  }

  const text = busy ? "Signing out…" : label;
  return (
    <button aria-label={labelClassName ? text : undefined} className={className} data-sign-out={endStaffSession ? "both" : "attendee"} type="button" onClick={signOut} disabled={busy}>
      <LogOut aria-hidden="true" size={16} /> {labelClassName ? <span className={labelClassName}>{text}</span> : text}
    </button>
  );
}
