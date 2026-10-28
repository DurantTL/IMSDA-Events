import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { clubInviteSignUpUrl } from "@/modules/club-imports/invites";
import { clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";
import type { PeopleScope } from "@/modules/system-admin/people-directory-model";

/**
 * Invites still waiting on the person (#1276), for the People & access list and the person page: club role invites made
 * from People & access, Area Coordinator invites, and (full scope only) staff logins that were invited and have not
 * activated. A Clubs Administrator never sees staff logins. Expired invites are listed as expired: they can still be
 * resent or cancelled.
 */

export type PendingInvite = {
  kind: "staff" | "club" | "area";
  id: string;
  name: string;
  email: string;
  /** What the invite is for, in words. */
  what: string;
  sentAt: string | null;
  expired: boolean;
  /** Family-side invites carry no secret, so staff can pass this link on themselves when email isn't set up. */
  signUpUrl?: string;
};

const LIST_CAP = 50;

export async function listPendingInvites(
  options: { query?: string; emails?: readonly string[]; scope: PeopleScope },
  now = new Date(),
): Promise<{ invites: PendingInvite[]; emailConfigured: boolean }> {
  const emailConfigured = isAccountEmailConfigured();
  const emails = options.emails?.map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (emails && emails.length === 0) return { invites: [], emailConfigured };
  const text = options.query?.trim().slice(0, 120) ?? "";
  const prisma = getPrisma();

  const match = (): { email?: { in: string[] }; OR?: Array<{ email: { contains: string; mode: "insensitive" } } | { name: { contains: string; mode: "insensitive" } }> } => ({
    ...(emails ? { email: { in: emails } } : {}),
    ...(text ? { OR: [{ email: { contains: text, mode: "insensitive" as const } }, { name: { contains: text, mode: "insensitive" as const } }] } : {}),
  });
  const userMatch: Prisma.UserWhereInput = {
    ...(emails ? { email: { in: emails } } : {}),
    ...(text ? { OR: [{ email: { contains: text, mode: "insensitive" } }, { displayName: { contains: text, mode: "insensitive" } }] } : {}),
  };
  const open = { status: { in: ["PENDING", "SENT"] as Array<"PENDING" | "SENT"> } };

  const [clubInvites, areaInvites, staff] = await Promise.all([
    prisma.clubInvite.findMany({
      where: { ...open, source: "PEOPLE", organization: { type: "CLUB" }, ...match() },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
      select: { id: true, email: true, name: true, role: true, sentAt: true, createdAt: true, expiresAt: true, organization: { select: { name: true } } },
    }),
    prisma.areaCoordinatorInvite.findMany({
      where: { ...open, ...match() },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
      select: { id: true, email: true, name: true, sentAt: true, createdAt: true, expiresAt: true },
    }),
    options.scope === "full"
      ? prisma.user.findMany({
        where: { ...userMatch, accountStatus: "PENDING_ACTIVATION", credential: { is: { disabledAt: null } } },
        orderBy: { createdAt: "desc" },
        take: LIST_CAP,
        select: {
          id: true, email: true, displayName: true, createdAt: true,
          resetTokens: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, expiresAt: true, usedAt: true } },
        },
      })
      : [],
  ]);

  const invites: PendingInvite[] = [
    ...clubInvites.map((invite): PendingInvite => ({
      kind: "club",
      id: invite.id,
      name: invite.name,
      email: invite.email,
      what: `${clubDirectorRoleLabels[invite.role]} of ${invite.organization.name}`,
      sentAt: (invite.sentAt ?? invite.createdAt).toISOString(),
      expired: Boolean(invite.expiresAt && invite.expiresAt <= now),
      signUpUrl: clubInviteSignUpUrl(invite.email),
    })),
    ...areaInvites.map((invite): PendingInvite => ({
      kind: "area",
      id: invite.id,
      name: invite.name,
      email: invite.email,
      what: "Area Coordinator",
      sentAt: (invite.sentAt ?? invite.createdAt).toISOString(),
      expired: Boolean(invite.expiresAt && invite.expiresAt <= now),
      signUpUrl: clubInviteSignUpUrl(invite.email),
    })),
    ...staff.map((user): PendingInvite => {
      const token = user.resetTokens[0];
      return {
        kind: "staff",
        id: user.id,
        name: user.displayName,
        email: user.email,
        what: "Staff login, not activated yet",
        sentAt: (token?.createdAt ?? user.createdAt).toISOString(),
        expired: !token || Boolean(token.usedAt) || token.expiresAt <= now,
      };
    }),
  ];
  invites.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "") || a.email.localeCompare(b.email));
  return { invites: invites.slice(0, LIST_CAP), emailConfigured };
}
