/**
 * Staff Home layout (#1705). Pure rules, safe to import from client components and tests: which modules exist, who may use
 * them, the fixed default set for each admin role, and how a saved layout is checked against the person's current roles.
 *
 * To add a module: add one entry to `HOME_MODULES` and add its key to the roles that start with it in `HOME_ROLE_DEFAULTS`.
 */
import { heldAdminRoles, type AdminRole, type AdminRoles } from "@/modules/access/admin-roles-domain";

export type HomeModuleKey = "needs-you" | "coming-up";

export type HomeModuleDefinition = {
  key: HomeModuleKey;
  label: string;
  /** False means the module can be moved but never turned off. */
  hideable: boolean;
  /** Decided on the server from the person's current roles. */
  mayUse: (roles: AdminRoles) => boolean;
};

const anyAdminRole = (roles: AdminRoles) => heldAdminRoles(roles).length > 0;

/** Every module, in the order Customize lists unused ones. */
export const HOME_MODULES: readonly HomeModuleDefinition[] = [
  { key: "needs-you", label: "Needs you", hideable: false, mayUse: anyAdminRole },
  { key: "coming-up", label: "Coming up", hideable: true, mayUse: anyAdminRole },
];

/**
 * The fixed default set for each admin role, in display order. The one place defaults live. Only built modules are listed;
 * a later module joins its roles here in the issue that builds it.
 */
export const HOME_ROLE_DEFAULTS: Record<AdminRole, HomeModuleKey[]> = {
  SYSTEM_ADMIN: ["needs-you"],
  EVENTS_ADMIN: ["needs-you", "coming-up"],
  CLUBS_ADMIN: ["needs-you"],
};

/** Roles are merged in this order, whatever order they are held in. */
const MERGE_ORDER: readonly AdminRole[] = ["SYSTEM_ADMIN", "EVENTS_ADMIN", "CLUBS_ADMIN"];

/** The most modules one saved layout can hold. */
export const HOME_LAYOUT_MAX = 32;

export type HomeLayoutEntry = { key: HomeModuleKey; shown: boolean };
export type HomeLayoutModule = HomeLayoutEntry & { label: string; hideable: boolean };
export type HomeLayout = { modules: HomeLayoutModule[]; customized: boolean };

const byKey = new Map<string, HomeModuleDefinition>(HOME_MODULES.map((def) => [def.key, def]));

function usableModules(roles: AdminRoles) {
  return HOME_MODULES.filter((def) => def.mayUse(roles));
}

/** The default list for a person: role defaults merged without repeats, then every other usable module turned off. */
export function defaultHomeLayout(held: readonly AdminRole[], roles?: AdminRoles): HomeLayoutEntry[] {
  const out: HomeLayoutEntry[] = [];
  const seen = new Set<string>();
  const usable = roles ? new Set(usableModules(roles).map((def) => def.key)) : null;
  for (const role of MERGE_ORDER) {
    if (!held.includes(role)) continue;
    for (const key of HOME_ROLE_DEFAULTS[role]) {
      if (seen.has(key) || (usable && !usable.has(key))) continue;
      seen.add(key);
      out.push({ key, shown: true });
    }
  }
  for (const def of HOME_MODULES) {
    if (seen.has(def.key) || (usable && !usable.has(def.key))) continue;
    seen.add(def.key);
    out.push({ key: def.key, shown: false });
  }
  return out;
}

/** Reads an unknown value as a list of `{ key, shown }`, dropping anything unknown, unusable or repeated. Null when it is not a list. */
function cleanEntries(value: unknown, roles: AdminRoles): HomeLayoutEntry[] | null {
  if (!Array.isArray(value)) return null;
  const usable = new Set(usableModules(roles).map((def) => def.key));
  const seen = new Set<string>();
  const out: HomeLayoutEntry[] = [];
  for (const item of value.slice(0, HOME_LAYOUT_MAX)) {
    if (!item || typeof item !== "object") continue;
    const { key, shown } = item as { key?: unknown; shown?: unknown };
    if (typeof key !== "string" || !byKey.has(key) || !usable.has(key as HomeModuleKey) || seen.has(key)) continue;
    seen.add(key);
    const definition = byKey.get(key)!;
    out.push({ key: key as HomeModuleKey, shown: definition.hideable ? shown === true : true });
  }
  return out;
}

/** Adds usable modules the list lacks, hidden, at the end. */
function withMissingHidden(entries: HomeLayoutEntry[], roles: AdminRoles): HomeLayoutEntry[] {
  const have = new Set(entries.map((entry) => entry.key));
  const missing = usableModules(roles).filter((def) => !have.has(def.key)).map((def): HomeLayoutEntry => ({ key: def.key, shown: !def.hideable }));
  return [...entries, ...missing];
}

function describe(entries: readonly HomeLayoutEntry[]): HomeLayoutModule[] {
  return entries.map((entry) => {
    const definition = byKey.get(entry.key)!;
    return { key: entry.key, shown: entry.shown, label: definition.label, hideable: definition.hideable };
  });
}

/** The layout to show: the saved one checked against the person's current roles, or their role defaults when nothing valid is saved. */
export function resolveHomeLayout(saved: unknown, roles: AdminRoles): HomeLayout {
  const held = heldAdminRoles(roles);
  const entries = cleanEntries(saved, roles);
  if (!entries || entries.length === 0) return { modules: describe(defaultHomeLayout(held, roles)), customized: false };
  return { modules: describe(withMissingHidden(entries, roles)), customized: true };
}

/** For saving: the checked list to store, or null when the input is not a list or holds nothing usable. */
export function sanitizeHomeLayoutInput(input: unknown, roles: AdminRoles): HomeLayoutEntry[] | null {
  const entries = cleanEntries(input, roles);
  if (!entries || entries.length === 0) return null;
  return withMissingHidden(entries, roles);
}

/** A copy of `list` with the item at `from` moved to `to` (both clamped). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from < 0 || from >= copy.length) return copy;
  const target = Math.max(0, Math.min(copy.length - 1, to));
  const [item] = copy.splice(from, 1);
  copy.splice(target, 0, item);
  return copy;
}

/** The screen-reader message after a move; `position` is 1-based. */
export function moveAnnouncement(label: string, position: number, total: number): string {
  return `${label} moved to position ${position} of ${total}`;
}
