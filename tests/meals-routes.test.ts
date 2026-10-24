import { beforeEach, describe, expect, it, vi } from "vitest";
import { MealError } from "@/modules/meals/errors";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  config: {
    createMealService: vi.fn(), updateMealService: vi.fn(), reinstateMealService: vi.fn(), createMealPlan: vi.fn(), updateMealPlan: vi.fn(),
    setMealPlanServices: vi.fn(), setMealPrice: vi.fn(), removeMealPrice: vi.fn(), applyMealPreset: vi.fn(), loadTicketPrices: vi.fn(),
  },
  selection: {
    cancelMealService: vi.fn(), createMealOrder: vi.fn(), changeMealQuantity: vi.fn(), cancelMealSelection: vi.fn(), changeMealPlan: vi.fn(),
    substituteMealSelection: vi.fn(), entitleAttendeeToPlan: vi.fn(),
  },
  view: { loadMealView: vi.fn(), loadRegistrationMeals: vi.fn(), mealTicketsCsv: vi.fn(), mealTicketSummaryCsv: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/meals/config-repository", () => mocks.config);
vi.mock("@/modules/meals/selection-repository", () => mocks.selection);
vi.mock("@/modules/meals/view-repository", () => mocks.view);

type Role = "EVENT_ADMIN" | "FINANCE_MANAGER" | "REGISTRATION_MANAGER" | "CHECK_IN_STAFF" | "READ_ONLY_STAFF";

type Case = {
  name: string;
  load: () => Promise<unknown>;
  method: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, string>;
  body?: unknown;
  allowed: Role;
  denied: Role;
  mutates: boolean;
  /** The repository function that does the work, for the 404 mapping. */
  work: () => ReturnType<typeof vi.fn>;
};

const cases: Case[] = [
  { name: "GET meals", load: () => import("@/app/api/events/[eventId]/meals/route"), method: "GET", allowed: "FINANCE_MANAGER", denied: "CHECK_IN_STAFF", mutates: false, work: () => mocks.view.loadMealView },
  { name: "POST services", load: () => import("@/app/api/events/[eventId]/meals/services/route"), method: "POST", body: {}, allowed: "EVENT_ADMIN", denied: "FINANCE_MANAGER", mutates: true, work: () => mocks.config.createMealService },
  { name: "PUT service", load: () => import("@/app/api/events/[eventId]/meals/services/[serviceId]/route"), method: "PUT", params: { serviceId: "s1" }, body: {}, allowed: "EVENT_ADMIN", denied: "FINANCE_MANAGER", mutates: true, work: () => mocks.config.updateMealService },
  { name: "POST service reinstate", load: () => import("@/app/api/events/[eventId]/meals/services/[serviceId]/route"), method: "POST", params: { serviceId: "s1" }, body: { action: "reinstate", reason: "Kitchen reopened" }, allowed: "EVENT_ADMIN", denied: "FINANCE_MANAGER", mutates: true, work: () => mocks.config.reinstateMealService },
  { name: "POST service cancel", load: () => import("@/app/api/events/[eventId]/meals/services/[serviceId]/route"), method: "POST", params: { serviceId: "s1" }, body: { action: "cancel", reason: "Kitchen closed" }, allowed: "EVENT_ADMIN", denied: "FINANCE_MANAGER", mutates: true, work: () => mocks.selection.cancelMealService },
  { name: "POST plans", load: () => import("@/app/api/events/[eventId]/meals/plans/route"), method: "POST", body: {}, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.config.createMealPlan },
  { name: "PUT plan", load: () => import("@/app/api/events/[eventId]/meals/plans/[planId]/route"), method: "PUT", params: { planId: "p1" }, body: {}, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.config.updateMealPlan },
  { name: "PUT plan services", load: () => import("@/app/api/events/[eventId]/meals/plans/[planId]/services/route"), method: "PUT", params: { planId: "p1" }, body: [], allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.config.setMealPlanServices },
  { name: "PUT plan price", load: () => import("@/app/api/events/[eventId]/meals/plans/[planId]/prices/route"), method: "PUT", params: { planId: "p1" }, body: {}, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.config.setMealPrice },
  { name: "DELETE plan price", load: () => import("@/app/api/events/[eventId]/meals/plans/[planId]/prices/route"), method: "DELETE", params: { planId: "p1" }, body: { priceId: "price-1" }, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.config.removeMealPrice },
  { name: "POST selections", load: () => import("@/app/api/events/[eventId]/meals/selections/route"), method: "POST", body: {}, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.selection.createMealOrder },
  { name: "POST selection quantity", load: () => import("@/app/api/events/[eventId]/meals/selections/[selectionId]/route"), method: "POST", params: { selectionId: "sel-1" }, body: { action: "quantity", quantity: 2, reason: "Two guests" }, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.selection.changeMealQuantity },
  { name: "POST selection cancel", load: () => import("@/app/api/events/[eventId]/meals/selections/[selectionId]/route"), method: "POST", params: { selectionId: "sel-1" }, body: { action: "cancel", reason: "Not coming" }, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.selection.cancelMealSelection },
  { name: "POST entitlements", load: () => import("@/app/api/events/[eventId]/meals/entitlements/route"), method: "POST", body: {}, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.selection.entitleAttendeeToPlan },
  { name: "POST defaults", load: () => import("@/app/api/events/[eventId]/meals/defaults/route"), method: "POST", body: { preset: "camp-meeting-2026" }, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: true, work: () => mocks.config.applyMealPreset },
  { name: "GET registration meals", load: () => import("@/app/api/events/[eventId]/meals/registrations/[registrationId]/route"), method: "GET", params: { registrationId: "r1" }, allowed: "FINANCE_MANAGER", denied: "REGISTRATION_MANAGER", mutates: false, work: () => mocks.view.loadRegistrationMeals },
  { name: "GET meal tickets CSV", load: () => import("@/app/api/events/[eventId]/exports/meal-tickets/route"), method: "GET", allowed: "FINANCE_MANAGER", denied: "CHECK_IN_STAFF", mutates: false, work: () => mocks.view.mealTicketsCsv },
  { name: "GET meal ticket summary CSV", load: () => import("@/app/api/events/[eventId]/exports/meal-ticket-summary/route"), method: "GET", allowed: "FINANCE_MANAGER", denied: "CHECK_IN_STAFF", mutates: false, work: () => mocks.view.mealTicketSummaryCsv },
];

let role: Role = "EVENT_ADMIN";
let extraPermissions: string[] = [];

function asRole(next: Role, extra: string[] = []) {
  role = next;
  extraPermissions = extra;
}

type Handlers = Record<string, (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>>;

function call(testCase: Case, loaded: unknown) {
  const handlers = loaded as Handlers;
  const request = new Request("http://localhost/api/events/event-1/meals", {
    method: testCase.method,
    headers: { "content-type": "application/json" },
    ...(testCase.method === "GET" ? {} : { body: JSON.stringify(testCase.body ?? {}) }),
  });
  return handlers[testCase.method]!(request, { params: Promise.resolve({ eventId: "event-1", ...(testCase.params ?? {}) }) });
}

const everyRepositoryFunction = () => [...Object.values(mocks.config), ...Object.values(mocks.selection), ...Object.values(mocks.view)];

beforeEach(() => {
  vi.clearAllMocks();
  asRole("EVENT_ADMIN");
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", email: "staff@example.test", displayName: "Staff", globalRole: null } });
  mocks.findActiveMembership.mockImplementation(async () => ({ eventId: "event-1", userId: "user-1", role, status: "ACTIVE", permissions: extraPermissions }));
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  for (const fn of everyRepositoryFunction()) fn.mockResolvedValue({});
  mocks.view.mealTicketsCsv.mockResolvedValue('"Confirmation code"\r\n');
  mocks.view.mealTicketSummaryCsv.mockResolvedValue('"Confirmation code"\r\n');
  mocks.view.loadMealView.mockResolvedValue({ services: [], plans: [] });
  mocks.view.loadRegistrationMeals.mockResolvedValue([]);
  mocks.selection.cancelMealService.mockResolvedValue({ cancelledSelections: 0 });
  mocks.selection.entitleAttendeeToPlan.mockResolvedValue([]);
});

describe("meal preset route (#919)", () => {
  it("answers an unknown preset with 400 INVALID", async () => {
    asRole("FINANCE_MANAGER");
    mocks.config.applyMealPreset.mockRejectedValue(new MealError("INVALID", "That meal preset does not exist."));
    const testCase = cases.find((entry) => entry.name === "POST defaults")!;
    const response = await call({ ...testCase, body: { preset: "no-such-preset" } }, await testCase.load());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID" });
    expect(mocks.config.applyMealPreset).toHaveBeenCalledWith("event-1", "user-1", "no-such-preset");
  });
});

describe("meal routes (#210)", () => {
  for (const testCase of cases) {
    describe(testCase.name, () => {
      it("is refused without a session and does no work", async () => {
        mocks.getCurrentSession.mockResolvedValue({ user: null });
        const response = await call(testCase, await testCase.load());
        expect(response.status).toBe(401);
        for (const fn of everyRepositoryFunction()) expect(fn).not.toHaveBeenCalled();
      });

      it("is refused for a role without the permission and does no work", async () => {
        asRole(testCase.denied);
        const response = await call(testCase, await testCase.load());
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: "PERMISSION_DENIED" });
        for (const fn of everyRepositoryFunction()) expect(fn).not.toHaveBeenCalled();
      });

      it("works for a role with the permission", async () => {
        asRole(testCase.allowed);
        const response = await call(testCase, await testCase.load());
        expect(response.status).toBeLessThan(300);
        expect(testCase.work()).toHaveBeenCalled();
      });

      it("takes the event from the URL, never the body", async () => {
        asRole(testCase.allowed);
        await call({ ...testCase, body: { ...(typeof testCase.body === "object" && !Array.isArray(testCase.body) ? testCase.body : {}), eventId: "another-event" } }, await testCase.load());
        expect(mocks.findActiveMembership).toHaveBeenCalledWith("user-1", "event-1");
        for (const call of testCase.work().mock.calls) expect(call[0]).not.toBe("another-event");
      });

      it("maps another event's row to a 404 from the repository", async () => {
        asRole(testCase.allowed);
        testCase.work().mockRejectedValue(new MealError("SELECTION_NOT_FOUND", "That meal selection does not exist."));
        const response = await call(testCase, await testCase.load());
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ error: "SELECTION_NOT_FOUND" });
      });

      if (testCase.mutates) {
        it("rejects a cross-origin request before doing any work", async () => {
          asRole(testCase.allowed);
          mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN_REQUEST_REJECTED" }, { status: 403 }));
          const response = await call(testCase, await testCase.load());
          expect(response.status).toBe(403);
          expect(mocks.findActiveMembership).not.toHaveBeenCalled();
          for (const fn of everyRepositoryFunction()) expect(fn).not.toHaveBeenCalled();
        });
      }
    });
  }

  it("cancelling a service needs finance as well as event setup, because it credits orders", async () => {
    asRole("READ_ONLY_STAFF", ["CONFIGURE_EVENT"]);
    const handlers = await import("@/app/api/events/[eventId]/meals/services/[serviceId]/route");
    const request = new Request("http://localhost/api/events/event-1/meals/services/s1", { method: "POST", body: JSON.stringify({ action: "cancel", reason: "Kitchen closed" }) });
    const response = await (handlers.POST as unknown as Handlers["POST"])(request, { params: Promise.resolve({ eventId: "event-1", serviceId: "s1" }) });
    expect(response.status).toBe(403);
    expect(mocks.selection.cancelMealService).not.toHaveBeenCalled();
  });

  it("an event administrator's meal service routes cannot be reached by staff of another event", async () => {
    mocks.findActiveMembership.mockResolvedValue(null);
    const handlers = await import("@/app/api/events/[eventId]/meals/services/route");
    const response = await (handlers.POST as unknown as Handlers["POST"])(new Request("http://localhost/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ eventId: "event-2" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "EVENT_ACCESS_DENIED" });
    expect(mocks.config.createMealService).not.toHaveBeenCalled();
  });

  it("the meal tickets CSV is a no-store attachment", async () => {
    const handlers = await import("@/app/api/events/[eventId]/exports/meal-tickets/route");
    const response = await (handlers.GET as unknown as Handlers["GET"])(new Request("http://localhost/x"), { params: Promise.resolve({ eventId: "event-1" }) });
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("meal-tickets.csv");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
