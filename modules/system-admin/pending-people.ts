import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { PeopleScope } from "@/modules/system-admin/people-directory-model";

/**
 * Pending invites for People & access (#1277), read only. Kept in its own small module so it can be swapped for
 * #1282's `listPendingInvites` (which adds Area Coordinator invites) later.
 *
 * Both viewers see open club invites for CLUB-type organizations. Only a system administrator ("full") also sees
 * staff logins that were invited but have not been activated.
 */

export type PendingPerson = {
  key: string;
  name: string;
  email: string;
  /** "Director of Synthetic Club" or "Staff login, not activated yet". */
  what: string;
  /** The person's page, when the person already exists. */
  href: string | null;
};

const ROLE_WORD = { DIRECTOR: "Director", DEPUTY: "Deputy", REGISTRAR: "Registrar", REPORTER: "Reporter" } as const;
const MAX_ROWS = 500;

/** Lapsed invites stay listed (staff may resend from the club page) but are labelled. */
function inviteNote(invite: { status: string; sentAt: Date | null; expiresAt: Date | null }, now: Date): string {
  if (invite.expiresAt && invite.expiresAt <= now) return " (expired)";
  if (invite.status === "PENDING" && !invite.sentAt) return " (not sent yet)";
  return "";
}

function textFilter(text: string) {
  return text ? { contains: text, mode: "insensitive" as const } : undefined;
}

export async function listPendingPeople(scope: PeopleScope, query = "", now = new Date()): Promise<{ rows: PendingPerson[]; capped: boolean }> {
  const prisma = getPrisma();
  const text = query.trim().slice(0, 120);
  const textWhere = text ? { OR: [{ email: textFilter(text) }, { name: textFilter(text) }] } : undefined;
  const staffTextWhere = text ? { OR: [{ email: textFilter(text) }, { displayName: textFilter(text) }] } : undefined;
  const [invites, staff] = await Promise.all([
    prisma.clubInvite.findMany({
      where: {
        status: { in: ["PENDING", "SENT"] },
        cancelledAt: null,
        acceptedAt: null,
        organization: { type: "CLUB", isActive: true },
        ...textWhere,
      },
      orderBy: [{ createdAt: "desc" }],
      take: MAX_ROWS,
      select: { id: true, email: true, name: true, role: true, status: true, sentAt: true, expiresAt: true, organization: { select: { name: true } } },
    }),
    scope === "full"
      ? prisma.user.findMany({
        where: { accountStatus: "PENDING_ACTIVATION", OR: [{ credential: { is: null } }, { credential: { is: { disabledAt: null } } }], ...(staffTextWhere ? { AND: [staffTextWhere] } : {}) },
        orderBy: [{ displayName: "asc" }],
        take: MAX_ROWS,
        select: { id: true, email: true, displayName: true },
      })
      : [],
  ]);
  // The invited address may already belong to a website account: link its page. Ids only.
  const emails = [...new Set(invites.map((invite) => invite.email.toLowerCase()))];
  const accounts = emails.length === 0 ? [] : await prisma.attendeeAccount.findMany({
    where: { OR: emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
    select: { id: true, email: true },
  });
  const accountByEmail = new Map(accounts.map((account) => [account.email.toLowerCase(), account.id]));

  const rows: PendingPerson[] = [
    ...staff.map((user) => ({
      key: `staff-${user.id}`,
      name: user.displayName,
      email: user.email,
      what: "Staff login, not activated yet",
      href: `/admin/people/staff/${user.id}`,
    })),
    ...invites.map((invite) => {
      const accountId = accountByEmail.get(invite.email.toLowerCase());
      return {
        key: `invite-${invite.id}`,
        name: invite.name,
        email: invite.email,
        what: `${ROLE_WORD[invite.role]} of ${invite.organization.name}${inviteNote(invite, now)}`,
        href: accountId ? `/admin/people/account/${accountId}` : null,
      };
    }),
  ];
  const capped = invites.length >= MAX_ROWS || staff.length >= MAX_ROWS;
  rows.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key));
  return { rows, capped };
}
