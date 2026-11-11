/**
 * The Quick links catalogue for staff Home (#1705): a fixed list of staff pages, each with the same gate the page itself
 * uses, so a person can only pick a page they can already open. Pure, safe to import from client components.
 * Every href was checked against its page under `app/(workspace)`.
 */
import { heldAdminRoles, type AdminRole, type AdminRoles } from "@/modules/access/admin-roles-domain";

export type QuickLinkDefinition = {
  key: string;
  label: string;
  href: string;
  mayUse: (roles: AdminRoles) => boolean;
};

const anyAdmin = (roles: AdminRoles) => heldAdminRoles(roles).length > 0;
/** `hasClubsAdministration`: a Clubs Administrator grant or a system administrator. */
const clubsAdmin = (roles: AdminRoles) => roles.systemAdmin || roles.clubsAdministrator;
const systemAdmin = (roles: AdminRoles) => roles.systemAdmin;
/** The Events Administrator dashboard gate: assigned to at least one event. */
const eventsAdmin = (roles: AdminRoles) => roles.eventAdminEventIds.length > 0;

export const QUICK_LINKS: readonly QuickLinkDefinition[] = [
  { key: "help", label: "Help", href: "/help", mayUse: anyAdmin },
  { key: "coming-up", label: "Coming up", href: "/home/coming-up", mayUse: anyAdmin },
  { key: "events-admin", label: "Events Administrator dashboard", href: "/events-admin", mayUse: eventsAdmin },
  { key: "events-list", label: "All events", href: "/admin/events", mayUse: systemAdmin },
  { key: "clubs-admin", label: "Club administration", href: "/admin/clubs", mayUse: clubsAdmin },
  { key: "clubs-summary", label: "Club summary", href: "/admin/clubs/summary", mayUse: clubsAdmin },
  { key: "monthly-records", label: "Review monthly records", href: "/admin/clubs/reports", mayUse: clubsAdmin },
  { key: "club-applications", label: "New club applications", href: "/admin/clubs/applications", mayUse: clubsAdmin },
  { key: "system-hub", label: "System administration", href: "/admin", mayUse: systemAdmin },
  { key: "analytics", label: "Analytics", href: "/admin/analytics", mayUse: systemAdmin },
];

/** The most links one person can pick. */
export const QUICK_LINKS_MAX = 12;

const LANDING_KEY: Record<AdminRole, string> = {
  SYSTEM_ADMIN: "system-hub",
  CLUBS_ADMIN: "clubs-admin",
  EVENTS_ADMIN: "events-admin",
};

export function usableQuickLinks(roles: AdminRoles): QuickLinkDefinition[] {
  return QUICK_LINKS.filter((link) => link.mayUse(roles));
}

/** The picks a person starts with: the landing page of each role they hold (System, Events, Clubs), then Help. */
export function defaultQuickLinkKeys(roles: AdminRoles): string[] {
  const held = heldAdminRoles(roles);
  const keys = (["SYSTEM_ADMIN", "EVENTS_ADMIN", "CLUBS_ADMIN"] as const).filter((role) => held.includes(role)).map((role) => LANDING_KEY[role]);
  return [...keys, "help"].filter((key, at, all) => all.indexOf(key) === at && usableQuickLinks(roles).some((link) => link.key === key));
}

/** A stored or submitted list of picks, kept to catalogue keys the person may use now, without repeats, in their order. Null when it is not a list. */
export function cleanQuickLinkKeys(value: unknown, roles: AdminRoles): string[] | null {
  if (!Array.isArray(value)) return null;
  const usable = new Set(usableQuickLinks(roles).map((link) => link.key));
  const out: string[] = [];
  for (const key of value) {
    if (typeof key !== "string" || !usable.has(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length >= QUICK_LINKS_MAX) break;
  }
  return out;
}
