import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  kickClassChangeEmails: vi.fn(),
  promoteClassWaitlists: vi.fn(),
  deliverWaitlistOfferMessages: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/honors/class-change-emails", () => ({ kickClassChangeEmails: mocks.kickClassChangeEmails }));
vi.mock("@/modules/honors/waitlist-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/honors/waitlist-repository")>()),
  promoteClassWaitlists: mocks.promoteClassWaitlists,
  deliverWaitlistOfferMessages: mocks.deliverWaitlistOfferMessages,
}));

import { removePickAsAdministrator } from "@/modules/honors/admin-placement";
import { recordAttendeeClassChanges, recordClassChanges, recordRegistrationClassChanges } from "@/modules/honors/class-change-log";
import { setClassSelections } from "@/modules/honors/enrollment-repository";
import { restoreClassSeatsInTransaction } from "@/modules/honors/restore-seats";

const now = new Date("2026-10-15T15:00:00.000Z");

/** A transaction client holding only what the change log reads and writes. */
function logClient() {
  const enrollment = (id: string, offeringId: string, attendee: string, extra: Record<string, unknown> = {}) => ({
    id, eventId: "event-1", offeringId, registrationAttendeeId: attendee,
    organization: { name: "Synthetic Pathfinders" },
    registrationAttendee: { profileSnapshot: { firstName: "Pat", lastName: "Example", ageOnEventDate: 12, birthDate: "2014-05-05" } },
    ...extra,
  });
  const rows = [enrollment("e-knots", "class-knots", "att-1"), enrollment("e-birds", "class-birds", "att-1"), enrollment("e-other", "class-knots", "att-2", { organization: null })];
  const client = {
    honorEnrollment: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; registrationId?: string; registrationAttendeeId?: { in: string[] } } }) => {
        if (where.id) return rows.filter((row) => where.id!.in.includes(row.id));
        if (where.registrationId) return rows.map((row) => ({ id: row.id }));
        if (where.registrationAttendeeId) return rows.filter((row) => where.registrationAttendeeId!.in.includes(row.registrationAttendeeId)).map((row) => ({ id: row.id }));
        return [];
      }),
    },
    honorClassChange: {
      createManyAndReturn: vi.fn(async ({ data }: { data: unknown[] }) => data.map((_row, index) => ({ id: `change-${index + 1}` }))),
    },
  };
  return client;
}

const written = (client: ReturnType<typeof logClient>) => (client.honorClassChange.createManyAndReturn.mock.calls as unknown as Array<[{ data: Array<Record<string, unknown>> }]>).flatMap(([call]) => call.data);

