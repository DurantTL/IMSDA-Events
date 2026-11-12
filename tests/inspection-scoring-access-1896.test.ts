import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1896: who may switch Inspections, enter an inspection score and import scores. Runs the real services and routes against
 * a small in-memory stand-in for the database, so a refusal is proven to write nothing.
 */

const state = vi.hoisted(() => ({
  modules: new Set<string>(),
  published: false,
  activities: new Map<string, { id: string; name: string; inspectionKind: string | null; kind?: string; unit?: string; higherWins?: boolean }>(),
  scores: [] as Array<{ scoredEventId: string; subjectId: string; valueHundredths: number }>,
  clubs: [{ organizationId: "club-1", organization: { name: "Sample Eagles", orgCode: "SE1" } }, { organizationId: "club-2", organization: { name: "Sample Falcons", orgCode: null } }],
  audits: [] as Array<{ action: string; metadata: Record<string, unknown> }>,
}));

const mocks = vi.hoisted(() => ({
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(async (entry: { action: string; metadata: Record<string, unknown> }) => { state.audits.push(entry); }),
}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: <T,>(handler: T) => handler }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const makeDb = () => {
  const db = {
    event: { findFirst: vi.fn(async () => ({ id: "event-1", name: "Sample Camporee" })) },
    eventModule: {
      findUnique: vi.fn(async ({ where }: { where: { eventId_moduleKey: { moduleKey: string } } }) => (state.modules.has(where.eventId_moduleKey.moduleKey) ? { id: "m" } : null)),
      createMany: vi.fn(async ({ data }: { data: Array<{ moduleKey: string }> }) => { const before = state.modules.size; for (const row of data) state.modules.add(row.moduleKey); return { count: state.modules.size - before }; }),
      deleteMany: vi.fn(async ({ where }: { where: { moduleKey: string } }) => ({ count: state.modules.delete(where.moduleKey) ? 1 : 0 })),
    },
    eventScoringState: { findUnique: vi.fn(async () => (state.published ? { publishedAt: new Date("2026-11-01T00:00:00Z") } : null)) },
    clubEventRegistration: { findMany: vi.fn(async () => state.clubs) },
    scoredActivity: {
      findUnique: vi.fn(async ({ where }: { where: { eventId_inspectionKind?: { inspectionKind: string }; eventId_normalizedName?: { normalizedName: string } } }) => {
        const kind = where.eventId_inspectionKind?.inspectionKind;
        if (kind) return [...state.activities.values()].find((row) => row.inspectionKind === kind) ?? null;
        const name = where.eventId_normalizedName?.normalizedName;
        const row = name ? [...state.activities.values()].find((candidate) => candidate.name.toLowerCase() === name) : undefined;
        return row ? { kind: "CLUB", unit: "POINTS", higherWins: true, ...row } : null;
      }),
      count: vi.fn(async () => [...state.activities.values()].filter((row) => row.inspectionKind !== null).length),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; normalizedName?: string } }) => {
        if (!where.id) return null;
        const row = state.activities.get(where.id);
        return row ? { ...row, kind: "CLUB", unit: "POINTS", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, ribbonBands: [] } : null;
      }),
      findMany: vi.fn(async () => [...state.activities.values()]),
      aggregate: vi.fn(async () => ({ _max: { sortOrder: 0 } })),
      create: vi.fn(async ({ data }: { data: { name: string; inspectionKind: string } }) => {
        const row = { id: `act-${data.inspectionKind}`, name: data.name, inspectionKind: data.inspectionKind };
        state.activities.set(row.id, row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { inspectionKind: string } }) => { const row = state.activities.get(where.id); if (row) row.inspectionKind = data.inspectionKind; }),
    },
    activityScore: {
      findUnique: vi.fn(async ({ where }: { where: { scoredEventId_subjectId: { scoredEventId: string; subjectId: string } } }) => {
        const key = where.scoredEventId_subjectId;
        const found = state.scores.find((row) => row.scoredEventId === key.scoredEventId && row.subjectId === key.subjectId);
        return found ? { id: "score-1", valueHundredths: found.valueHundredths } : null;
      }),
      findMany: vi.fn(async () => state.scores),
      upsert: vi.fn(async ({ create, update }: { create: { scoredEventId: string; subjectId: string; valueHundredths: number }; update: { valueHundredths: number } }) => {
        const found = state.scores.find((row) => row.scoredEventId === create.scoredEventId && row.subjectId === create.subjectId);
        if (found) found.valueHundredths = update.valueHundredths;
        else state.scores.push({ scoredEventId: create.scoredEventId, subjectId: create.subjectId, valueHundredths: create.valueHundredths });
      }),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
};
let db = makeDb();
vi.mock("@/lib/prisma", () => ({ getPrisma: () => db }));

