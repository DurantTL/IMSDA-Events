import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for #155: shared `modules/` code must not grow event-specific coupling.
 *
 * Two things are checked, in every module outside the approved directories:
 *  - file and directory names, and
 *  - exported identifiers (const, function, class, type, interface, enum).
 * An event-specific token in either is a failure unless it is on the explicit
 * allowlist below. The allowlist is a ratchet: the compatibility aliases kept for
 * old imports (so links, historical references and unmigrated callers keep
 * working) and the few pre-existing event presets. Do not add to it to make a
 * new event-specific name pass; put event-specific behavior in data (seeded
 * form templates, event settings) or in an approved importer/profile directory.
 */
const modulesRoot = path.join(process.cwd(), "modules");

const eventSpecificToken = /(wr\d{2}|womens|retreat|camporee|campmeeting|camp-meeting)/i;

/** Quoted event slugs and labels in shared code. */
const eventSpecificLiteral = /["'`][^"'`\n]*(womens-retreat|camp-meeting|wr\d{2})[^"'`\n]*["'`]/gi;

/** Legitimately event-specific: importers, import profiles, starters and seeded template data. */
const approvedPaths = [
  "imports/",
  "club-imports/",
  "event-templates/starters.ts",
  "forms/seeded-template-data.ts",
];

/** Compatibility aliases for pre-#155 names. Remove each entry when its last importer is gone. */
const compatibilityAliasFiles = new Set([
  "reporting/retreat-packets.ts",
  "reporting/retreat-packets-repository.ts",
  "attendee-accounts/retreat-hub-repository.ts",
]);
const compatibilityAliasExports: Record<string, string[]> = {
  "reporting/event-packets.ts": [
    "buildRetreatPacketGroups",
    "RetreatPacketAssignment",
    "RetreatPacketGroup",
  ],
  "reporting/event-packets-repository.ts": ["getRetreatPackets"],
  "attendee-accounts/event-hub-repository.ts": [
    "getAttendeeRetreatHub",
    "getStaffRetreatHubPreview",
    "retreatHubAnnouncementRecords",
    "AttendeeRetreatHub",
  ],
};

/** Pre-existing event-named presets, grandfathered. New entries are not accepted. */
const grandfathered: Record<string, string[]> = {
  "meals/camp-meeting.ts": ["campMeetingMeals"],
  "meals/config-repository.ts": ["applyCampMeetingMealPreset"],
  "cancellation-policy/rules.ts": ["campMeetingPreset"],
};
const grandfatheredFiles = new Set(["meals/camp-meeting.ts"]);

/**
 * Pre-existing event-specific string literals in shared modules, grandfathered by file (a ratchet:
 * new entries are not accepted). Each value is the exact literal text matched.
 */
const grandfatheredLiterals: Record<string, string[]> = {
  "checkin/domain.ts": ['"WR26-…"'],
  "event-clones/private-links.ts": ["`https://imsda.org/camp-meeting-2027/photos`"],
  "events/last-used-event-cookie.ts": ["`evt_wr26`"],
  "events/public-domain.ts": ['"womens-retreat-2026"', '"https://imsda.org/event/womens-retreat-3/"'],
  "organizations/domain.ts": ['"WR26"'],
  "organizations/schemas.ts": ['"WR26"'],
  "payments/square-match-repository.ts": ["`wr26-bundle.ts`"],
  "system-admin/readiness-items.ts": ['"wr26-signed-off"', '"WR26 sign-off"'],
};

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const relativeFiles = listFiles(modulesRoot)
  .map((file) => path.relative(modulesRoot, file).split(path.sep).join("/"))
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .filter((file) => !approvedPaths.some((approved) => file.startsWith(approved)));

const exportPattern = /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm;
const defaultExportPattern = /^export\s+default\s+(?:async\s+)?(?:function\*?|class)?\s*([A-Za-z0-9_$]+)?/gm;
const exportListPattern = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;

/** Every exported name in a source file, including `export { x as y }`, re-exports, and default exports. */
function exportedNames(source: string) {
  const names: string[] = [];
  for (const match of source.matchAll(exportPattern)) names.push(match[1]);
  for (const match of source.matchAll(defaultExportPattern)) if (match[1]) names.push(match[1]);
  for (const match of source.matchAll(exportListPattern)) {
    for (const part of match[1].split(",")) {
      const piece = part.trim().replace(/^type\s+/, "");
      if (!piece) continue;
      // `a as b` exports b but also names a; check both sides.
      names.push(...piece.split(/\s+as\s+/).map((name) => name.trim()));
    }
  }
  return names;
}

describe("shared modules stay event-neutral (#155)", () => {
  it("has no event-specific file or directory names", () => {
    const offenders = relativeFiles.filter((file) => (
      eventSpecificToken.test(file)
      && !compatibilityAliasFiles.has(file)
      && !grandfatheredFiles.has(file)
    ));
    expect(offenders).toEqual([]);
  });

  it("has no event-specific exported identifiers", () => {
    const offenders: string[] = [];
    for (const file of relativeFiles) {
      const source = readFileSync(path.join(modulesRoot, file), "utf8");
      const allowed = new Set([
        ...(compatibilityAliasExports[file] ?? []),
        ...(grandfathered[file] ?? []),
      ]);
      for (const name of exportedNames(source)) {
        if (eventSpecificToken.test(name) && !allowed.has(name)) {
          offenders.push(`${file}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no event-specific string literals", () => {
    const offenders: string[] = [];
    for (const file of relativeFiles) {
      if (grandfatheredFiles.has(file) || compatibilityAliasFiles.has(file) || file in grandfathered) continue;
      const source = readFileSync(path.join(modulesRoot, file), "utf8");
      for (const match of source.matchAll(eventSpecificLiteral)) {
        if (!(grandfatheredLiterals[file] ?? []).includes(match[0])) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("flags a new event-specific name (the guard itself works)", () => {
    expect(eventSpecificToken.test("reporting/womens-retreat-sheet.ts")).toBe(true);
    expect(eventSpecificToken.test("buildWr26Packets")).toBe(true);
    expect(eventSpecificToken.test("buildWr27Packets")).toBe(true);
    expect(eventSpecificToken.test("buildEventPacketGroups")).toBe(false);
    const names = exportedNames([
      "const retreatThing = 1;",
      "export { retreatThing };",
      "export { a as womensExport } from \"./x\";",
      "export default function campMeetingHome() {}",
      "export let wr27State = 0;",
    ].join("\n"));
    expect(names).toEqual(expect.arrayContaining(["wr27State", "campMeetingHome", "womensExport", "retreatThing"]));
    expect(`const slug = "womens-retreat";`.match(eventSpecificLiteral)).toHaveLength(1);
    expect(`const slug = "camp-meeting";`.match(eventSpecificLiteral)).toHaveLength(1);
  });

  it("keeps every allowlisted alias real, so the list cannot go stale", () => {
    const all = new Set(listFiles(modulesRoot)
      .map((file) => path.relative(modulesRoot, file).split(path.sep).join("/")));
    for (const file of compatibilityAliasFiles) expect(all.has(file)).toBe(true);
    for (const [file, literals] of Object.entries(grandfatheredLiterals)) {
      expect(all.has(file)).toBe(true);
      const source = readFileSync(path.join(modulesRoot, file), "utf8");
      for (const literal of literals) expect(source).toContain(literal);
    }
    for (const [file, names] of Object.entries({ ...compatibilityAliasExports, ...grandfathered })) {
      expect(all.has(file)).toBe(true);
      const source = readFileSync(path.join(modulesRoot, file), "utf8");
      for (const name of names) expect(source).toContain(name);
    }
  });
});