describe("the change log row (#1098)", () => {
  it("copies the youth's name, club and age, and never reads or stores a birth date", async () => {
    const client = logClient();
    const count = await recordClassChanges(client as never, ["e-knots"], "JOINED", now);
    expect(count).toEqual(["change-1"]);
    expect(written(client)).toEqual([{
      eventId: "event-1", offeringId: "class-knots", enrollmentId: "e-knots", registrationAttendeeId: "att-1",
      kind: "JOINED", youthName: "Pat Example", clubName: "Synthetic Pathfinders", ageOnEventDate: 12, at: now,
    }]);
    expect(JSON.stringify(client.honorClassChange.createManyAndReturn.mock.calls)).not.toMatch(/birth|2014/i);
    // The read asks only for the name, age and club it needs.
    const select = (client.honorEnrollment.findMany.mock.calls[0]![0] as unknown as { select: { registrationAttendee: { select: Record<string, boolean> } } }).select;
    expect(select.registrationAttendee.select).toEqual({ profileSnapshot: true });
  });

  it("logs every change, whether or not the class has an instructor yet, and returns the ids it wrote", async () => {
    const client = logClient();
    expect(await recordClassChanges(client as never, ["e-knots", "e-birds", "e-other"], "LEFT", now)).toEqual(["change-1", "change-2", "change-3"]);
    expect(written(client).map((row) => row.enrollmentId)).toEqual(["e-knots", "e-birds", "e-other"]);
    // The pick transaction reads no instructor assignment: nothing in the client could answer one.
    expect(client).not.toHaveProperty("honorInstructorClass");
  });

  it("writes nothing and reads nothing for no enrollments", async () => {
    const client = logClient();
    expect(await recordClassChanges(client as never, [], "JOINED", now)).toEqual([]);
    expect(client.honorEnrollment.findMany).not.toHaveBeenCalled();
  });

  it("logs every pick of a registration, and every pick of a removed attendee", async () => {
    const forRegistration = logClient();
    expect(await recordRegistrationClassChanges(forRegistration as never, "registration-1", "LEFT", now)).toHaveLength(3);
    const forAttendee = logClient();
    expect(await recordAttendeeClassChanges(forAttendee as never, ["att-1"], "LEFT", now)).toHaveLength(2);
    expect(await recordAttendeeClassChanges(forAttendee as never, [], "LEFT", now)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Each path that creates or deletes an enrollment.
// ---------------------------------------------------------------------------

const event = {
  id: "event-1", isPublished: true, endsAt: new Date("2026-12-06T20:00:00.000Z"), timezone: "America/Chicago",
  registrationOpensOn: "2026-10-01", registrationClosesOn: "2026-11-30", waitlistEnabled: false,
};

function offering(id: string, honorName: string, sessionId: string) {
  return {
    id, span: "SINGLE_SESSION", sessionId, locationId: null, site: null,
    capacity: 10, minimumAge: null, minimumClassLevel: null, prerequisites: [], perClubLimit: null,
    teacherName: "", location: "", isActive: true, honors: [{ honor: { id: `honor-${id}`, name: honorName, code: id.toUpperCase(), isActive: true } }],
    session: { name: `Session ${sessionId}`, sortOrder: 0, locationId: null, location: null },
  };
}

/** A club saving class picks: the youth holds "birds" and the save swaps it for "knots". */
function pickSaveDatabase() {
  const logRow = (id: string, offeringId: string) => ({
    id, eventId: "event-1", offeringId, registrationAttendeeId: "attendee-1",
    organization: { name: "Synthetic Pathfinders" },
    registrationAttendee: { profileSnapshot: { firstName: "Alex", lastName: "Youth", ageOnEventDate: 12 } },
  });
  const calls: string[] = [];
  const db = {
    clubEventRegistration: {
      findUnique: vi.fn().mockResolvedValue({
        event,
        registration: {
          id: "registration-1", status: "SUBMITTED", locationId: null, location: null,
          attendees: [{ id: "attendee-1", profileSnapshot: { firstName: "Alex", lastName: "Youth", ageOnEventDate: 12, temporaryAttendeeType: "YOUTH" } }],
        },
      }),
    },
    clubRosterMember: { findMany: vi.fn().mockResolvedValue([]) },
    eventLocation: { count: vi.fn().mockResolvedValue(0) },
    honorOffering: { findMany: vi.fn().mockResolvedValue([offering("birds", "Birds", "s1"), offering("knots", "Knots", "s2")]) },
    honorOfferingPrerequisite: { findMany: vi.fn().mockResolvedValue([]) },
    honorClassWaitlistEntry: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    honorSession: { findMany: vi.fn().mockResolvedValue([]) },
    honorClassChange: { createManyAndReturn: vi.fn(async ({ data }: { data: unknown[] }) => { calls.push("log"); return data.map((_row, index) => ({ id: `change-${calls.length}-${index}` })); }) },
    honorEnrollment: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) => {
        if (where.id) return where.id.in.map((id) => logRow(id, id === "e-knots" ? "knots" : "birds"));
        return [{ id: "e-birds", registrationAttendeeId: "attendee-1", offeringId: "birds", adminPlacementReason: null }];
      }),
      deleteMany: vi.fn(async () => { calls.push("delete"); return { count: 1 }; }),
      createManyAndReturn: vi.fn(async () => { calls.push("create"); return [{ id: "e-knots" }]; }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(db)),
  };
  mocks.getPrisma.mockReturnValue(db);
  return { db, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.kickClassChangeEmails.mockResolvedValue(undefined);
  mocks.promoteClassWaitlists.mockResolvedValue({ messageIds: [], offered: 0, lapsed: 0 });
});

describe("path: a director's pick save creates and deletes enrollments (#1098)", () => {
  it("logs the leave before the pick is deleted and the join after the new pick is created, in the same transaction", async () => {
    const { db, calls } = pickSaveDatabase();
    await setClassSelections("club-1", "event-1", { accountId: "director-1" }, { "attendee-1": ["knots"] }, now);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["log", "delete", "create", "log"]);
    const rows = (db.honorClassChange.createManyAndReturn.mock.calls as unknown as Array<[{ data: Array<Record<string, unknown>> }]>).flatMap(([call]) => call.data);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "LEFT", enrollmentId: "e-birds", offeringId: "birds", youthName: "Alex Youth", clubName: "Synthetic Pathfinders", ageOnEventDate: 12 }),
      expect.objectContaining({ kind: "JOINED", enrollmentId: "e-knots", offeringId: "knots" }),
    ]);
  });

  it("starts the right-away emails only after the save commits, and tells them how many rows were written", async () => {
    const { db } = pickSaveDatabase();
    let committed = false;
    db.$transaction.mockImplementation(async (work: (client: unknown) => unknown) => {
      const result = await work(db);
      committed = true;
      return result;
    });
    mocks.kickClassChangeEmails.mockImplementation(async () => {
      expect(committed).toBe(true);
    });
    await setClassSelections("club-1", "event-1", { accountId: "director-1" }, { "attendee-1": ["knots"] }, now);
    expect(mocks.kickClassChangeEmails).toHaveBeenCalledWith([expect.any(String), expect.any(String)]);
  });

  it("logs nothing when the save changes nothing", async () => {
    const { db } = pickSaveDatabase();
    await setClassSelections("club-1", "event-1", { accountId: "director-1" }, { "attendee-1": ["birds"] }, now);
    expect(db.honorClassChange.createManyAndReturn).not.toHaveBeenCalled();
    expect(mocks.kickClassChangeEmails).toHaveBeenCalledWith([]);
  });
});

