import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findActiveMembership: vi.fn(),
  resolveEventContext: vi.fn(),
  writeAuditLog: vi.fn(),
  loadKitchenCountsReport: vi.fn(),
  db: {} as Record<string, unknown>,
  role: "FINANCE_MANAGER" as string,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn(async () => ({ user: { id: "user_f", email: "f@example.test", displayName: "Fran Finance", globalRole: null } })) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership, isClubAudienceEvent: vi.fn() }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/meals/kitchen-counts-repository", () => ({ loadKitchenCountsReport: mocks.loadKitchenCountsReport }));

import { renderToStaticMarkup } from "react-dom/server";
import { POST as saveReview } from "@/app/api/events/[eventId]/meals/closeout-review/route";
import { GET as closeoutCsv } from "@/app/api/events/[eventId]/exports/meals-closeout/route";
import MealCloseoutPage from "@/app/(workspace)/more/kitchen-report/closeout/page";
import { loadMealCloseout } from "@/modules/meals/closeout-repository";

type Row = Record<string, unknown>;
let reviews: Row[];
let sequence: number;

const lunch = { service: { serviceDate: "2026-10-15" } };
function fakeDb(overrides: { ledger?: Row[] } = {}) {
  return {
    eventMealSelection: { findMany: vi.fn(async () => [{ id: "sel1", mealType: "LUNCH", source: "REGISTRATION_FORM", payer: "ATTENDEE", status: "ACTIVE", quantity: 2, unitPriceCents: 800, conferenceRateCents: 0, ...lunch }]) },
    eventMealLedgerEntry: {
      findMany: vi.fn(async () => overrides.ledger ?? [{ id: "led1", selectionId: "sel1", mealType: "LUNCH", kind: "CHARGE", amountCents: 1500, payer: "ATTENDEE", settlement: "IN_REGISTRATION_PRICING", registrationAdjustmentId: null, selection: lunch }]),
    },
    registrationAdjustment: { findMany: vi.fn(async () => []) },
    eventMealTicket: { findMany: vi.fn(async () => [{ id: "t1", number: 1, selectionId: "sel1", cancelledAt: null }, { id: "t2", number: 2, selectionId: "sel1", cancelledAt: null }]) },
    eventMealRedemption: { findMany: vi.fn(async () => [{ ticketId: "t1", kind: "REDEEMED" }]) },
    user: { findMany: vi.fn(async () => [{ id: "user_f", displayName: "Fran Finance" }]) },
    eventMealCloseoutReview: {
      findMany: vi.fn(async () => reviews.map((row) => ({ ...row }))),
      create: vi.fn(async ({ data }: { data: Row }) => {
        sequence += 1;
        const row = { ...data, id: `rev${sequence}`, createdAt: new Date(Date.UTC(2026, 9, 16, 12, sequence)) };
        reviews.push(row);
        return { id: row.id };
      }),
    },
  };
}

const params = { params: Promise.resolve({ eventId: "evt" }) };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/events/evt/meals/closeout-review", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  reviews = []; sequence = 0;
  mocks.db = fakeDb();
  mocks.role = "FINANCE_MANAGER";
  mocks.findActiveMembership.mockImplementation(async () => ({ eventId: "evt", userId: "user_f", role: mocks.role, status: "ACTIVE", permissions: [] }));
  mocks.loadKitchenCountsReport.mockResolvedValue({ rows: [], totals: {}, timeZone: "America/Chicago" });
});