import { PUT as acPut } from "@/app/api/attendee/area-clubs/events/[eventId]/inspections/route";
import { PUT as acImportPut } from "@/app/api/attendee/area-clubs/events/[eventId]/inspections/import/route";
import { PUT as staffPut } from "@/app/api/events/[eventId]/inspections/route";
import { PUT as staffImportPut } from "@/app/api/events/[eventId]/inspections/import/route";
import { ensureInspectionEventsIfOn } from "@/modules/event-inspections/setup";
import { applyEventScoringAction } from "@/modules/event-scoring/service";
import { applyInspectionAction, applyInspectionImport, inspectionCapabilities, loadInspectionView, previewInspectionImport } from "@/modules/event-inspections/service";
import { EventScoringError, requireStaffScoringAccess, type EventScoringActor } from "@/modules/event-scoring/service";
import { AccessDeniedError } from "@/modules/access/authorization";

const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const put = (path: string, body: unknown) => new Request(`https://events.imsda.test${path}`, {
  method: "PUT",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const score = (value: string | null, subjectId = "club-1", inspection = "campsite") => ({ action: "saveScore" as const, entry: { inspection: inspection as "campsite", subjectId, value } });

const adminActor: EventScoringActor = { kind: "staff", userId: "u-admin", administrator: true };
const managerActor: EventScoringActor = { kind: "staff", userId: "u-manager", administrator: false };
const coordinator: EventScoringActor = { kind: "area-coordinator", accountId: "acct-ac" };

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb();
  state.modules = new Set(["event-scoring", "inspection-scoring"]);
  state.published = false;
  state.activities = new Map([
    ["act-campsite", { id: "act-campsite", name: "Campsite inspection", inspectionKind: "campsite" }],
    ["act-uniform", { id: "act-uniform", name: "Uniform inspection", inspectionKind: "uniform" }],
  ]);
  state.scores = [];
  state.audits = [];
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.isAreaCoordinator.mockResolvedValue(true);
});

describe("who may enter an inspection score (#1896)", () => {
  it("lets an active Area Coordinator (grant active, second sign-in step passed) enter a score", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    const response = await acPut(put("/api/attendee/area-clubs/events/event-1/inspections", score("85.5")), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, saved: { inspection: "campsite", subjectId: "club-1", text: "85.5" } });
    expect(state.scores).toEqual([{ scoredEventId: "act-campsite", subjectId: "club-1", valueHundredths: 8550 }]);
  });

  it.each([
    ["an Area Coordinator who has not passed the second sign-in step", null],
    ["an Area Coordinator whose grant was revoked", null],
    ["a plain attendee or club director", null],
  ])("refuses %s as not found and writes nothing", async (_who, account) => {
    mocks.currentAreaCoordinator.mockResolvedValue(account);
    for (const route of [acPut, acImportPut]) {
      const response = await route(put("/x", route === acPut ? score("80") : { action: "preview", csv: "club,inspection,score\nSample Eagles,campsite,80" }), ctx);
      expect(response.status).toBe(404);
    }
    expect(state.scores).toEqual([]);
    expect(db.activityScore.upsert).not.toHaveBeenCalled();
  });

  it("re-reads the grant in the service, so a coordinator revoked after the route check is refused", async () => {
    mocks.isAreaCoordinator.mockResolvedValue(false);
    await expect(applyInspectionAction(coordinator, "event-1", score("80"))).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(db.activityScore.upsert).not.toHaveBeenCalled();
  });

  it("lets a system administrator, the Clubs Administrator (Event Admin on club events) and a Registration Manager in; nobody else", async () => {
    const session = (id: string, globalRole?: "SYSTEM_ADMIN") => ({ user: { id, email: `${id}@example.test`, displayName: id, globalRole: globalRole ?? null } });
    const membership = (role: string, permissions: string[] = []) => async () => ({ eventId: "event-1", userId: "u", role, status: "ACTIVE", permissions }) as never;
    const gate = (role: string, permissions?: string[]) => requireStaffScoringAccess(session("u"), "event-1", membership(role, permissions));

    expect(await requireStaffScoringAccess(session("u-sys", "SYSTEM_ADMIN"), "event-1", async () => null)).toMatchObject({ kind: "staff", administrator: true });
    expect(await gate("EVENT_ADMIN")).toMatchObject({ administrator: true });
    expect(await gate("REGISTRATION_MANAGER")).toMatchObject({ administrator: false });
    expect(await gate("CHECK_IN_STAFF", ["MANAGE_REGISTRATION"])).toMatchObject({ administrator: false });
    await expect(gate("CHECK_IN_STAFF")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(gate("FINANCE_MANAGER")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requireStaffScoringAccess(session("u"), "event-1", async () => null)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requireStaffScoringAccess(session("u"), "event-1", async () => ({ eventId: "event-1", userId: "u", role: "EVENT_ADMIN", status: "INACTIVE", permissions: [] }) as never)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requireStaffScoringAccess({ user: null }, "event-1", async () => null)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("refuses the staff route to staff without the scoring permission and writes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u-door", email: "d@example.test", displayName: "Door", globalRole: null } });
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u-door", role: "CHECK_IN_STAFF", status: "ACTIVE", permissions: [] });
    const response = await staffPut(put("/api/events/event-1/inspections", score("80")), ctx);
    expect(response.status).toBe(403);
    expect(state.scores).toEqual([]);
  });

  it("lets staff with the registration permission enter scores through the staff route", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u-reg", email: "r@example.test", displayName: "Reg", globalRole: null } });
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u-reg", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] });
    expect((await staffPut(put("/api/events/event-1/inspections", score("77", "club-2", "uniform")), ctx)).status).toBe(200);
    expect(state.scores).toEqual([{ scoredEventId: "act-uniform", subjectId: "club-2", valueHundredths: 7700 }]);
  });

  it("checks the request origin first", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await acPut(put("/x", score("80")), ctx)).status).toBe(403);
    expect(mocks.currentAreaCoordinator).not.toHaveBeenCalled();
  });
});