describe("path: a system administrator removes a pick (#1098)", () => {
  it("logs the leave before deleting the pick, in the same transaction, and starts the email after it commits", async () => {
    const calls: string[] = [];
    const client = {
      user: { findUnique: vi.fn().mockResolvedValue({ globalRole: "SYSTEM_ADMIN" }) },
      honorEnrollment: {
        findFirst: vi.fn().mockResolvedValue({
          id: "pick-1", offeringId: "class-knots", registrationId: "registration-1", registrationAttendeeId: "att-1", organizationId: "org-1",
          consumesSeat: true, adminPlacementReason: null, adminPlacementOverCapacity: false,
        }),
        findMany: vi.fn().mockResolvedValue([{
          id: "pick-1", eventId: "event-1", offeringId: "class-knots", registrationAttendeeId: "att-1",
          organization: { name: "Synthetic Pathfinders" },
          registrationAttendee: { profileSnapshot: { firstName: "Pat", lastName: "Example", ageOnEventDate: 12 } },
        }]),
        deleteMany: vi.fn(async () => { calls.push("delete"); return { count: 1 }; }),
      },
      honorEnrollmentMark: { findUnique: vi.fn().mockResolvedValue(null) },
      honorWeekendCompletionLink: { findFirst: vi.fn().mockResolvedValue(null) },
      honorClassChange: { createManyAndReturn: vi.fn(async () => { calls.push("log"); return [{ id: "change-9" }]; }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    let committed = false;
    const db = {
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => {
        const result = await work(client);
        committed = true;
        return result;
      }),
    };
    mocks.getPrisma.mockReturnValue(db);
    mocks.kickClassChangeEmails.mockImplementation(async () => {
      expect(committed).toBe(true);
    });

    await removePickAsAdministrator("event-1", "admin-1", { enrollmentId: "pick-1", reason: "Synthetic: family request" }, now);

    expect(calls).toEqual(["log", "delete"]);
    expect(client.honorClassChange.createManyAndReturn).toHaveBeenCalledWith({ data: [expect.objectContaining({ kind: "LEFT", enrollmentId: "pick-1", youthName: "Pat Example", ageOnEventDate: 12 })], select: { id: true } });
    expect(mocks.kickClassChangeEmails).toHaveBeenCalledWith(["change-9"]);
  });
});

describe("path: bringing a registration back re-takes its seats (#1098)", () => {
  it("logs the picks that are on their classes again as joined, in the same transaction", async () => {
    // A registration whose only pick takes no seat: nothing to re-check, but the pick is on the class list again.
    const client = {
      honorEnrollment: {
        findMany: vi.fn(async ({ where }: { where: { registrationId?: string; id?: { in: string[] } } }) => {
          if (where.id) {
            return [{
              id: "pick-1", eventId: "event-1", offeringId: "class-knots", registrationAttendeeId: "att-1",
              organization: { name: "Synthetic Pathfinders" },
              registrationAttendee: { profileSnapshot: { firstName: "Pat", lastName: "Example", ageOnEventDate: 12 } },
            }];
          }
          if (where.registrationId) {
            return [{
              id: "pick-1", offeringId: "class-knots", organizationId: "org-1", consumesSeat: false, adminPlacementOverCapacity: false, registrationAttendeeId: "att-1",
              registrationAttendee: { profileSnapshot: {} }, instructorMark: null, weekendCompletions: [],
            }];
          }
          return [];
        }),
      },
      honorClassChange: { createManyAndReturn: vi.fn().mockResolvedValue([{ id: "change-1" }]) },
    };

    await restoreClassSeatsInTransaction(client as never, {
      eventId: "event-1", registrationId: "registration-1", now, actorUserId: "user-1", correlationId: "corr-1", trigger: "REGISTRATION_REACTIVATED",
    });

    expect(client.honorClassChange.createManyAndReturn).toHaveBeenCalledWith({ data: [expect.objectContaining({ kind: "JOINED", enrollmentId: "pick-1", offeringId: "class-knots" })], select: { id: true } });
  });
});

// ---------------------------------------------------------------------------
// Nothing can create or delete an enrollment without the log.
// ---------------------------------------------------------------------------

const root = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const logCalls = ["recordClassChanges", "recordRegistrationClassChanges", "recordAttendeeClassChanges"];
const enrollmentWrite = /\.honorEnrollment\.(create|createMany|createManyAndReturn|delete|deleteMany|upsert)$/;

type Site = { file: string; method: string; line: number; callPosition: number; logPositions: number[]; functionName: string };

/** Every write to HonorEnrollment, with where each log call sits inside the same top-level function. */
function enrollmentWriteSites(): Site[] {
  const sites: Site[] = [];
  for (const dir of ["modules", "app", "lib"]) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const text = readFileSync(file, "utf8");
      if (!/honorEnrollment\./.test(text)) continue;
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && enrollmentWrite.test(node.expression.getText(source))) {
          let top: ts.Node = node;
          for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
            if (ts.isFunctionDeclaration(parent) && parent.parent === source) top = parent;
          }
          const logPositions: number[] = [];
          const scan = (inner: ts.Node) => {
            if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && logCalls.includes(inner.expression.text)) logPositions.push(inner.getStart());
            ts.forEachChild(inner, scan);
          };
          scan(top);
          sites.push({
            file: path.relative(root, file).split(path.sep).join("/"),
            method: node.expression.getText(source).split(".").pop()!,
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            callPosition: node.getStart(),
            logPositions,
            functionName: ts.isFunctionDeclaration(top) ? top.name?.text ?? "(anonymous)" : "(module level)",
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return sites;
}

/** Writes that deliberately leave no log row, and why. A new write path is neither here nor logged, so the test below fails until it is decided. */
const exempt: Record<string, string> = {
  "modules/events/deletion-repository.ts": "deleting a whole event removes its instructors, classes and change log with it; nobody is told a class list changed",
  "modules/honors/repository.ts": "deleting a class removes the class itself (and its instructor assignments and change log): there is no class list left to change",
  "modules/honors/restore-seats.ts": "a pick dropped while bringing a registration back was never on a class list: the registration was cancelled or waitlisted, so its leave was logged when it went inactive",
};

/** Writes that must be logged: the log call sits in the same function, before a delete and after a create. */
const logged: Record<string, string[]> = {
  "modules/honors/enrollment-repository.ts": ["setOwnerClassSelections"],
  "modules/honors/admin-placement.ts": ["placeYouthInClass", "removePickAsAdministrator"],
  "modules/honors/waitlist-repository.ts": ["acceptClassWaitlistOffer"],
};

describe("every path that creates or deletes an enrollment writes a change row (#1098)", () => {
  const sites = enrollmentWriteSites();

  it("finds the write paths it is meant to police", () => {
    const files = new Set(sites.map((site) => site.file));
    for (const expected of [...Object.keys(logged), ...Object.keys(exempt)]) expect(files, expected).toContain(expected);
  });

  it("knows every file that writes an enrollment: logged or deliberately exempt, nothing else", () => {
    const unknown = sites.filter((site) => !(site.file in logged) && !(site.file in exempt)).map((site) => `${site.file}:${site.line} ${site.method}`);
    expect(unknown).toEqual([]);
  });

  it("logs each write in the function that makes it: leaves before the delete, joins after the create", () => {
    for (const site of sites.filter((candidate) => candidate.file in logged)) {
      const label = `${site.file}:${site.line} ${site.method} in ${site.functionName}`;
      expect(logged[site.file], label).toContain(site.functionName);
      if (/^delete/.test(site.method)) expect(site.logPositions.some((position) => position < site.callPosition), `${label} logs the leave first`).toBe(true);
      else expect(site.logPositions.some((position) => position > site.callPosition), `${label} logs the join after`).toBe(true);
    }
  });

  it("covers the paths by name: the pick save, a placement, a removal, and a waitlist acceptance", () => {
    const wrote = (file: string, method: string, fn: string) => sites.some((site) => site.file === file && site.method === method && site.functionName === fn);
    expect(wrote("modules/honors/enrollment-repository.ts", "createManyAndReturn", "setOwnerClassSelections")).toBe(true);
    expect(wrote("modules/honors/enrollment-repository.ts", "deleteMany", "setOwnerClassSelections")).toBe(true);
    expect(wrote("modules/honors/admin-placement.ts", "create", "placeYouthInClass")).toBe(true);
    expect(wrote("modules/honors/admin-placement.ts", "deleteMany", "removePickAsAdministrator")).toBe(true);
    expect(wrote("modules/honors/waitlist-repository.ts", "create", "acceptClassWaitlistOffer")).toBe(true);
  });

  it("logs a placement and an acceptance as joined, and starts the emails only after the transaction", () => {
    for (const file of ["modules/honors/admin-placement.ts", "modules/honors/waitlist-repository.ts"]) {
      const text = readFileSync(path.join(root, file), "utf8");
      expect(text, file).toMatch(/recordClassChanges\(tx, \[\w+\.id\], "JOINED"/);
      expect(text, file).toContain("kickClassChangeEmails(classChangesLogged)");
    }
  });

  it("covers the writes that aren't an enrollment create or delete but move a youth on or off a class list", () => {
    const lifecycle = readFileSync(path.join(root, "modules/registrations/lifecycle-repository.ts"), "utf8");
    expect(lifecycle).toMatch(/recordRegistrationClassChanges\(tx, registration\.id, "LEFT", now\)/g);
    expect((lifecycle.match(/recordRegistrationClassChanges\(tx, registration\.id, "LEFT", now\)/g) ?? []).length).toBe(2);
    const restore = readFileSync(path.join(root, "modules/honors/restore-seats.ts"), "utf8");
    expect(restore).toContain('recordRegistrationClassChanges(tx, input.registrationId, "JOINED", input.now)');
    const amendments = readFileSync(path.join(root, "modules/registrations/amendments-repository.ts"), "utf8");
    expect(amendments).toMatch(/recordAttendeeClassChanges\(tx,[\s\S]*?"LEFT", now\)/);
  });

  it("the other ways an enrollment can disappear are all known: an attendee or registration delete cascades it", () => {
    const deleters: string[] = [];
    for (const dir of ["modules", "app", "lib"]) {
      for (const file of sourceFiles(path.join(root, dir))) {
        const text = readFileSync(file, "utf8");
        if (/\.(registrationAttendee|registration)\.(delete|deleteMany)\(/.test(text)) deleters.push(path.relative(root, file).split(path.sep).join("/"));
      }
    }
    expect(deleters.sort()).toEqual(["modules/events/deletion-repository.ts", "modules/registrations/amendments-repository.ts"]);
  });

  it("logging never sends: the log module imports no email code and the sender is never called inside a transaction", () => {
    const log = readFileSync(path.join(root, "modules/honors/class-change-log.ts"), "utf8");
    expect(log).not.toMatch(/communications|messageOutbox|isNotificationEnabled/);
    // The only reference to the sender is the kick that withClassChangeKick makes after its work has returned.
    expect(log.match(/class-change-emails/g)).toHaveLength(1);
    expect(log.indexOf("collector.run(ids, work)")).toBeLessThan(log.indexOf('import("@/modules/honors/class-change-emails")'));
    const lifecycle = readFileSync(path.join(root, "modules/registrations/lifecycle-repository.ts"), "utf8");
    expect(lifecycle).not.toContain("class-change-emails");
  });

  it("starts the right-away emails after the transaction for the paths nested several calls deep, through withClassChangeKick", () => {
    const wrapped = (file: string, names: string[]) => {
      const text = readFileSync(path.join(root, file), "utf8");
      for (const name of names) expect(text, file + " " + name).toContain("export const " + name + ": typeof " + name + "Inner = (...args) => withClassChangeKick(() => " + name + "Inner(...args));");
    };
    wrapped("modules/registrations/lifecycle-repository.ts", ["cancelRegistration", "moveRegistrationToWaitlist", "promoteRegistrationFromWaitlist", "reactivateRegistration"]);
    wrapped("modules/registrations/amendments-repository.ts", ["amendRegistration"]);
    wrapped("modules/imports/repository.ts", ["commitImportRun"]);
    wrapped("modules/club-transfers/repository.ts", ["approveRegistrationMove"]);
  });

  it("logs an import that cancels an active registration, and a member transfer that changes whether the pick is on a list", () => {
    const imports = readFileSync(path.join(root, "modules/imports/repository.ts"), "utf8");
    expect(imports).toContain('recordRegistrationClassChanges(tx, registration.id, "LEFT")');
    const transfers = readFileSync(path.join(root, "modules/club-transfers/repository.ts"), "utf8");
    expect(transfers).toContain('recordAttendeeClassChanges(tx, [attendeeId], "LEFT", now)');
    expect(transfers).toContain('recordAttendeeClassChanges(tx, [attendeeId], "JOINED", now)');
    // When both registrations are active (or both inactive) the pick's class and visibility are unchanged: nothing to log.
    expect(transfers).toMatch(/fromActive && !toActive/);
    expect(transfers).toMatch(/!fromActive && toActive/);
  });
});

describe("withClassChangeKick (#1098)", () => {
  it("kicks once, after the work, with only the ids written under it, and never for work that wrote none", async () => {
    const { withClassChangeKick } = await import("@/modules/honors/class-change-log");
    const client = logClient();
    let finished = false;
    mocks.kickClassChangeEmails.mockImplementation(async () => {
      expect(finished).toBe(true);
    });
    const result = await withClassChangeKick(async () => {
      await recordClassChanges(client as never, ["e-knots"], "JOINED", now);
      await recordAttendeeClassChanges(client as never, ["att-1"], "LEFT", now);
      finished = true;
      return "done";
    });
    expect(result).toBe("done");
    expect(mocks.kickClassChangeEmails).toHaveBeenCalledTimes(1);
    expect(mocks.kickClassChangeEmails).toHaveBeenCalledWith(["change-1", "change-1", "change-2"]);
    mocks.kickClassChangeEmails.mockClear();
    await withClassChangeKick(async () => undefined);
    expect(mocks.kickClassChangeEmails).not.toHaveBeenCalled();
  });
});
