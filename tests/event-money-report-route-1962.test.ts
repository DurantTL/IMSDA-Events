import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  exportEventMoneyReport: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/reporting/export-scope", () => ({ eventFileScope: async () => "test-event" }));
vi.mock("@/modules/payments/event-money-report-repository", () => ({ exportEventMoneyReport: mocks.exportEventMoneyReport }));

import { GET } from "@/app/api/events/[eventId]/exports/money-report/route";
import { buildMoneyReport } from "@/modules/payments/event-money-report-domain";

const params = { params: Promise.resolve({ eventId: "event_a" }) };
const request = () => new Request("https://events.imsda.test/api/events/event_a/exports/money-report");
const tally = () => ({ count: 0, cents: 0 });
const report = buildMoneyReport({
  registrations: [],
  uncountedPayments: { PENDING: tally(), FAILED: tally(), VOIDED: tally() },
  uncountedRefunds: { PENDING: tally(), FAILED: tally() },
  churchInvoices: { invoiceCount: 0, invoicedCents: 0, receivedCents: 0, stillOwedCents: 0, overpaidCents: 0 },
});

const signedIn = { user: { id: "user_one", email: "staff@example.test", displayName: "Staff", globalRole: "USER" } };
const asRole = (role: string, permissions: string[] = []) => mocks.findActiveMembership.mockResolvedValue({ role, status: "ACTIVE", permissions });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentSession.mockResolvedValue(signedIn);
  mocks.exportEventMoneyReport.mockResolvedValue({ eventName: "Test Event", report });
});

describe("event money report download (#1962)", () => {
  it("refuses a signed-out request and reads nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await GET(request(), params)).status).toBe(401);
    expect(mocks.exportEventMoneyReport).not.toHaveBeenCalled();
  });

  it("refuses someone with neither MANAGE_FINANCE nor VIEW_REPORTS", async () => {
    asRole("CHECK_IN_STAFF");
    expect((await GET(request(), params)).status).toBe(403);
    expect(mocks.exportEventMoneyReport).not.toHaveBeenCalled();
  });

  it("refuses someone with no active membership of the event", async () => {
    mocks.findActiveMembership.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(403);
    expect(mocks.exportEventMoneyReport).not.toHaveBeenCalled();
  });

  it.each([["FINANCE_MANAGER", []], ["REGISTRATION_MANAGER", []], ["CHECK_IN_STAFF", ["VIEW_REPORTS"]], ["CHECK_IN_STAFF", ["MANAGE_FINANCE"]]])("sends the CSV to %s with extra %j", async (role, extra) => {
    asRole(role, extra);
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("test-event-money-report-");
    expect(mocks.exportEventMoneyReport).toHaveBeenCalledWith("event_a", "user_one");
  });
});
