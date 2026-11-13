import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A filter that means "the conference's clubs" must come from `conferenceClubWhere()` (or carry `guestEventId: null`), so a
 * visiting club (#835) never shows up in a conference list. This scans app/, modules/ and lib/ for any object that names
 * `type: "CLUB"` together with `isActive: true` at the same level (one line or several) and has neither. A place that
 * really includes visiting clubs, or that creates a club, is listed below with its reason and its count.
 */

const ROOT = process.cwd();
const SCANNED = ["app", "modules", "lib"];

/** File path -> how many bare club objects it may keep, with the reason each is allowed. Counts only ever go down. */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "modules/organizations/director-access.ts": { count: 1, reason: "A person's own grants: a visiting club's director keeps using their club portal" },
  "modules/event-debriefs/recipients.ts": { count: 1, reason: "Clubs registered for this event, which includes a visiting club at its own event" },
  "modules/club-imports/invites.ts": { count: 1, reason: "Invites sent to this account for a club by id, including a role on a visiting club" },
  "modules/system-admin/pending-invites.ts": { count: 1, reason: "Staff see every open invite, including one on a visiting club" },
  "modules/system-admin/people-invite.ts": { count: 1, reason: "Staff may grant a role on a visiting club by id" },
  "modules/club-applications/repository.ts": { count: 1, reason: "Creates the conference club an approved application asks for" },
  "modules/general-link-registrations/repository.ts": { count: 1, reason: "Creates the conference club staff add to a general-link team" },
};

/**
 * The wider rule: any other object that names `type: "CLUB"` without `guestEventId` (no isActive needed, so a club-list import
 * lookup counts). These are kept as they are, each with its reason. Counts include the entries above that also match.
 */
const LOOSE_ALLOWED: Record<string, { count: number; reason: string }> = {
  "modules/club-applications/repository.ts": { count: 3, reason: "Creates a conference club; a same-church name check (visiting clubs have no church); an audit metadata object" },
  "modules/club-imports/repository.ts": { count: 2, reason: "Creates a conference club from the club-list import (create data, not a lookup)" },
  "modules/club-imports/invites.ts": { count: 1, reason: "Invites sent to this account by club id, including a role on a visiting club" },
  "modules/coordinator-health/repository.ts": { count: 1, reason: "Checks a club id the coordinator already reached through their ministry scope" },
  "modules/event-debriefs/recipients.ts": { count: 1, reason: "Clubs registered for this event, which includes a visiting club at its own event" },
  "modules/registration-form-notifications/queue.ts": { count: 1, reason: "Checks ids already stored on a notification rule; a visiting club of the event may be one" },
  "modules/registration-form-notifications/repository.ts": { count: 2, reason: "Reads stored rule ids by id so a rule on a visiting club still shows its name" },
  "modules/general-link-registrations/repository.ts": { count: 1, reason: "Creates the conference club staff add to a general-link team" },
  "modules/system-admin/pending-invites.ts": { count: 1, reason: "Staff see every open invite, including one on a visiting club" },
  "modules/system-admin/people-invite.ts": { count: 1, reason: "Staff may grant a role on a visiting club by id, within its window" },
  "modules/system-admin/people-directory.ts": { count: 2, reason: "Staff people view scoped to club roles of any club, so a visiting club's people stay findable" },
  "modules/system-admin/people-directory-model.ts": { count: 2, reason: "People scope filter for club roles of any club, visiting clubs included" },
  "modules/organizations/director-access.ts": { count: 1, reason: "A person's own grants: a visiting club's director keeps their portal" },
  "modules/staff-search/service.ts": { count: 1, reason: "Staff search finds a visiting club by name like any club" },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** The text of the object literal around `index`, with nested braces and brackets blanked so only its own keys remain. */
function ownKeysAround(source: string, index: number): string {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const ch = source[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start < 0) return "";
  depth = 0;
  let end = source.length;
  let own = "";
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) { end = i; break; }
      depth--;
    } else if (depth === 0) own += ch;
  }
  return end > start ? own : "";
}

function bareClubObjects(source: string, requireActive = true): number {
  let found = 0;
  for (const match of source.matchAll(/type:\s*"CLUB"/g)) {
    const own = ownKeysAround(source, match.index ?? 0);
    if (requireActive && !/\bisActive:\s*true\b/.test(own)) continue;
    if (!/\bguestEventId\b/.test(own)) found++;
  }
  return found;
}

describe("conference club filters leave visiting clubs out", () => {
  it("finds a single-line and a multi-line bare club object, and ignores one that names guestEventId", () => {
    expect(bareClubObjects('x({ where: { type: "CLUB", isActive: true } })')).toBe(1);
    expect(bareClubObjects('x({ where: {\n  isActive: true,\n  parentOrganization: { isActive: true },\n  type: "CLUB",\n} })')).toBe(1);
    expect(bareClubObjects('x({ where: { type: "CLUB", isActive: true, guestEventId: null } })')).toBe(0);
    expect(bareClubObjects('x({ where: { ...conferenceClubWhere(), id } })')).toBe(0);
    expect(bareClubObjects('x({ where: { type: "CLUB", clubKind: "PATHFINDER" } })')).toBe(0);
    expect(bareClubObjects('x({ where: { type: "CLUB", parentOrganization: { isActive: true } } })')).toBe(0);
  });

  it("allows a bare active-club filter only where the allowlist says why", () => {
    const counts = new Map<string, number>();
    for (const dir of SCANNED) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const count = bareClubObjects(readFileSync(file, "utf8"));
        if (count > 0) counts.set(relative(ROOT, file).replaceAll("\\", "/"), count);
      }
    }
    const unexpected = [...counts].filter(([file, count]) => count > (ALLOWED[file]?.count ?? 0));
    expect(unexpected, "Use conferenceClubWhere() from modules/organizations/area-coordinator-ministries-domain.ts").toEqual([]);
    // A stale entry would hide a future regression in that file.
    const stale = Object.entries(ALLOWED).filter(([file, entry]) => (counts.get(file) ?? 0) !== entry.count);
    expect(stale.map(([file]) => file)).toEqual([]);
  });

  it("catches a club-list lookup with no isActive, and allows a wider bare club object only where the second allowlist says why", () => {
    expect(bareClubObjects('x({ where: { type: "CLUB", normalizedName } })', false)).toBe(1);
    expect(bareClubObjects('x({ where: { type: "CLUB", guestEventId: null, normalizedName } })', false)).toBe(0);
    const counts = new Map<string, number>();
    for (const dir of SCANNED) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const count = bareClubObjects(readFileSync(file, "utf8"), false);
        if (count > 0) counts.set(relative(ROOT, file).replaceAll("\\", "/"), count);
      }
    }
    expect([...counts].filter(([file, count]) => count !== (LOOSE_ALLOWED[file]?.count ?? 0))).toEqual([]);
    expect(Object.keys(LOOSE_ALLOWED).filter((file) => !counts.has(file))).toEqual([]);
  });

  it("keeps every allowlist reason written out", () => {
    for (const [file, entry] of [...Object.entries(ALLOWED), ...Object.entries(LOOSE_ALLOWED)]) {
      expect(entry.reason.length, file).toBeGreaterThan(20);
    }
  });
});
