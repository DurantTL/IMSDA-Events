import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KitchenReportView } from "@/components/kitchen-report-view";
import type { KitchenReport } from "@/modules/registrations/kitchen-report";

vi.mock("next/navigation", () => ({ usePathname: () => "/more/kitchen-report", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const report = { totalPeople: 12, peopleWithNeeds: 3, meals: [], conferenceCovered: [], conferenceMealServices: [], needs: [] } as unknown as KitchenReport;

describe("kitchen report printout (#1579)", () => {
  it("keeps the event name, title and totals sentence for paper when the screen header is hidden", () => {
    const html = renderToStaticMarkup(createElement(KitchenReportView, { eventName: "Synthetic Camp", report, csvHref: "/x", showHeader: false }));
    expect(html).toContain('data-testid="kitchen-print-intro"');
    expect(html).toContain("Synthetic Camp");
    expect(html).toContain("<h2>Kitchen report</h2>");
    expect(html).toContain("12 people counted, 3 with a dietary need.");
  });

  it("draws the screen intro once, never both", () => {
    const html = renderToStaticMarkup(createElement(KitchenReportView, { eventName: "Synthetic Camp", report, csvHref: "/x" }));
    expect(html).not.toContain("kitchen-print-intro");
    expect(html).toContain("page-intro");
  });

  it("hides the views strip and the shell header on paper, for every page that carries the strip", () => {
    const shell = readFileSync(join(__dirname, "..", "components/staff-shell.module.css"), "utf8");
    expect(/@media print \{[^}]*\.views[^}]*display: none/.test(shell)).toBe(true);
  });
});
