import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaTabs, markCurrentTab, staffPlaceFor, type StaffAreaViewer } from "@/components/staff-areas";
import { eventTabSpecs } from "@/components/staff-event-tabs";

const read = (path: string) => readFileSync(path, "utf8");
const systemAdmin: StaffAreaViewer = { isSystemAdmin: true, held: ["SYSTEM_ADMIN"], activeRole: null, hasEvents: true, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} };

describe("Possible duplicate people sits under System (#1886)", () => {
  it("lights the Admin area's System administration tab, outside any event", () => {
    expect(staffPlaceFor("/people/matches")).toEqual({ area: "admin", tab: "system-administration", view: null, inEvent: false });
    const current = markCurrentTab(areaTabs("admin", systemAdmin), staffPlaceFor("/people/matches")).filter((tab) => tab.current);
    expect(current.map((tab) => tab.key)).toEqual(["system-administration"]);
  });

  it("leaves the event's registration pages in the event", () => {
    for (const path of ["/people", "/people/duplicates", "/people/attendees", "/people/review-queues"]) {
      expect(staffPlaceFor(path).inEvent, path).toBe(true);
    }
  });

  it("is no longer owned by the event's All registrations view", () => {
    const owned = eventTabSpecs.flatMap((tab) => tab.views.flatMap((view) => [...(view.alsoOwns ?? [])]));
    expect(owned).not.toContain("/people/matches");
    expect(read("components/app-shell.tsx")).not.toContain('pathname.startsWith("/people/matches")');
  });

  it("keeps the link from the event's registrations page", () => {
    expect(read("components/people-workspace.tsx")).toContain('{canReviewPeopleMatches && <li><a href="/people/matches">');
  });
});
