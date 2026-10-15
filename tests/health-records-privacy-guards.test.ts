import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name);
    return statSync(join(root, path)).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("health data stays out of exports, the check-in book, communications and logs", () => {
  const importsHealth = /from "@\/modules\/health-records\//;

  it("is imported only by its own module, its routes and pages, the roster page tab and the email worker", () => {
    const allowedOutside = new Set([
      "app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx",
      "modules/communications/email-delivery.ts",
      // The two scheduled and event-driven callers of sealed health copies (#924). Each imports only `snapshot-hooks`
      // (checked below); the check-in module itself stays free of health code.
      "app/api/events/[eventId]/attendees/[attendeeId]/check-in/route.ts",
      "app/api/internal/outbox/sweep/route.ts",
      // Shows the "Import health records" link only when the feature is on (#878); it imports the flag and nothing else.
      "app/(workspace)/admin/organizations/page.tsx",
    ]);
    const offenders = [...sourceFiles("modules"), ...sourceFiles("components"), ...sourceFiles("app"), ...sourceFiles("lib")]
      .filter((path) => !path.startsWith("modules/health-records/"))
      .filter((path) => importsHealth.test(read(path)))
      .filter((path) => !allowedOutside.has(path))
      .filter((path) => !/health/i.test(path));
    expect(offenders).toEqual([]);
  });

  it("is never read by CSV, export, check-in, reporting, club report or message-composing code", () => {
    const guarded = [
      ...sourceFiles("modules/checkin"),
      ...sourceFiles("modules/reporting"),
      ...sourceFiles("modules/club-reports"),
      ...sourceFiles("modules/club-rosters").filter((path) => /export|csv/.test(path)),
      ...sourceFiles("modules/club-forms").filter((path) => /csv|submissions/.test(path)),
      ...sourceFiles("modules/communications").filter((path) => path !== "modules/communications/email-delivery.ts"),
      ...sourceFiles("modules/imports"),
    ];
    expect(guarded.length).toBeGreaterThan(10);
    for (const path of guarded) {
      expect(read(path), relative(root, path)).not.toMatch(/health-records|healthRecord|HealthRecord/);
    }
  });

  it("keeps the Registrar's write-only code free of anything that selects or opens a stored value (#923)", () => {
    const source = read("modules/health-records/repository.ts");
    const start = source.indexOf("// The write-only Registrar (#923).");
    const end = source.indexOf("The plain \"a health record exists\" marker");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = source.slice(start, end);
    expect(section).not.toMatch(/openFields|openHealthField|sealedValue|fields:|findRecord\(|hasHealthNote/);
    // And nothing outside the repository decrypts or selects sealed fields.
    for (const path of sourceFiles("modules/health-records").filter((file) => !/repository\.ts$|crypto\.ts$/.test(file))) {
      expect(read(path), path).not.toMatch(/sealedValue|openHealthField/);
    }
  });

  it("puts no health value into the acknowledgment code, its table or its audit row (#923)", () => {
    for (const path of ["modules/health-records/acknowledgment.ts", "modules/health-records/acknowledgment-domain.ts"]) {
      expect(read(path), path).not.toMatch(/healthRecordField|openHealthField|sealedValue|fieldValues/);
    }
    expect(read("prisma/migrations/20261022100000_health_privacy_acknowledgment/migration.sql")).not.toMatch(/sealedValue|fieldKey/);
  });

  it("lets the check-in route and the sweep call only the sealed-copy hooks, and nothing else reach sealed copies except the administrator routes (#924)", () => {
    for (const path of ["app/api/events/[eventId]/attendees/[attendeeId]/check-in/route.ts", "app/api/internal/outbox/sweep/route.ts"]) {
      const imports = [...read(path).matchAll(/from "@\/modules\/health-records\/([a-z-]+)"/g)].map((match) => match[1]);
      expect(imports, path).toEqual(["snapshot-hooks"]);
    }
    const users = [...sourceFiles("modules"), ...sourceFiles("components"), ...sourceFiles("app"), ...sourceFiles("lib")]
      .filter((path) => !path.startsWith("modules/health-records/"))
      .filter((path) => /snapshot-(access-)?repository/.test(read(path)))
      // Event deletion counts and removes copies with the table, not through the module (no health code imported).
      .sort();
    expect(users).toEqual([
      "app/api/staff/health-snapshots/break-glass-grants/route.ts",
      "app/api/staff/health-snapshots/break-glass/route.ts",
      "app/api/staff/health-snapshots/holds/[holdId]/lift/route.ts",
      "app/api/staff/health-snapshots/holds/route.ts",
      "app/api/staff/health-snapshots/person/[personId]/route.ts",
    ]);
  });

  it("puts no health value into a sealed copy's row, its table or its audit rows, and opens values only in the break-glass view (#924)", () => {
    const migration = read("prisma/migrations/20261023100000_health_record_snapshots/migration.sql");
    // The sealed fields hold only `sealedValue`; the copy's own row has no value, name or birth date column.
    expect(migration).not.toMatch(/"(birth\w*|firstName|lastName|phone|email|address\w*)"|allerg|medicat/i);
    for (const path of ["modules/health-records/snapshot-repository.ts", "modules/health-records/snapshot-hooks.ts", "modules/health-records/snapshot-retention.ts"]) {
      expect(read(path), path).not.toMatch(/openSnapshotField/);
    }
    // The birth date is read only to work out the keep-until date: the create call and the audit row never carry it.
    const taking = read("modules/health-records/snapshot-repository.ts");
    const create = taking.slice(taking.indexOf("healthRecordSnapshot.create("), taking.indexOf("return { outcome: \"TAKEN\""));
    expect(create).not.toMatch(/birth|openBirthDate/i);
    expect(read("modules/health-records/snapshot-access-repository.ts").match(/openSnapshotField\(/g)).toHaveLength(1);
  });

  it("lets the email worker use only the link email helpers, which carry no health text", () => {
    const delivery = read("modules/communications/email-delivery.ts");
    const imports = [...delivery.matchAll(/from "@\/modules\/health-records\/([a-z-]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["link-email"]);
  });

  it("never writes to the console and logs only through the redacting logger", () => {
    for (const path of sourceFiles("modules/health-records")) {
      const source = read(path);
      expect(source, path).not.toMatch(/console\.(log|info|warn|error|debug)/);
      for (const call of source.matchAll(/logError\(([^)]*)\)/g)) {
        // The action text and the error object: never a record, a field value or a request body.
        expect(call[1], path).toMatch(/^(action|`\$\{action\} failed`), error$/);
      }
    }
  });

  it("builds the link email from the club name and expiry only", async () => {
    const { healthRecordLinkEmailContent } = await import("@/modules/health-records/link-email");
    const content = healthRecordLinkEmailContent({ clubName: "Synthetic Pathfinders", days: 14, expiresOn: "October 19, 2026" });
    expect(content.bodyText).toContain("{{health_record_link}}");
    expect(content.bodyText).not.toMatch(/allerg|medicat|insurance|diagnos|birth/i);
  });
});

describe("removing a roster member erases their Health Record", () => {
  async function erase(row: { organizationId: string; personId: string | null } | null) {
    const calls: string[] = [];
    const tx = {
      clubRosterGuardian: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      clubMeetingAttendance: { deleteMany: vi.fn(async () => { calls.push("attendance"); }) },
      healthRecord: { deleteMany: vi.fn(async () => { calls.push("healthRecord"); }) },
      healthRecordLink: { updateMany: vi.fn(async () => { calls.push("healthRecordLink"); }) },
      clubRosterMember: { findUnique: vi.fn(async () => row), update: vi.fn(async () => { calls.push("member"); }) },
    };
    vi.doMock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
    const { eraseRosterRow } = await import("@/modules/club-rosters/repository");
    await eraseRosterRow(tx as never, "member-1", new Date("2026-10-05T15:00:00Z"));
    return { tx, calls };
  }

  it("deletes every year's record for the person in this club, and withdraws their open links, before personId is cleared", async () => {
    const { tx, calls } = await erase({ organizationId: "club-a", personId: "person-1" });
    const scope = { OR: [{ rosterMemberId: "member-1" }, { organizationId: "club-a", rosterMember: { personId: "person-1" } }] };
    expect(tx.healthRecord.deleteMany).toHaveBeenCalledWith({ where: scope });
    expect(tx.healthRecordLink.updateMany).toHaveBeenCalledWith({
      where: { status: "OPEN", ...scope },
      data: expect.objectContaining({ status: "REVOKED", tokenHash: null }),
    });
    expect(calls.indexOf("healthRecord")).toBeLessThan(calls.indexOf("member"));
    expect(calls.indexOf("healthRecordLink")).toBeLessThan(calls.indexOf("member"));
  });

  it("falls back to the row itself when the person link is already gone", async () => {
    const { tx } = await erase({ organizationId: "club-a", personId: null });
    expect(tx.healthRecord.deleteMany).toHaveBeenCalledWith({ where: { rosterMemberId: "member-1" } });
  });
});

describe("the Area Coordinator reaches health records only through the event-scoped view", () => {
  it("has exactly one coordinator page and one coordinator route that use the health module", () => {
    const area = [
      ...sourceFiles("modules/organizations").filter((path) => /area/.test(path)),
      ...sourceFiles("modules/club-reports"),
      ...sourceFiles("app/(public)/account/(portal)/area-clubs"),
      ...sourceFiles("app/api/attendee/area-clubs"),
    ];
    const users = area.filter((path) => /health-records/.test(read(path))).sort();
    expect(users).toEqual([
      "app/(public)/account/(portal)/area-clubs/health/[eventId]/[organizationId]/[memberId]/page.tsx",
      "app/api/attendee/area-clubs/health/[eventId]/[organizationId]/[memberId]/route.ts",
    ]);
  });

  it("never lets the coordinator summary, export or roster code touch health data", () => {
    for (const path of sourceFiles("modules/club-reports")) expect(read(path), path).not.toMatch(/healthRecord|HealthRecord/);
  });
});
