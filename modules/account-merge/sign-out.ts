import "server-only";

import { cookies } from "next/headers";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { revokeDatabaseSession, SESSION_COOKIE_NAME } from "@/modules/access/session-store";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import {
  ATTENDEE_PENDING_COOKIE_NAME,
  ATTENDEE_SESSION_COOKIE_NAME,
  revokeAttendeeSession,
} from "@/modules/attendee-accounts/session-store";
import { endActiveActAsOnSignOut } from "@/modules/organizations/staff-act-as";

/**
 * Signing out (#1092), shared by `POST /api/auth/logout` and
 * `POST /api/attendee/sign-out`.
 *
 * With the one-sign-in switch OFF each route ends only its own side, exactly as
 * before (`side` says which route called). With it ON, either route ends BOTH
 * sessions this browser holds: the staff session and the attendee session,
 * and clears both sets of cookies. Only the sessions named by this browser's
 * own cookies are revoked, by token. Nothing is revoked by user or account, so
 * the person's other devices stay signed in.
 *
 * An active act-as is ended first (#442), keyed by the staff session id, which
 * is read before that session is revoked. The switch is read once; a failure
 * to read it counts as off, so a sign-out never widens because of it.
 */
export type SignOutSide = "staff" | "attendee";

function expire(cookieStore: Awaited<ReturnType<typeof cookies>>, name: string) {
  cookieStore.set(name, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Returns false when a session revoke failed. Every step is attempted on its own
 * and all cookies for the sides being ended are expired regardless, so an error
 * on one side never leaves the other signed in; the caller answers 500 afterwards.
 */
export async function signOutThisBrowser(side: SignOutSide): Promise<boolean> {
  let unified = false;
  try {
    unified = await isUnifiedSignInEnabled();
  } catch {
    unified = false;
  }

  const cookieStore = await cookies();
  const endStaff = side === "staff" || unified;
  const endAttendee = side === "attendee" || unified;
  let revokeFailed = false;

  try {
    if (endStaff) {
      try {
        // Resolved before the session is revoked, since act-as is keyed by this session's id.
        const { sessionId } = await getCurrentSession();
        if (sessionId) await endActiveActAsOnSignOut(sessionId);
      } catch (error) {
        logError("Ending act-as at sign-out failed", error);
      }
      try {
        await revokeDatabaseSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
      } catch (error) {
        revokeFailed = true;
        logError("The staff session could not be revoked at sign-out", error);
      }
    }
    if (endAttendee) {
      try {
        await revokeAttendeeSession(cookieStore.get(ATTENDEE_SESSION_COOKIE_NAME)?.value);
      } catch (error) {
        revokeFailed = true;
        logError("The attendee session could not be revoked at sign-out", error);
      }
    }
  } finally {
    if (endStaff) expire(cookieStore, SESSION_COOKIE_NAME);
    if (endAttendee) for (const name of [ATTENDEE_SESSION_COOKIE_NAME, ATTENDEE_PENDING_COOKIE_NAME]) expire(cookieStore, name);
  }
  return !revokeFailed;
}