describe("loading the closeout", () => {
  it("builds the projection from the stored records and writes nothing", async () => {
    const closeout = await loadMealCloseout("evt");
    expect(closeout.rows[0]).toMatchObject({ net: 1500, ordered: { paid: 2 }, served: { paid: 1 } });
    expect(closeout.exceptions.map((exception) => exception.code)).toEqual(expect.arrayContaining(["LEDGER_MISMATCH", "PREPARED_MISSING"]));
    expect(closeout.openExceptions).toBe(closeout.exceptions.length);
    expect(Object.keys(mocks.db.eventMealLedgerEntry as Row)).toEqual(["findMany"]);
    expect(Object.keys(mocks.db.eventMealSelection as Row)).toEqual(["findMany"]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("repeats the same totals and digest while the source data is unchanged", async () => {
    const a = await loadMealCloseout("evt");
    const b = await loadMealCloseout("evt");
    expect(b.totals).toEqual(a.totals);
    expect(b.sources.digest).toBe(a.sources.digest);
  });
});

describe("reviewing an exception", () => {
  async function mismatch() {
    const closeout = await loadMealCloseout("evt");
    return closeout.exceptions.find((exception) => exception.code === "LEDGER_MISMATCH")!;
  }

  it("appends a review with who and when, audits without the note, and changes no money record", async () => {
    const exception = await mismatch();
    const response = await saveReview(post({ exceptionKey: exception.key, detailDigest: exception.detailDigest, status: "ACKNOWLEDGED", note: "Matches the paper tally." }), params);
    expect(response.status).toBe(200);
    expect(reviews).toEqual([expect.objectContaining({ eventId: "evt", exceptionKey: exception.key, status: "ACKNOWLEDGED", reviewedByUserId: "user_f", note: "Matches the paper tally." })]);
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "meals.closeout_review", actorUserId: "user_f", eventId: "evt" });
    expect(JSON.stringify(audit)).not.toContain("paper tally");
    const after = await loadMealCloseout("evt");
    const reviewed = after.exceptions.find((candidate) => candidate.key === exception.key)!;
    expect(reviewed).toMatchObject({ state: "ACKNOWLEDGED", current: { reviewedBy: "Fran Finance", note: "Matches the paper tally." } });
    expect(after.totals).toEqual((await loadMealCloseout("evt")).totals);
    expect(Object.keys(mocks.db.eventMealCloseoutReview as Row)).toEqual(["findMany", "create"]);
  });

  it("keeps the earlier review when an exception is reopened", async () => {
    const exception = await mismatch();
    const body = { exceptionKey: exception.key, detailDigest: exception.detailDigest, note: "Checked." };
    await saveReview(post({ ...body, status: "ACKNOWLEDGED" }), params);
    await saveReview(post({ ...body, status: "REOPENED", note: "Till was off." }), params);
    expect(reviews).toHaveLength(2);
    const reviewed = (await loadMealCloseout("evt")).exceptions.find((candidate) => candidate.key === exception.key)!;
    expect(reviewed.state).toBe("OPEN");
    expect(reviewed.history.map((review) => review.status)).toEqual(["ACKNOWLEDGED", "REOPENED"]);
  });

  it("refuses an exception that no longer exists or whose figures changed, without writing", async () => {
    const exception = await mismatch();
    const gone = await saveReview(post({ exceptionKey: "LEDGER_MISMATCH:nope", detailDigest: "x", status: "ACKNOWLEDGED", note: "n" }), params);
    expect(gone.status).toBe(400);
    const stale = await saveReview(post({ exceptionKey: exception.key, detailDigest: "older-figures", status: "ACKNOWLEDGED", note: "n" }), params);
    expect(stale.status).toBe(409);
    expect(reviews).toHaveLength(0);
  });

  it("refuses a missing note, unknown fields, other origins and every role but finance, before any write", async () => {
    const exception = await mismatch();
    const ok = { exceptionKey: exception.key, detailDigest: exception.detailDigest, status: "ACKNOWLEDGED", note: "Checked." };
    expect((await saveReview(post({ ...ok, note: " " }), params)).status).toBe(400);
    expect((await saveReview(post({ ...ok, eventId: "other" }), params)).status).toBe(400);
    expect((await saveReview(post(ok, { origin: "https://evil.example" }), params)).status).toBeGreaterThanOrEqual(400);
    for (const role of ["KITCHEN_STAFF", "REGISTRATION_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"]) {
      mocks.role = role;
      expect((await saveReview(post(ok), params)).status).toBe(403);
    }
    expect(reviews).toHaveLength(0);
  });
});

describe("who can open the closeout", () => {
  it("downloads the money and exceptions CSVs for finance, with matching totals, and refuses kitchen and report-only roles", async () => {
    const money = await closeoutCsv(new Request("http://localhost/x"), params);
    expect(money.status).toBe(200);
    expect(money.headers.get("content-disposition")).toContain("evt-meals-closeout.csv");
    const text = await money.text();
    const closeout = await loadMealCloseout("evt");
    expect(text).toContain(`"All services","${closeout.totals.charges / 100}"`);
    const exceptions = await closeoutCsv(new Request("http://localhost/x?part=exceptions"), params);
    expect(exceptions.headers.get("content-disposition")).toContain("exceptions.csv");
    expect(await exceptions.text()).toContain("LEDGER_MISMATCH");
    for (const role of ["KITCHEN_STAFF", "REGISTRATION_MANAGER", "READ_ONLY_STAFF"]) {
      mocks.role = role;
      expect((await closeoutCsv(new Request("http://localhost/x"), params)).status).toBe(403);
    }
  });

  it("renders the page for finance and shows a restricted page, with no figures, to kitchen and report-only access", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camporee" }, permissions: ["MANAGE_FINANCE", "VIEW_REPORTS"] });
    const html = renderToStaticMarkup(await MealCloseoutPage({ searchParams: Promise.resolve({ event: "evt" }) }));
    expect(html).toContain("Meal closeout");
    expect(html).toContain("Exceptions to review");
    expect(html).toContain("$15.00");
    expect(html.match(/primary-button/g) ?? []).toHaveLength(0);
    for (const permissions of [["MANAGE_KITCHEN_COUNTS"], ["VIEW_REPORTS"], ["VIEW_EVENT", "VIEW_REPORTS"]]) {
      mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camporee" }, permissions });
      mocks.loadKitchenCountsReport.mockClear();
      const restricted = renderToStaticMarkup(await MealCloseoutPage({ searchParams: Promise.resolve({ event: "evt" }) }));
      expect(restricted).toContain("restricted");
      expect(restricted).not.toContain("$15.00");
      expect(mocks.loadKitchenCountsReport).not.toHaveBeenCalled();
    }
  });
});
