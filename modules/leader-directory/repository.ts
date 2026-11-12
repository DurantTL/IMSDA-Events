import { conferenceClubWhere } from "@/modules/organizations/area-coordinator-ministries-domain";
import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  DEFAULT_LEADER_CHOICES,
  activeLeaderFilterKeys,
  buildLeaderEntries,
  filterLeaderEntries,
  type LeaderChoicesInput,
  type LeaderDirectoryChoices,
  type LeaderEntry,
  type LeaderFilters,
  type LeaderGrantRow,
} from "@/modules/leader-directory/domain";

const SETTINGS_ID = "platform";

/** The conference switch. Off when the settings row does not exist yet. */
export async function isLeaderDirectoryEnabled(): Promise<boolean> {
  const row = await getPrisma().platformSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { leaderDirectoryEnabled: true },
  });
  return row?.leaderDirectoryEnabled === true;
}

/**
 * What the directory selects, and all it selects: the leader's display name, sign-in email and phone, their own
 * directory choices, the club's id and name, and the role. No address, emergency contact, health or any other field of
 * the account is read.
 */
export const leaderDirectorySelect = {
  role: true,
  organization: { select: { id: true, name: true } },
  attendeeAccount: {
    select: {
      displayName: true,
      email: true,
      phone: true,
      leaderDirectoryPreference: { select: { listed: true, shareEmail: true, sharePhone: true } },
    },
  },
} as const;

/** Every listed leader with an active, unrevoked, in-date grant on an active club. The caller has already checked access. */
export async function readLeaderDirectory(filters: LeaderFilters, now = new Date()): Promise<{ entries: LeaderEntry[]; total: number }> {
  const rows = await getPrisma().clubDirectorGrant.findMany({
    where: {
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      organization: conferenceClubWhere(),
      attendeeAccount: {
        disabledAt: null,
        OR: [{ leaderDirectoryPreference: { is: null } }, { leaderDirectoryPreference: { is: { listed: true } } }],
      },
    },
    select: leaderDirectorySelect,
  });
  const all = buildLeaderEntries(rows as LeaderGrantRow[]);
  return { entries: filterLeaderEntries(all, filters), total: all.length };
}

/** One audit row per view: counts and filter keys only, never a name or the search text. */
export async function recordLeaderDirectoryView(
  view: { filters: LeaderFilters; shown: number; matching: number; total: number; page: number },
  actor: { accountId: string },
) {
  await writeAuditLog({
    action: "LEADER_DIRECTORY_VIEWED",
    entityType: "ClubDirectorGrant",
    summary: "Opened the leader directory.",
    metadata: {
      actorAttendeeAccountId: actor.accountId,
      rowsShown: view.shown,
      rowsMatching: view.matching,
      totalListed: view.total,
      page: view.page,
      filters: activeLeaderFilterKeys(view.filters),
    },
  });
}

/** A leader's own saved choices, or the defaults when they have never saved any. */
export async function getLeaderChoices(attendeeAccountId: string): Promise<LeaderDirectoryChoices> {
  const row = await getPrisma().leaderDirectoryPreference.findUnique({
    where: { attendeeAccountId },
    select: { listed: true, shareEmail: true, sharePhone: true },
  });
  return row ?? DEFAULT_LEADER_CHOICES;
}

/**
 * Saves the caller's own choices (the row is found by the caller's account id and by nothing else) and writes one audit
 * row in the same transaction with the three yes/no values only.
 */
export async function saveLeaderChoices(attendeeAccountId: string, input: LeaderChoicesInput): Promise<LeaderDirectoryChoices> {
  const choices = { listed: input.listed, shareEmail: input.shareEmail, sharePhone: input.sharePhone };
  await getPrisma().$transaction(async (tx) => {
    await tx.leaderDirectoryPreference.upsert({
      where: { attendeeAccountId },
      create: { attendeeAccountId, ...choices },
      update: choices,
    });
    await writeAuditLog({
      action: "LEADER_DIRECTORY_CHOICES_CHANGED",
      entityType: "AttendeeAccount",
      entityId: attendeeAccountId,
      summary: choices.listed ? "Changed what is shared in the leader directory." : "Opted out of the leader directory.",
      metadata: { actorAttendeeAccountId: attendeeAccountId, ...choices },
    }, tx);
  });
  return choices;
}

/** The switch as the admin page shows it. */
export async function getLeaderDirectorySwitch(): Promise<{ enabled: boolean; setAt: string | null }> {
  const row = await getPrisma().platformSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { leaderDirectoryEnabled: true, leaderDirectorySetAt: true },
  });
  return { enabled: row?.leaderDirectoryEnabled === true, setAt: row?.leaderDirectorySetAt?.toISOString() ?? null };
}

/** Turns the directory on or off for the conference. The change and its audit row commit together, with old and new values. */
export async function setLeaderDirectoryEnabled(enabled: boolean, actorUserId: string, now = new Date()): Promise<{ enabled: boolean; setAt: string }> {
  await getPrisma().$transaction(async (tx) => {
    const before = await tx.platformSettings.findUnique({ where: { id: SETTINGS_ID }, select: { leaderDirectoryEnabled: true } });
    await tx.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      update: { leaderDirectoryEnabled: enabled, leaderDirectorySetAt: now, leaderDirectorySetByUserId: actorUserId },
      create: { id: SETTINGS_ID, leaderDirectoryEnabled: enabled, leaderDirectorySetAt: now, leaderDirectorySetByUserId: actorUserId },
    });
    await writeAuditLog({
      actorUserId,
      action: "LEADER_DIRECTORY_SWITCHED",
      entityType: "PlatformSettings",
      entityId: SETTINGS_ID,
      summary: `Turned the leader directory ${enabled ? "on" : "off"}.`,
      metadata: { before: before?.leaderDirectoryEnabled === true, after: enabled },
    }, tx);
  });
  return { enabled, setAt: now.toISOString() };
}
