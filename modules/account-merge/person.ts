import "server-only";

import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import {
  getAccountLinkForAttendeeAccount,
  getAttendeeAccountLinkForUser,
  isUnifiedSignInEnabled,
  type AccountLink,
} from "@/modules/account-merge/account-link";
import {
  getCurrentAttendee,
  type AttendeeSession,
} from "@/modules/attendee-accounts/current-attendee";

/**
 * One answer to "who is this person and which sides do they hold" (#554, ADR
 * 0013, slice (b)). New code uses this instead of reading the staff and
 * attendee cookies itself.
 *
 * It resolves, it never elevates:
 *
 * - `staff` is set ONLY from a real, valid staff session (`getCurrentSession`).
 *   An attendee session, however it was obtained (password, Google, email link,
 *   passkey), never produces `staff`, even when the account is linked to a staff
 *   user. The linked user's id is reported as `linkedUserId` for display and
 *   prompts ("finish staff verification"); it is a hint, not an authority, and
 *   nothing may authorize from it.
 * - `attendee` is the attendee side. With a real attendee session it is that
 *   session's account (`via: "attendee"`). With only a staff session it is the
 *   staff user's attendee side (`via: "staff"`), found by the link when the
 *   one-sign-in switch is on and a link exists.
 * - With the switch OFF the result is exactly what the two session readers give
 *   today and the link is not consulted (`link` is null).
 */

type PersonClient = Pick<PrismaClient, "user" | "platformSettings">;

export type PersonStaffSide = AuthenticatedUser;

export type PersonAttendeeSide = {
  id: string;
  verifiedEmail: string;
  displayName: string;
  via: "attendee" | "staff";
};

export type ResolvedPerson = {
  /** `PlatformSettings.unifiedSignInEnabled` at the time of the call. */
  unified: boolean;
  /** The staff user, only from a valid staff session. */
  staff: PersonStaffSide | null;
  /** The attendee side, from the attendee session or (via the staff session) the link. */
  attendee: PersonAttendeeSide | null;
  /** The attendee session id, only when `attendee.via` is "attendee". */
  attendeeSessionId: string | null;
  /** The stored link, when the switch is on and one exists for this person. */
  link: AccountLink | null;
  /** The staff user linked to the attendee account, for display only. Never an authority. */
  linkedUserId: string | null;
  /**
   * False only when a staff session and an attendee session are both present, the
   * staff user is linked, and the attendee session is for a different account.
   */
  consistent: boolean;
};

export type PersonSessions = {
  staff: PersonStaffSide | null;
  attendee: AttendeeSession;
};

/** The resolver on explicit inputs, so it can be tested without cookies. */
export async function resolvePersonFrom(
  sessions: PersonSessions,
  client: PersonClient = getPrisma(),
): Promise<ResolvedPerson> {
  const { staff, attendee } = sessions;
  const attendeeSide: PersonAttendeeSide | null = attendee.account && attendee.via
    ? {
        id: attendee.account.id,
        verifiedEmail: attendee.account.verifiedEmail,
        displayName: attendee.account.displayName,
        via: attendee.via,
      }
    : null;
  const attendeeSessionId = attendeeSide?.via === "attendee" ? attendee.sessionId : null;

  const unified = await isUnifiedSignInEnabled(client);
  if (!unified) {
    return {
      unified: false,
      staff,
      attendee: attendeeSide,
      attendeeSessionId,
      link: null,
      linkedUserId: null,
      consistent: true,
    };
  }

  let link: AccountLink | null = null;
  let linkedUserId: string | null = null;
  if (staff) {
    link = await getAttendeeAccountLinkForUser(staff.id, client);
    linkedUserId = link?.userId ?? null;
  } else if (attendeeSide?.via === "attendee") {
    // Display hint only: the staff side stays null.
    const forAccount = await getAccountLinkForAttendeeAccount(attendeeSide.id, client);
    linkedUserId = forAccount?.userId ?? null;
  }

  const consistent = !(
    staff
    && link
    && attendeeSide?.via === "attendee"
    && link.attendeeAccountId !== attendeeSide.id
  );

  return { unified: true, staff, attendee: attendeeSide, attendeeSessionId, link, linkedUserId, consistent };
}

/** The current request's person, from the staff and attendee session cookies. */
export async function resolvePerson(): Promise<ResolvedPerson> {
  const [{ user }, attendee] = await Promise.all([getCurrentSession(), getCurrentAttendee()]);
  return resolvePersonFrom({ staff: user, attendee });
}
