import "server-only";

import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

/**
 * Read side of the staff `User` <-> `AttendeeAccount` link (#554, ADR 0013,
 * slice (a)).
 *
 * The link is `User.attendeeAccountId`: nullable, unique, ON DELETE SET NULL.
 * This slice only READS it, and nothing in a user-facing path calls these
 * functions yet. Nothing here links, unlinks, creates or merges anyone (that is
 * a human-approved later slice), and nothing here grants access: a link is not
 * a permission, and event authorization stays in the staff session checks.
 *
 * Only ids come back, never names, emails or credentials.
 */

type LinkClient = Pick<PrismaClient, "user" | "platformSettings">;

export type AccountLink = {
  userId: string;
  attendeeAccountId: string;
};

/** The attendee side linked to a staff user, or null when the user is not linked. */
export async function getAttendeeAccountLinkForUser(
  userId: string,
  client: LinkClient = getPrisma(),
): Promise<AccountLink | null> {
  const row = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, attendeeAccountId: true },
  });
  if (!row?.attendeeAccountId) return null;
  return { userId: row.id, attendeeAccountId: row.attendeeAccountId };
}

/** The staff user linked to an attendee account, or null when no user is linked. */
export async function getAccountLinkForAttendeeAccount(
  attendeeAccountId: string,
  client: LinkClient = getPrisma(),
): Promise<AccountLink | null> {
  // The column is unique, so there is at most one row.
  const row = await client.user.findUnique({
    where: { attendeeAccountId },
    select: { id: true, attendeeAccountId: true },
  });
  if (!row?.attendeeAccountId) return null;
  return { userId: row.id, attendeeAccountId: row.attendeeAccountId };
}

/**
 * The one-sign-in switch (#554). OFF unless the settings row exists and says
 * otherwise; a missing row is "off" and is not created by this read. Slice (a)
 * reads it nowhere that changes behaviour.
 */
export async function isUnifiedSignInEnabled(client: LinkClient = getPrisma()): Promise<boolean> {
  const row = await client.platformSettings.findUnique({
    where: { id: "platform" },
    select: { unifiedSignInEnabled: true },
  });
  return row?.unifiedSignInEnabled === true;
}