describe("what each person may switch (#1896)", () => {
  it("gives the switch to coordinators and administrators and not to a Registration Manager", () => {
    expect(inspectionCapabilities(coordinator)).toEqual({ canSwitch: true, canEnter: true, canCorrectAfterPublish: false });
    expect(inspectionCapabilities(adminActor)).toEqual({ canSwitch: true, canEnter: true, canCorrectAfterPublish: true });
    expect(inspectionCapabilities(managerActor)).toEqual({ canSwitch: false, canEnter: true, canCorrectAfterPublish: false });
  });

  it("refuses a Registration Manager's switch", async () => {
    await expect(applyInspectionAction(managerActor, "event-1", { action: "switch", enabled: false })).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    expect(state.modules.has("inspection-scoring")).toBe(true);
  });

  it("will not switch on without Camporee scoring, then makes the two inspections once however often it is switched on", async () => {
    state.modules = new Set();
    state.activities = new Map();
    await expect(applyInspectionAction(adminActor, "event-1", { action: "switch", enabled: true })).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(db.scoredActivity.create).not.toHaveBeenCalled();
    state.modules.add("event-scoring");
    await applyInspectionAction(adminActor, "event-1", { action: "switch", enabled: true });
    await applyInspectionAction(coordinator, "event-1", { action: "switch", enabled: true });
    expect(db.scoredActivity.create).toHaveBeenCalledTimes(2);
    expect([...state.activities.values()].map((row) => row.name).sort()).toEqual(["Campsite inspection", "Uniform inspection"]);
    expect(state.audits.filter((entry) => entry.action === "EVENT_MODULE_ENABLED")).toHaveLength(1);
  });

  it("switches off and keeps every score and both events", async () => {
    state.scores = [{ scoredEventId: "act-campsite", subjectId: "club-1", valueHundredths: 9000 }];
    await applyInspectionAction(adminActor, "event-1", { action: "switch", enabled: false });
    expect(state.modules.has("inspection-scoring")).toBe(false);
    expect(state.scores).toHaveLength(1);
    expect(db.scoredActivity.create).not.toHaveBeenCalled();
    await expect(applyInspectionAction(adminActor, "event-1", score("80"))).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
  });
});

