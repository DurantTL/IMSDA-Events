import "server-only";

import { createHash } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { hashOpaqueToken } from "@/modules/access/tokens";
import { staffSessionCookie } from "@/modules/security/session-cookies";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";

export const STAFF_TIMED_OUT_NOTICE =
  "Your staff sign-in has ended, usually after an hour of inactivity. Sign in again to use staff tools. Your registrations are still signed in.";

/**
 * Whether THIS browser is signed in as an attendee whose account is linked to a
 * staff user while it holds no live staff session (#1092): the one-sign-in
 * person whose staff side idled out (1 hour) while the attendee side (7 days)
 * is still alive.
 *
 * It reads only this browser's own sessions, and the link from the attendee
 * account the session already proves (`User.attendeeAccountId`). It never looks
 * anything up by an email a visitor typed, so it cannot tell anyone whether an
 * address belongs to staff, and an anonymous visitor always gets false. With the
 * switch off, or on any failure, it is false.
 */
export const isStaffSessionTimedOutForLinkedAttendee = cache(async function isStaffSessionTimedOutForLinkedAttendee(): Promise<boolean> {
  try {
    if (!(await isUnifiedSignInEnabled())) return false;
    const staff = await getCurrentSession();
    if (staff.user) return false;
    const attendee = await getCurrentAttendee();
    // `via: "staff"` is derived from a live staff session, so it is excluded: only an attendee session counts.
    if (!attendee.account || attendee.via !== "attendee") return false;
    const linked = await getPrisma().user.findFirst({
      where: { attendeeAccountId: attendee.account.id, accountStatus: "ACTIVE" },
      select: { id: true },
    });
    return Boolean(linked);
  } catch (error) {
    logError("The staff timed-out check failed", error);
    return false;
  }
});

/**
 * An opaque marker for this browser's own ended staff sign-in (#1947), used only to show the "staff sign-in ended"
 * notice once per sign-out. It reads this browser's staff session cookie, finds that session's row and requires it to
 * belong to the staff user linked to the signed-in attendee account. Null unless the #1092 check says the staff side
 * has ended and such a row exists, so a browser that never held a staff session gets none. The marker is a short hash
 * of that session's id: never a token, and it changes with each new staff sign-in. Never throws.
 */
export const staffSignInEndedMarker = cache(async function staffSignInEndedMarker(): Promise<string | null> {
  try {
    if (!(await isStaffSessionTimedOutForLinkedAttendee())) return null;
    const attendee = await getCurrentAttendee();
    if (!attendee.account) return null;
    const token = staffSessionCookie.read(await cookies());
    if (!token) return null;
    const prisma = getPrisma();
    const own = await prisma.userSession.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      select: { id: true, userId: true },
    });
    if (!own) return null;
    const linked = await prisma.user.findFirst({
      where: { attendeeAccountId: attendee.account.id, accountStatus: "ACTIVE" },
      select: { id: true },
    });
    if (!linked || linked.id !== own.userId) return null;
    return staffEndedMarkerFrom(own.id);
  } catch (error) {
    logError("The staff sign-in ended marker failed", error);
    return null;
  }
});

/** The pure part of the marker: a short hash, so no id is readable in the page. */
export function staffEndedMarkerFrom(sessionId: string): string {
  return createHash("sha256").update(`staff-ended:${sessionId}`).digest("hex").slice(0, 16);
}
