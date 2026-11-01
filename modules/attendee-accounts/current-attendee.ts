import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getPrisma } from "@/lib/prisma";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getCurrentSession } from "@/modules/access/current-session";
import { hashOpaqueToken } from "@/modules/access/tokens";
import {
  isAttendeeSessionIdle,
  shouldTouchAttendeeSession,
  touchAttendeeSession,
} from "@/modules/attendee-accounts/session-store";
import { attendeeSessionCookie } from "@/modules/security/session-cookies";

/**
 * Resolves the signed-in registrant, and only ever a registrant.
 *
 * The counterpart to `getCurrentSession`, kept apart from it on purpose (ADR
 * 0003). This reads a different cookie and a different table, so it cannot
 * return a staff user and `getCurrentSession` cannot return an attendee — not
 * by convention, but because neither token can reach the other's lookup.
 *
 * `verifiedEmail` is deliberately part of the resolved identity rather than
 * something callers fetch separately. It is the entire claim an account has, so
 * a page that lists registrations should not be able to obtain it by any route
 * that skipped the checks below.
 */

export type AttendeeSession = {
  account: {
    id: string;
    verifiedEmail: string;
    displayName: string;
  } | null;
  via: "attendee" | "staff" | null;
  sessionId: string | null;
};

export type SwitchableAttendeeAccount = {
  id: string;
  verifiedEmail: string;
  displayName: string;
};

const switchableAccountSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  emailVerifiedAt: true,
  disabledAt: true,
} as const;

type SwitchableRow = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
};

function switchableFrom(account: SwitchableRow | null): SwitchableAttendeeAccount | null {
  if (
    !account
    || account.disabledAt
    || account.status !== "ACTIVE"
    || !account.emailVerifiedAt
  ) {
    return null;
  }
  return {
    id: account.id,
    verifiedEmail: account.email,
    displayName: account.displayName,
  };
}

/**
 * A staff identity may switch only to its own attendee account. There is
 * deliberately no account-id input: the caller cannot select or impersonate
 * another attendee.
 *
 * Today that account is the one carrying the same normalized, verified email.
 * When `staffUserId` is given, the one-sign-in switch is on (#554, ADR 0013) and
 * the user is linked (`User.attendeeAccountId`), the LINKED account is the answer
 * instead, and the email match is not consulted: a linked person's attendee side
 * is the link, never a lookalike address. A linked account that is disabled or
 * unverified yields null rather than falling back to the email match. With the
 * switch off, or an unlinked user, the email rule above applies unchanged.
 */
export async function findSwitchableAttendeeAccountForStaff(
  staffEmail: string,
  staffUserId?: string,
): Promise<SwitchableAttendeeAccount | null> {
  const unified = Boolean(staffUserId) && (await isUnifiedSignInEnabled());
  if (unified) {
    const linked = await getPrisma().user.findUnique({
      where: { id: staffUserId },
      select: { attendeeAccount: { select: switchableAccountSelect } },
    });
    if (linked?.attendeeAccount) return switchableFrom(linked.attendeeAccount);
  }
  const account: (SwitchableRow & { linkedUser?: { id: string } | null }) | null =
    await getPrisma().attendeeAccount.findUnique({
      where: { email: staffEmail.trim().toLowerCase() },
      select: unified ? { ...switchableAccountSelect, linkedUser: { select: { id: true } } } : switchableAccountSelect,
    });
  // With the switch on, an account already linked to a DIFFERENT staff user is
  // someone else's attendee side, whatever its email says.
  if (unified && account?.linkedUser && account.linkedUser.id !== staffUserId) {
    return null;
  }
  return switchableFrom(account);
}

async function attendeeAccountForStaff(): Promise<AttendeeSession> {
  const { user } = await getCurrentSession();
  if (!user) return { account: null, via: null, sessionId: null };
  const account = await findSwitchableAttendeeAccountForStaff(user.email, user.id);
  if (!account) return { account: null, via: null, sessionId: null };
  return {
    account,
    via: "staff",
    sessionId: null,
  };
}

export const getCurrentAttendee = cache(async (): Promise<AttendeeSession> => {
  const token = attendeeSessionCookie.read(await cookies());
  if (!token) return attendeeAccountForStaff();

  const tokenHash = hashOpaqueToken(token);
  const session = await getPrisma().attendeeSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      account: {
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          emailVerifiedAt: true,
          disabledAt: true,
        },
      },
    },
  });

  const now = new Date();
  if (
    !session
    || session.revokedAt
    || session.expiresAt <= now
    // The account-level flag, not the credential's. An account that only ever
    // signed in with Google has no credential row, and reading the disable off
    // one would have made such an account impossible to shut off — and, before
    // that, impossible to resolve at all.
    || session.account.disabledAt
    || session.account.status !== "ACTIVE"
    // Belt and braces with `status`, because this is the field the claim rests
    // on: an account that somehow reached ACTIVE without a verification date
    // must reach nothing rather than reach everything at that address.
    || !session.account.emailVerifiedAt
  ) {
    return attendeeAccountForStaff();
  }

  if (isAttendeeSessionIdle(session.lastSeenAt, now)) return attendeeAccountForStaff();

  if (shouldTouchAttendeeSession(session.lastSeenAt, now)) {
    await touchAttendeeSession(tokenHash, session.lastSeenAt, now);
  }

  return {
    account: {
      id: session.account.id,
      verifiedEmail: session.account.email,
      displayName: session.account.displayName,
    },
    via: "attendee",
    sessionId: session.id,
  };
});