describe("entering a score (#1896)", () => {
  it("refuses an unregistered club and a bad score, and writes nothing", async () => {
    await expect(applyInspectionAction(adminActor, "event-1", score("80", "club-other"))).rejects.toMatchObject({ code: "INVALID", field: "subject" });
    await expect(applyInspectionAction(adminActor, "event-1", score("eighty"))).rejects.toMatchObject({ code: "INVALID", field: "value" });
    expect(state.scores).toEqual([]);
  });

  it("is refused when Camporee scoring is off, even with Inspections on", async () => {
    state.modules = new Set(["inspection-scoring"]);
    await expect(applyInspectionAction(adminActor, "event-1", score("80"))).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
  });

  it("follows the existing rule after results are published: administrators correct and it is audited, others are refused", async () => {
    state.published = true;
    await expect(applyInspectionAction(coordinator, "event-1", score("80"))).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(applyInspectionAction(managerActor, "event-1", score("80"))).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    expect(state.scores).toEqual([]);
    await applyInspectionAction(adminActor, "event-1", score("80"));
    expect(state.audits.map((entry) => entry.action)).toEqual(["EVENT_SCORING_SCORE_CORRECTED_AFTER_PUBLISH"]);
  });

  it("rejects an inspection name the tool does not have at the route", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    expect((await acPut(put("/x", score("80", "club-1", "kitchen")), ctx)).status).toBe(400);
  });

  it("loads the entry screen only for people who may enter", async () => {
    const view = await loadInspectionView("event-1", managerActor);
    expect(view.inspections.map((row) => row.key)).toEqual(["campsite", "uniform"]);
    expect(view.clubs.map((row) => row.name)).toEqual(["Sample Eagles", "Sample Falcons"]);
    mocks.isAreaCoordinator.mockResolvedValue(false);
    await expect(loadInspectionView("event-1", coordinator)).rejects.toBeInstanceOf(EventScoringError);
  });
});

describe("the CSV import (#1896)", () => {
  const csv = "club,inspection,score\nsample  EAGLES,Campsite,88\nSample Falcons,uniform,91.5\nNobody,campsite,70\nSample Eagles,uniform,x\n";

  it("previews every row and changes nothing", async () => {
    const preview = await previewInspectionImport(adminActor, "event-1", csv);
    expect(preview.rows.map((row) => row.status)).toEqual(["matched", "matched", "unknown_club", "bad_score"]);
    expect(state.scores).toEqual([]);
  });

  it("applies only the previewed file, matched rows only", async () => {
    const { digest } = await previewInspectionImport(coordinator, "event-1", csv);
    await expect(applyInspectionImport(coordinator, "event-1", csv.replace("88", "89"), digest)).rejects.toMatchObject({ code: "INVALID", field: "csv" });
    expect(state.scores).toEqual([]);
    expect(await applyInspectionImport(coordinator, "event-1", csv, digest)).toEqual({ applied: 2, unchanged: 0, failed: [], skipped: 2 });
    expect(state.scores).toEqual([
      { scoredEventId: "act-campsite", subjectId: "club-1", valueHundredths: 8800 },
      { scoredEventId: "act-uniform", subjectId: "club-2", valueHundredths: 9150 },
    ]);
    expect(state.audits.at(-1)).toMatchObject({ action: "EVENT_INSPECTION_IMPORT_APPLIED", metadata: { applied: 2, failed: 0, skipped: 2 } });
  });

  it("shows the score each row replaces and skips rows that repeat the score on file", async () => {
    state.scores = [{ scoredEventId: "act-campsite", subjectId: "club-1", valueHundredths: 8800 }, { scoredEventId: "act-uniform", subjectId: "club-2", valueHundredths: 9000 }];
    const preview = await previewInspectionImport(adminActor, "event-1", csv);
    expect(preview.rows.slice(0, 2).map((row) => [row.change, row.existingText])).toEqual([["same", "88"], ["changed", "90"]]);
    const result = await applyInspectionImport(adminActor, "event-1", csv, preview.digest);
    expect(result).toEqual({ applied: 1, unchanged: 1, failed: [], skipped: 2 });
    // A score that changed after the preview asks for a new preview.
    state.scores[0].valueHundredths = 7000;
    await expect(applyInspectionImport(adminActor, "event-1", csv, preview.digest)).rejects.toMatchObject({ code: "INVALID", field: "csv" });
  });

  it("reads the published state before each row, so rows after a publish follow the after-publish rule", async () => {
    const { digest } = await previewInspectionImport(coordinator, "event-1", csv);
    let reads = 0;
    db.eventScoringState.findUnique.mockImplementation(async () => (++reads >= 3 ? { publishedAt: new Date("2026-11-01T00:00:00Z") } : null));
    const result = await applyInspectionImport(coordinator, "event-1", csv, digest);
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(state.scores).toHaveLength(1);
  });

  it("is refused for a coordinator who is no longer one, and after publishing for anyone who cannot correct", async () => {
    mocks.isAreaCoordinator.mockResolvedValue(false);
    await expect(previewInspectionImport(coordinator, "event-1", csv)).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    mocks.isAreaCoordinator.mockResolvedValue(true);
    const { digest } = await previewInspectionImport(coordinator, "event-1", csv);
    state.published = true;
    await expect(applyInspectionImport(coordinator, "event-1", csv, digest)).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    expect(state.scores).toEqual([]);
  });

  it("is refused while Inspections is off", async () => {
    state.modules = new Set(["event-scoring"]);
    await expect(previewInspectionImport(adminActor, "event-1", csv)).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
  });
});

