import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireAnyPermission } from "@/modules/access/authorization";

const user = (globalRole: "SYSTEM_ADMIN" | "USER" = "USER") => ({ id: "user_one", email: "staff@example.test", displayName: "Staff", globalRole });
const membership = (over: Record<string, unknown> = {}) => ({ role: "CHECK_IN_STAFF", status: "ACTIVE", permissions: [] as string[], ...over });
const pair = ["MANAGE_FINANCE", "VIEW_REPORTS"] as const;

describe("requireAnyPermission (#1962)", () => {
  it("lets a system administrator through without a membership lookup", async () => {
    const lookup = vi.fn();
    const access = await requireAnyPermission({ user: user("SYSTEM_ADMIN") } as never, "event_a", pair, lookup as never);
    expect(access.user.id).toBe("user_one");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request with 401", async () => {
    await expect(requireAnyPermission({ user: null } as never, "event_a", pair, vi.fn() as never)).rejects.toMatchObject({ status: 401 });
  });

  it("refuses an inactive or missing membership", async () => {
    await expect(requireAnyPermission({ user: user() } as never, "event_a", pair, (async () => membership({ status: "INACTIVE" })) as never)).rejects.toMatchObject({ status: 403, code: "EVENT_ACCESS_DENIED" });
    await expect(requireAnyPermission({ user: user() } as never, "event_a", pair, (async () => null) as never)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a member who holds neither permission", async () => {
    const error = await requireAnyPermission({ user: user() } as never, "event_a", pair, (async () => membership()) as never).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect((error as AccessDeniedError).code).toBe("PERMISSION_DENIED");
  });

  it.each([
    ["by role (finance manager)", membership({ role: "FINANCE_MANAGER" })],
    ["by role (registration manager, reports only)", membership({ role: "REGISTRATION_MANAGER" })],
    ["by an extra MANAGE_FINANCE", membership({ permissions: ["MANAGE_FINANCE"] })],
    ["by an extra VIEW_REPORTS", membership({ permissions: ["VIEW_REPORTS"] })],
  ])("allows a member who holds one of them %s", async (_label, held) => {
    await expect(requireAnyPermission({ user: user() } as never, "event_a", pair, (async () => held) as never)).resolves.toMatchObject({ user: { id: "user_one" } });
  });
});

const page = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  loadEventMoneyReport: vi.fn(),
  loadUnmatchedSquareSummary: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: page.resolveEventContext }));
vi.mock("@/modules/payments/event-money-report-repository", () => ({
  loadEventMoneyReport: page.loadEventMoneyReport,
  loadUnmatchedSquareSummary: page.loadUnmatchedSquareSummary,
}));

describe("Event money report page access (#1962)", () => {
  beforeEach(() => {
    page.resolveEventContext.mockReset();
    page.loadEventMoneyReport.mockReset();
    page.loadUnmatchedSquareSummary.mockReset();
    page.loadEventMoneyReport.mockResolvedValue({ eventName: "Test", report: {} });
    page.loadUnmatchedSquareSummary.mockResolvedValue({ state: "unavailable" });
  });

  const render = async (permissions: string[]) => {
    page.resolveEventContext.mockResolvedValue({ event: { id: "event_a" }, permissions, user: { globalRole: "USER" } });
    const { default: Page } = await import("@/app/(workspace)/finance/money-report/page");
    return Page({ searchParams: Promise.resolve({ event: "event_a" }) }) as Promise<{ type: { name?: string }; props: Record<string, unknown> }>;
  };

  it("shows the report with links to a finance manager", async () => {
    const element = await render(["MANAGE_FINANCE"]);
    expect(element.props.canManageFinance).toBe(true);
    expect(page.loadEventMoneyReport).toHaveBeenCalledWith("event_a");
  });

  it("shows the report without finance links to a reports-only viewer", async () => {
    const element = await render(["VIEW_REPORTS"]);
    expect(element.props.canManageFinance).toBe(false);
    expect(page.loadEventMoneyReport).toHaveBeenCalled();
  });

  it("reads nothing and shows the restricted notice to anyone else", async () => {
    const element = await render(["VIEW_EVENT"]);
    expect(element.props.title).toBe("Finance is restricted");
    expect(page.loadEventMoneyReport).not.toHaveBeenCalled();
    expect(page.loadUnmatchedSquareSummary).not.toHaveBeenCalled();
  });

  it("asks for Square payments of this event only, for every viewer", async () => {
    await render(["MANAGE_FINANCE"]);
    expect(page.loadUnmatchedSquareSummary).toHaveBeenCalledWith("event_a");
  });
});
