import { z } from "zod";

/**
 * The leader directory's rules (#1707), free of server-only imports so tests and client components can use them.
 * The directory shows three things per leader and nothing else: their role, their club, and the contact they chose to
 * share. A leader is listed unless they opt out; the conference switch is off until a system administrator turns it on.
 */

export const LEADER_ROLES = ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const;
export type LeaderRole = (typeof LEADER_ROLES)[number];

export const leaderRoleLabels: Record<LeaderRole, string> = {
  DIRECTOR: "Director",
  DEPUTY: "Deputy director",
  REGISTRAR: "Registrar",
  REPORTER: "Reporter",
};

/** A leader's own choices. No saved row means these defaults. */
export type LeaderDirectoryChoices = { listed: boolean; shareEmail: boolean; sharePhone: boolean };
export const DEFAULT_LEADER_CHOICES: LeaderDirectoryChoices = { listed: true, shareEmail: true, sharePhone: false };

/** The body of `PATCH /api/attendee/leader-directory`: exactly the three choices, nothing else. */
export const leaderChoicesSchema = z.object({
  listed: z.boolean(),
  shareEmail: z.boolean(),
  sharePhone: z.boolean(),
}).strict();

/**
 * Who may see the directory: only while the conference switch is on, and only a club director or deputy on at least one
 * active club, or an Area Coordinator. A registrar or reporter alone does not qualify.
 */
export function canViewLeaderDirectory(input: {
  enabled: boolean;
  directedRoles: ReadonlyArray<string>;
  areaCoordinator: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.areaCoordinator) return true;
  return input.directedRoles.some((role) => role === "DIRECTOR" || role === "DEPUTY");
}

export type LeaderChoicesInput = z.infer<typeof leaderChoicesSchema>;

/** What the database read selects, per active grant. Nothing else is ever loaded. */
export type LeaderGrantRow = {
  role: LeaderRole;
  organization: { id: string; name: string };
  attendeeAccount: {
    displayName: string;
    email: string;
    phone: string | null;
    leaderDirectoryPreference: LeaderDirectoryChoices | null;
  };
};

/** One line in the directory: one leader in one club. */
export type LeaderEntry = {
  name: string;
  clubId: string;
  clubName: string;
  roles: LeaderRole[];
  roleLabel: string;
  email: string | null;
  phone: string | null;
};

export type LeaderFilters = { q: string; role: "" | LeaderRole };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

export function parseLeaderFilters(query: Query): LeaderFilters {
  const role = one(query.role);
  return {
    q: one(query.q).slice(0, 80),
    role: (LEADER_ROLES as readonly string[]).includes(role) ? (role as LeaderRole) : "",
  };
}

/** The filters that are set, by key only: audit rows never carry the search text. */
export function activeLeaderFilterKeys(filters: LeaderFilters): string[] {
  const keys: string[] = [];
  if (filters.q) keys.push("q");
  if (filters.role) keys.push("role");
  return keys;
}

/**
 * Turns grant rows into directory entries: a leader who opted out is dropped (even if the database read let the row
 * through), email and phone appear only when shared (a blank phone is no phone), and a leader with two roles in one
 * club is one entry with both roles. A leader in two clubs is two entries.
 */
export function buildLeaderEntries(rows: ReadonlyArray<LeaderGrantRow>): LeaderEntry[] {
  const entries = new Map<string, LeaderEntry>();
  for (const row of rows) {
    const choices = row.attendeeAccount.leaderDirectoryPreference ?? DEFAULT_LEADER_CHOICES;
    if (!choices.listed) continue;
    const key = `${row.organization.id}\u0000${row.attendeeAccount.email.toLowerCase()}`;
    const existing = entries.get(key);
    if (existing) {
      if (!existing.roles.includes(row.role)) existing.roles.push(row.role);
      continue;
    }
    const phone = row.attendeeAccount.phone?.trim() ?? "";
    entries.set(key, {
      name: row.attendeeAccount.displayName,
      clubId: row.organization.id,
      clubName: row.organization.name,
      roles: [row.role],
      roleLabel: "",
      email: choices.shareEmail ? row.attendeeAccount.email : null,
      phone: choices.sharePhone && phone ? phone : null,
    });
  }
  return [...entries.values()].map((entry) => {
    const roles = [...entry.roles].sort((a, b) => LEADER_ROLES.indexOf(a) - LEADER_ROLES.indexOf(b));
    return { ...entry, roles, roleLabel: roles.map((role) => leaderRoleLabels[role]).join(", ") };
  });
}

/** Name or club contains the search (case-insensitive); the role filter matches any of the leader's roles in that club. */
export function filterLeaderEntries(entries: ReadonlyArray<LeaderEntry>, filters: LeaderFilters): LeaderEntry[] {
  const needle = filters.q.toLowerCase();
  return entries
    .filter((entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.clubName.toLowerCase().includes(needle))
    .filter((entry) => !filters.role || entry.roles.includes(filters.role))
    .sort((a, b) => a.name.localeCompare(b.name) || a.clubName.localeCompare(b.clubName));
}