describe("routes and the staff import (#1896)", () => {
  const staffSession = (role: string) => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u-x", email: "x@example.test", displayName: "X", globalRole: null } });
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u-x", role, status: "ACTIVE", permissions: [] });
  };
  const preview = { action: "preview", csv: "club,inspection,score\nSample Eagles,campsite,80" };

  it("refuses the staff import to staff without the scoring permission, for preview and apply", async () => {
    staffSession("CHECK_IN_STAFF");
    expect((await staffImportPut(put("/x", preview), ctx)).status).toBe(403);
    expect((await staffImportPut(put("/x", { action: "apply", csv: preview.csv, digest: "0".repeat(64) }), ctx)).status).toBe(403);
    expect(state.scores).toEqual([]);
  });

  it("lets a Registration Manager preview and import", async () => {
    staffSession("REGISTRATION_MANAGER");
    const first = await (await staffImportPut(put("/x", preview), ctx)).json() as { preview: { digest: string } };
    expect((await staffImportPut(put("/x", { action: "apply", csv: preview.csv, digest: first.preview.digest }), ctx)).status).toBe(200);
    expect(state.scores).toHaveLength(1);
  });

  it("answers not found for an archived or general event on every new route", async () => {
    db.event.findFirst.mockResolvedValue(null as never);
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    expect((await acPut(put("/x", score("80")), ctx)).status).toBe(404);
    expect((await acImportPut(put("/x", preview), ctx)).status).toBe(404);
    staffSession("EVENT_ADMIN");
    expect((await staffPut(put("/x", score("80")), ctx)).status).toBe(404);
    expect((await staffImportPut(put("/x", preview), ctx)).status).toBe(404);
  });
});

