import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** #1584: the emergency plan keeps its draft editor and its published, printable versions in separate zones. Synthetic data only. */
vi.mock("next/navigation", () => ({ usePathname: () => "/more/emergency-plan", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { EmergencyPlanWorkspace } from "@/components/emergency-plan-workspace";

const versions = [{ versionNumber: 3, publishedLabel: "Jul 1" }, { versionNumber: 2, publishedLabel: "Jun 1" }];
const draft = { locations: [], procedures: [], contacts: [] };
const html = (canEdit: boolean) => renderToStaticMarkup(createElement(EmergencyPlanWorkspace, { canEdit, eventId: "event-1", eventName: "Synthetic Camp Meeting", initialDraft: canEdit ? draft : null, versions }));

describe("emergency plan workspace layout", () => {
  it("names the event in the header, draws no h1 of its own, and marks only the newest version as current", () => {
    const markup = html(true);
    expect(markup).toContain("Synthetic Camp Meeting");
    expect(markup).not.toContain("<h1");
    expect(markup.match(/Current version/g)).toHaveLength(1);
    expect(markup.indexOf("Current version")).toBeLessThan(markup.indexOf("Version 2"));
  });

  it("keeps the print and download links in the published zone, away from the editor", () => {
    const markup = html(true);
    expect(markup.indexOf("Draft plan")).toBeLessThan(markup.indexOf("Published plan and printing"));
    expect(markup.indexOf("Save draft")).toBeLessThan(markup.indexOf("Published plan and printing"));
    expect(markup.slice(markup.indexOf("Published plan and printing"))).toContain("Print version 3");
    expect(markup.slice(markup.indexOf("Published plan and printing"))).not.toContain("Save draft");
  });

  it("shows read-only staff no draft zone", () => {
    const markup = html(false);
    expect(markup).not.toContain("Draft plan");
    expect(markup).toContain("Print version 3");
  });
});
