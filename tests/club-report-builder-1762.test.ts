// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/x", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
import { ClubReportColumnBuilder } from "@/components/club-report-column-builder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clubs = [{ id: "club-a", name: "Synthetic Alpha" }, { id: "club-b", name: "Synthetic Beta" }];
const locations = [{ id: "loc-1", name: "North" }, { id: "loc-2", name: "South" }];
const props = { endpoint: "/api/x", eventName: "Synthetic Camporee", options: [{ key: "name", header: "Name" }], defaultKeys: ["name"], initialLayouts: [], clubs, locations };

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

function mount(locationId: string | null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (id: string | null) => act(() => { root.render(createElement(ClubReportColumnBuilder, { ...props, locationId: id })); });
  render(locationId);
  return { container, render };
}

const button = (container: HTMLElement, label: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent === label) as HTMLButtonElement;

describe("club report builder filters", () => {
  it("sends the page's current location after it changes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ headers: ["Name"], rows: [], totalRows: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, render } = mount("loc-1");
    render("loc-2");
    await act(async () => { button(container, "Preview").click(); });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { filters: { locationId?: string } };
    expect(body.filters.locationId).toBe("loc-2");
  });

  it("disables Preview, Print and Download with a linked hint when Pick clubs has none ticked", async () => {
    const { container } = mount(null);
    const pick = [...container.querySelectorAll('input[type="radio"]')].find((entry) => entry.parentElement?.textContent?.includes("Pick clubs")) as HTMLInputElement;
    await act(async () => { pick.click(); });
    const hint = container.querySelector(".disabled-hint");
    expect(hint?.textContent).toBe("Tick at least one club, or choose All clubs.");
    for (const label of ["Preview", "Print", "Download CSV"]) {
      const target = button(container, label);
      expect(target.disabled).toBe(true);
      expect(target.getAttribute("aria-describedby")).toBe(hint?.id);
    }
    expect(button(container, "Clear filters")).toBeTruthy();
  });
});