describe("the two events exist however the tool was switched on (#1896)", () => {
  it("makes them when the screen opens on a tool that is on without them, once", async () => {
    state.activities = new Map();
    const view = await loadInspectionView("event-1", adminActor);
    expect(db.scoredActivity.create).toHaveBeenCalledTimes(2);
    expect(view.inspections.map((row) => row.key)).toEqual(["campsite", "uniform"]);
    await loadInspectionView("event-1", adminActor);
    expect(db.scoredActivity.create).toHaveBeenCalledTimes(2);
  });

  it("makes the missing event when a score is saved", async () => {
    state.activities = new Map();
    await applyInspectionAction(coordinator, "event-1", score("80"));
    expect(db.scoredActivity.create).toHaveBeenCalledTimes(2);
    expect(state.scores).toHaveLength(1);
  });

  it("makes them from the shared helper only when the module is on", async () => {
    state.activities = new Map();
    state.modules = new Set(["event-scoring"]);
    await ensureInspectionEventsIfOn(db as never, "event-1", "u-admin");
    expect(db.scoredActivity.create).not.toHaveBeenCalled();
    state.modules.add("inspection-scoring");
    await ensureInspectionEventsIfOn(db as never, "event-1", "u-admin");
    expect(db.scoredActivity.create).toHaveBeenCalledTimes(2);
    expect(state.audits.filter((entry) => entry.action === "EVENT_INSPECTION_ACTIVITY_ADDED")).toHaveLength(2);
  });

  it("is called from every path that can switch the module on", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    expect(read("modules/event-modules/service.ts")).toContain('key === "inspection-scoring") await ensureInspectionEventsIfOn');
    expect(read("modules/event-debriefs/lifecycle.ts")).toContain('includes("inspection-scoring")) await ensureInspectionEventsIfOn');
    expect(read("modules/event-clones/repository.ts")).toContain("await ensureInspectionEventsIfOn(tx, event.id, actorUserId)");
    expect(read("modules/event-modules/requests.ts")).toContain("enableModuleInTransaction");
  });

  it("adopts a same-named plain scored event, but never one that is already an inspection or has other settings", async () => {
    state.activities = new Map([["old-1", { id: "old-1", name: "Campsite inspection", inspectionKind: null }]]);
    await applyInspectionAction(adminActor, "event-1", { action: "switch", enabled: true });
    expect(state.activities.get("old-1")!.inspectionKind).toBe("campsite");
    expect(state.audits.some((entry) => entry.action === "EVENT_INSPECTION_ACTIVITY_ADOPTED")).toBe(true);
    expect(db.scoredActivity.create).toHaveBeenCalledTimes(1);

    state.activities = new Map([["odd-1", { id: "odd-1", name: "Campsite inspection", inspectionKind: null, unit: "FEET" }]]);
    await expect(applyInspectionAction(adminActor, "event-1", { action: "switch", enabled: true })).rejects.toMatchObject({ code: "INVALID" });
    expect(state.activities.get("odd-1")!.inspectionKind).toBeNull();

    state.activities = new Map([["odd-2", { id: "odd-2", name: "Campsite inspection", inspectionKind: "uniform" }]]);
    await expect(applyInspectionAction(adminActor, "event-1", { action: "switch", enabled: true })).rejects.toMatchObject({ code: "INVALID" });
    expect(state.activities.get("odd-2")!.inspectionKind).toBe("uniform");
  });

  it("re-reads the switch when two switches collide", async () => {
    state.modules = new Set(["event-scoring"]);
    db.$transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await applyInspectionAction(adminActor, "event-1", { action: "switch", enabled: true })).toEqual({ enabled: false });
  });
});

describe("an inspection event keeps its shape in Camporee scoring (#1896)", () => {
  it("refuses to change an inspection's kind, unit or direction from the scored-event editor", async () => {
    db.scoredActivity.findFirst.mockImplementation((async ({ where }: { where: { id?: string; normalizedName?: string } }) =>
      where.id === "act-campsite" ? { id: "act-campsite", kind: "CLUB", unit: "POINTS", higherWins: true, inspectionKind: "campsite", _count: { scores: 0 } } : null) as never);
    const base = { id: "act-campsite", name: "Campsite inspection", kind: "CLUB" as const, unit: "POINTS" as const, higherWins: true, ribbonMode: "PLACES" as const, ribbonPlaces: 3, ribbonBands: [] };
    await expect(applyEventScoringAction(adminActor, "event-1", { action: "saveScoredEvent", scoredEvent: { ...base, unit: "FEET" } })).rejects.toMatchObject({ code: "INVALID", field: "kind" });
    await expect(applyEventScoringAction(adminActor, "event-1", { action: "saveScoredEvent", scoredEvent: { ...base, higherWins: false } })).rejects.toMatchObject({ code: "INVALID" });
    expect(db.scoredActivity.update).not.toHaveBeenCalled();
    // The same shape (a ribbon change) is still fine.
    await applyEventScoringAction(adminActor, "event-1", { action: "saveScoredEvent", scoredEvent: { ...base, ribbonPlaces: 2 } }).catch(() => undefined);
    expect(db.scoredActivity.update).toHaveBeenCalledTimes(1);
  });
});

describe("how the tool is built (#1896)", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("switches only through the shared helper and writes scores only through Camporee scoring", () => {
    const service = read("modules/event-inspections/service.ts");
    expect(service).toContain("writeScopedModuleSwitch");
    expect(service).toContain("enterScore(");
    expect(service).not.toContain("activityScore.upsert");
    expect(service).not.toContain("eventModule.create");
    expect(service).not.toMatch(/clubEventPointAward|attendancePoints|event-points/);
  });
  it("uses the scoring gates on every route", () => {
    for (const path of ["app/api/events/[eventId]/inspections/route.ts", "app/api/events/[eventId]/inspections/import/route.ts"]) expect(read(path)).toContain("requireStaffScoringAccess(");
    for (const path of ["app/api/attendee/area-clubs/events/[eventId]/inspections/route.ts", "app/api/attendee/area-clubs/events/[eventId]/inspections/import/route.ts"]) expect(read(path)).toContain("requireAreaCoordinatorScoringActor(");
  });
});
