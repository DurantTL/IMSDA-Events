import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findActiveMembership: vi.fn(),
  resolveEventContext: vi.fn(),
  writeAuditLog: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }),
  loadServedReport: vi.fn(),
  db: {} as Record<string, unknown>,
  role: "KITCHEN_STAFF" as string,
  extra: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn(async () => ({ user: { id: "user_k", email: "k@example.test", displayName: "Kim Kitchen", globalRole: null } })) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership, isClubAudienceEvent: vi.fn() }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/meals/scanner-import-repository", () => ({ loadServedReport: mocks.loadServedReport, loadServedDrillDown: vi.fn() }));

import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
import { rolePermissions, type EventPermission, type EventRole } from "@/modules/access/permissions";
import { POST as saveCount } from "@/app/api/events/[eventId]/meals/kitchen-counts/route";
import { GET as countsCsv } from "@/app/api/events/[eventId]/exports/kitchen-counts/route";
import { GET as registrationsCsv } from "@/app/api/events/[eventId]/exports/registrations/route";
import { GET as attendeesCsv } from "@/app/api/events/[eventId]/exports/attendees/route";
import { GET as kitchenCsv } from "@/app/api/events/[eventId]/exports/kitchen/route";
import { GET as mealTicketsCsv } from "@/app/api/events/[eventId]/exports/meal-tickets/route";
import { GET as servedCsv } from "@/app/api/events/[eventId]/exports/meals-served/route";
import { POST as scannerImport } from "@/app/api/events/[eventId]/meals/scanner-import/route";
import KitchenCountsPage from "@/app/(workspace)/more/kitchen-report/counts/page";
import KitchenReportPage from "@/app/(workspace)/more/kitchen-report/page";
import PeoplePage from "@/app/(workspace)/people/page";
import { loadKitchenCountsReport, recordKitchenCount } from "@/modules/meals/kitchen-counts-repository";

type Row = Record<string, unknown>;
let rows: Row[];
let sequence: number;

const key = (row: Row) => `${row.serviceDate}|${row.mealType}|${row.kind}`;
function fakeDb() {
  const db = {
    event: { findUnique: vi.fn(async () => ({ timezone: "America/Chicago" })) },
    user: { findMany: vi.fn(async () => [{ id: "user_k", displayName: "Kim Kitchen" }, { id: "user_l", displayName: "Lee Lead" }]) },
    eventMealKitchenCount: {
      findMany: vi.fn(async (args: { where: Row }) => rows.filter((row) => row.eventId === args.where.eventId
        && (args.where.kind === undefined || (row.kind === args.where.kind && row.serviceDate === args.where.serviceDate && row.mealType === args.where.mealType)))
        .map((row) => ({ ...row }))),
      create: vi.fn(async ({ data }: { data: Row }) => {
        // The database's own rules: one chain start per (service, kind), one successor per entry.
        if (data.supersedesId == null && rows.some((row) => key(row) === key(data) && row.eventId === data.eventId && row.supersedesId == null)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`eventId`,`serviceDate`)", { code: "P2002", clientVersion: "test" });
        }
        if (data.supersedesId && rows.some((row) => row.supersedesId === data.supersedesId)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`supersedesId`)", { code: "P2002", clientVersion: "test" });
        }
        sequence += 1;
        const row = { ...data, id: `k${sequence}`, createdAt: new Date(Date.UTC(2026, 9, 15, 18, sequence)) };
        rows.push(row);
        return { id: row.id };
      }),
    },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(db)),
  };
  return db;
}

const served = (lunchServed: number) => ({
  rows: [{ key: "2026-10-15:LUNCH", serviceDate: "2026-10-15", mealType: "LUNCH", label: "2026-10-15 · Lunch", sold: { paying: 9, conference: 1, total: 10 }, served: { paying: lunchServed, conference: 0, total: lunchServed }, servedOnCancelled: { paying: 0, conference: 0, total: 0 }, notUsed: { paying: 0, conference: 0, total: 0 } }],
  totals: {}, anyServed: true, anyImport: true,
});

const params = { params: Promise.resolve({ eventId: "evt" }) };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/events/evt/meals/kitchen-counts", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body: JSON.stringify(body) });
const body = (over: Row = {}) => ({ serviceKey: "2026-10-15:LUNCH", kind: "PREPARED", quantity: 12, note: "First pan", supersedesId: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  rows = []; sequence = 0;
  mocks.db = fakeDb();
  mocks.role = "KITCHEN_STAFF"; mocks.extra = [];
  mocks.findActiveMembership.mockImplementation(async () => ({ eventId: "evt", userId: "user_k", role: mocks.role, status: "ACTIVE", permissions: mocks.extra }));
  mocks.loadServedReport.mockResolvedValue(served(8));
});

