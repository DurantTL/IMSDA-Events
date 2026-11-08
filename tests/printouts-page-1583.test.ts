import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ resolveEventContext: vi.fn(), loadPrintoutAvailability: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/more/reports/printouts", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: dependencies.resolveEventContext }));
vi.mock("@/modules/reporting/printouts-repository", () => ({ loadPrintoutAvailability: dependencies.loadPrintoutAvailability }));

import PrintoutsPage from "@/app/(workspace)/more/reports/printouts/page";

const render = async () => renderToStaticMarkup(await PrintoutsPage({ searchParams: Promise.resolve({ event: "evt_1" }) }));
const general = { id: "evt_1", name: "Event", audience: "GENERAL" };
const club = { id: "evt_1", name: "Event", audience: "CLUB" };

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.loadPrintoutAvailability.mockResolvedValue({ usesTeams: true, honorsOn: true });
});

describe("Printouts page access (#1583)", () => {
  it("shows the no-access page, and reads nothing else, without report access", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: club, permissions: ["VIEW_EVENT", "MANAGE_CHECK_IN"] });
    const html = await render();
    expect(html).toContain("Printouts are restricted");
    expect(html).not.toContain("Packets, books and rosters");
    expect(dependencies.loadPrintoutAvailability).not.toHaveBeenCalled();
  });

  it("shows the six cards of a club event with the event on every link", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: club, permissions: ["VIEW_REPORTS"] });
    const html = await render();
    expect(dependencies.resolveEventContext).toHaveBeenCalledWith("evt_1");
    expect(dependencies.loadPrintoutAvailability).toHaveBeenCalledWith("evt_1");
    for (const heading of ["Packets, books and rosters", "Reports and forms"]) expect(html).toContain(heading);
    expect(html.match(/data-testid="hub-card"/g)).toHaveLength(6);
    expect(html.match(/href="[^"]*\?event=evt_1"/g)).toHaveLength(6);
    expect(html).toContain("Also in Honors");
  });

  it("shows group packets and the check-in book, and no club page, on a general event", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: general, permissions: ["VIEW_REPORTS"] });
    dependencies.loadPrintoutAvailability.mockResolvedValue({ usesTeams: false, honorsOn: false });
    const html = await render();
    expect(html.match(/data-testid="hub-card"/g)).toHaveLength(2);
    expect(html).toContain("/more/reports/packets");
    expect(html).toContain("/more/reports/clubs/check-in-book");
    expect(html).not.toContain("/more/reports/clubs?");
    expect(html).not.toContain("team-form");
    expect(html).not.toContain("Unavailable");
  });

  it("shows Unavailable, never a silent hide, when the event facts could not be read", async () => {
    dependencies.resolveEventContext.mockResolvedValue({ event: club, permissions: ["VIEW_REPORTS"] });
    dependencies.loadPrintoutAvailability.mockResolvedValue({ usesTeams: null, honorsOn: null });
    const html = await render();
    expect(html.match(/data-testid="hub-card"/g)).toHaveLength(6);
    expect(html.match(/Unavailable/g)).toHaveLength(3);
  });
});
