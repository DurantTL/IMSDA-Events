import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ resolveEventContext: vi.fn(), loadMoneyToolMetrics: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/finance/tools", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: dependencies.resolveEventContext }));
vi.mock("@/modules/payments/money-tools-repository", () => ({ loadMoneyToolMetrics: dependencies.loadMoneyToolMetrics }));

import MoreMoneyToolsPage from "@/app/(workspace)/finance/tools/page";

const render = async () => renderToStaticMarkup(await MoreMoneyToolsPage({ searchParams: Promise.resolve({ event: "evt_1" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.loadMoneyToolMetrics.mockResolvedValue({ churchFlags: 2, ledgerDifferences: 0, policyVersions: 1, policyInEffect: 1, draftInvoices: 0, scholarshipBalanceCents: 5000, billingUnrecorded: 0, billingOutdated: 0, billingUnresolved: 0, billingNeedsContact: 0, billedToOrganizations: 1, attendanceApproved: 1 });
});

describe("More money tools page access (#1575)", () => {
  it("shows the no-access page, and reads no numbers, without MANAGE_FINANCE", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: { id: "evt_1", name: "Event" }, permissions: ["VIEW_EVENT", "MANAGE_CHECK_IN"], user: { globalRole: null } });
    const html = await render();
    expect(html).toContain("Finance is restricted");
    expect(html).not.toContain("Invoices and churches");
    expect(html).not.toContain("evt_1");
    expect(dependencies.loadMoneyToolMetrics).not.toHaveBeenCalled();
  });

  it("shows the eight cards with the event on every link and a status in words, for a finance manager", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: { id: "evt_1", name: "Event" }, permissions: ["MANAGE_FINANCE"], user: { globalRole: null } });
    const html = await render();
    expect(dependencies.resolveEventContext).toHaveBeenCalledWith("evt_1");
    expect(dependencies.loadMoneyToolMetrics).toHaveBeenCalledWith({ permissions: ["MANAGE_FINANCE"], isSystemAdmin: false }, "evt_1");
    for (const heading of ["Invoices and churches", "Funds and matching", "Rules and checks"]) expect(html).toContain(heading);
    expect(html.match(/data-testid="hub-card"/g)).toHaveLength(8);
    expect(html.match(/href="[^"]*\?event=evt_1"/g)).toHaveLength(8);
    expect(html).toContain("2 need the finance office");
    expect(html).toContain("Balance $50.00");
    expect(html).toContain("All match");
  });

  it("tells the loader when the viewer is a system administrator", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: { id: "evt_1", name: "Event" }, permissions: ["MANAGE_FINANCE"], user: { globalRole: "SYSTEM_ADMIN" } });
    await render();
    expect(dependencies.loadMoneyToolMetrics).toHaveBeenCalledWith({ permissions: ["MANAGE_FINANCE"], isSystemAdmin: true }, "evt_1");
  });

  it("shows Unavailable for a number that could not be read", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: { id: "evt_1", name: "Event" }, permissions: ["MANAGE_FINANCE"], user: { globalRole: null } });
    dependencies.loadMoneyToolMetrics.mockResolvedValue({ churchFlags: null });
    const html = await render();
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Nothing waiting");
  });
});