describe("entering and correcting counts", () => {
  it("records the first entry with who and when, and audits figures without the note", async () => {
    const response = await saveCount(post(body()), params);
    expect(response.status).toBe(200);
    expect(rows).toEqual([expect.objectContaining({ eventId: "evt", serviceDate: "2026-10-15", mealType: "LUNCH", kind: "PREPARED", quantity: 12, note: "First pan", enteredByUserId: "user_k", supersedesId: null })]);
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "meals.kitchen_count", actorUserId: "user_k", eventId: "evt", metadata: { quantity: 12, previous: null } });
    expect(JSON.stringify(audit)).not.toContain("First pan");
  });

  it("stores a correction as a new entry that supersedes the old one, and keeps both", async () => {
    await saveCount(post(body()), params);
    const first = rows[0]!.id;
    const response = await saveCount(post(body({ quantity: 10, note: "Recount", supersedesId: first })), params);
    expect(response.status).toBe(200);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ quantity: 12 });
    expect(rows[1]).toMatchObject({ quantity: 10, supersedesId: first });
    const report = await loadKitchenCountsReport("evt");
    const lunch = report.rows[0]!;
    expect(lunch.counts.PREPARED).toMatchObject({ quantity: 10, note: "Recount" });
    expect(lunch.history.map((entry) => [entry.quantity, entry.superseded])).toEqual([[12, true], [10, false]]);
    expect(lunch.history[0]).toMatchObject({ enteredBy: "Kim Kitchen" });
    expect(lunch.history[0]!.enteredAt).toBe("2026-10-15T18:01:00.000Z");
  });

  it("keeps prepared, wasted, donated and transferred apart and never changes served", async () => {
    for (const [kind, quantity] of [["PREPARED", 12], ["WASTED", 1], ["DONATED", 2], ["TRANSFERRED", 3]] as const) {
      expect((await saveCount(post(body({ kind, quantity, note: null })), params)).status).toBe(200);
    }
    const lunch = (await loadKitchenCountsReport("evt")).rows[0]!;
    expect(lunch).toMatchObject({ ordered: 10, served: 8, variance: 4 });
    expect(Object.values(lunch.counts).map((cell) => cell.quantity).sort((a, b) => a - b)).toEqual([1, 2, 3, 12]);
    expect(mocks.loadServedReport).toHaveBeenCalled();
    expect(Object.keys((mocks.db.eventMealKitchenCount as Row))).toEqual(["findMany", "create"]);
  });

  it("refuses a correction made from a stale view, and a second first entry, without writing", async () => {
    await saveCount(post(body()), params);
    const stale = await saveCount(post(body({ quantity: 11 })), params);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "CONFLICT" });
    const wrongTarget = await saveCount(post(body({ quantity: 11, supersedesId: "k-not-current" })), params);
    expect(wrongTarget.status).toBe(409);
    expect(rows).toHaveLength(1);
  });

  it("turns a unique violation from a race into a plain conflict", async () => {
    await saveCount(post(body()), params);
    const first = rows[0]!.id;
    // Another request lands between the read and the insert: the database refuses the fork.
    rows.push({ ...rows[0]!, id: "k-other", supersedesId: first, quantity: 9 });
    (mocks.db.eventMealKitchenCount as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValueOnce([{ id: first, quantity: 12, note: "First pan", supersedesId: null }]);
    const response = await saveCount(post(body({ quantity: 8, supersedesId: first })), params);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toMatch(/Unique constraint|supersedesId/);
  });

  it("writes nothing when the same figure and note are saved again", async () => {
    await saveCount(post(body()), params);
    const again = await recordKitchenCount({ eventId: "evt", userId: "user_k", entry: { serviceKey: "2026-10-15:LUNCH", kind: "PREPARED", quantity: 12, note: "First pan", supersedesId: rows[0]!.id as string } });
    expect(again).toEqual({ changed: false, entryId: rows[0]!.id });
    expect(rows).toHaveLength(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("accepts zero as a real count and refuses bad input before any write", async () => {
    expect((await saveCount(post(body({ quantity: 0 })), params)).status).toBe(200);
    rows = [];
    for (const bad of [{ quantity: -1 }, { quantity: 2.5 }, { kind: "SERVED" }, { serviceKey: "nope" }, { eventId: "other" }]) {
      expect((await saveCount(post(body(bad)), params)).status).toBe(400);
    }
    expect(rows).toHaveLength(0);
  });

  it("takes the event from the URL, never the body, and rejects a cross-origin post", async () => {
    await saveCount(post({ ...body(), eventId: "another" }), params);
    expect(rows).toHaveLength(0);
    expect((await saveCount(post(body(), { origin: "https://evil.example" }), params)).status).toBeGreaterThanOrEqual(400);
    expect(rows).toHaveLength(0);
    await saveCount(post(body()), params);
    expect(rows[0]).toMatchObject({ eventId: "evt" });
  });
});

describe("who may enter counts, and what that role cannot open", () => {
  const asRole = (role: EventRole, extra: EventPermission[] = []) => { mocks.role = role; mocks.extra = extra; };

  it("lets kitchen staff and event admins save and download, and refuses everyone else, before any write", async () => {
    for (const role of ["KITCHEN_STAFF", "EVENT_ADMIN"] as const) {
      asRole(role);
      rows = [];
      expect((await saveCount(post(body()), params)).status).toBe(200);
      expect((await countsCsv(new Request("http://localhost/x"), params)).status).toBe(200);
    }
    rows = [];
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"] as const) {
      asRole(role);
      expect((await saveCount(post(body()), params)).status).toBe(403);
    }
    // Report access alone reads the CSV but cannot enter counts.
    asRole("REGISTRATION_MANAGER");
    expect((await countsCsv(new Request("http://localhost/x"), params)).status).toBe(200);
    asRole("READ_ONLY_STAFF");
    expect((await countsCsv(new Request("http://localhost/x"), params)).status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it("opens no registration, attendee, kitchen report, ticket or scanner route for kitchen staff", async () => {
    asRole("KITCHEN_STAFF");
    const get = new Request("http://localhost/x");
    for (const handler of [registrationsCsv, attendeesCsv, kitchenCsv, mealTicketsCsv, servedCsv]) {
      const response = await (handler as (request: Request, context: typeof params) => Promise<Response>)(get, params);
      expect(response.status).toBe(403);
    }
    const form = new FormData();
    form.set("step", "preview");
    const upload = await scannerImport(new Request("http://localhost/x", { method: "POST", body: form, headers: { origin: "http://localhost" } }), params);
    expect(upload.status).toBe(403);
  });

  it("opens the counts page but neither the people page nor the report's registration data", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camp", slug: "syn", timezone: "America/Chicago" }, permissions: [...rolePermissions.KITCHEN_STAFF] });
    const html = renderToStaticMarkup(await KitchenCountsPage({ searchParams: Promise.resolve({ event: "evt" }) }));
    expect(html).toContain("Kitchen counts");
    expect(html).toContain('name="quantity"');
    // Each count is its own form with an always-present status region, the service in every name, and the note guidance.
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('<span class="sr-only"> for 2026-10-15 · Lunch</span>');
    expect(html).toContain("Counts context only. No names or health details.");
    const people = renderToStaticMarkup(await PeoplePage({ searchParams: Promise.resolve({ event: "evt" }) } as never));
    expect(people).toContain("restricted");
    await expect(KitchenReportPage({ searchParams: Promise.resolve({ event: "evt" }) })).rejects.toThrow("REDIRECT:/more/kitchen-report/counts?event=evt");
  });

  it("shows report viewers the table with no entry forms, and refuses people with neither permission", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camp" }, permissions: ["VIEW_EVENT", "VIEW_REPORTS"] });
    const html = renderToStaticMarkup(await KitchenCountsPage({ searchParams: Promise.resolve({ event: "evt" }) }));
    expect(html).toContain("Kitchen counts by service");
    expect(html).not.toContain('name="quantity"');
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camp" }, permissions: ["VIEW_EVENT"] });
    expect(renderToStaticMarkup(await KitchenCountsPage({ searchParams: Promise.resolve({ event: "evt" }) }))).toContain("restricted");
  });

  it("shows the columns with their definitions and the variance", async () => {
    rows.push({ id: "k1", eventId: "evt", serviceDate: "2026-10-15", mealType: "LUNCH", kind: "PREPARED", quantity: 12, note: null, enteredByUserId: "user_k", supersedesId: null, createdAt: new Date("2026-10-15T18:00:00Z") });
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camp" }, permissions: ["MANAGE_KITCHEN_COUNTS"] });
    const html = renderToStaticMarkup(await KitchenCountsPage({ searchParams: Promise.resolve({ event: "evt" }) }));
    for (const heading of ["Ordered", "Served", "Prepared", "Wasted", "Donated", "Transferred", "Variance"]) expect(html).toContain(`>${heading}</th>`);
    expect(html).toContain("Variance: prepared minus served");
    expect(html).toContain("+4");
    expect(html).toContain("Entered by Kim Kitchen");
  });
});
