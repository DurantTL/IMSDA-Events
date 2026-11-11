import { describe, expect, it } from "vitest";
import { renamedPortalGuidePath, renamedPortalGuides } from "@/modules/help/renamed-portal-guides";
import { portalGuides } from "@/modules/help/portal-guides";
import { walkthroughsForGuide } from "@/modules/help/walkthroughs";

describe("split roster and forms guide (#1884)", () => {
  it("sends the old address to the roster guide and keeps the query string", () => {
    expect(renamedPortalGuidePath("director-roster-and-forms", {})).toBe("/account/help/director-roster");
    expect(renamedPortalGuidePath("director-roster-and-forms", { from: "/clubs/x", tag: ["a", "b"] })).toBe("/account/help/director-roster?from=%2Fclubs%2Fx&tag=a&tag=b");
  });

  it("leaves other ids alone, including inherited object keys", () => {
    expect(renamedPortalGuidePath("director-roster", {})).toBeNull();
    expect(renamedPortalGuidePath("constructor", {})).toBeNull();
  });

  it("points every renamed id at a real guide, and the old id is gone", () => {
    for (const [oldId, newId] of Object.entries(renamedPortalGuides)) {
      expect(portalGuides.some((guide) => guide.id === oldId)).toBe(false);
      expect(portalGuides.some((guide) => guide.id === newId)).toBe(true);
    }
  });

  it("gives each new guide its own walkthrough and club page", () => {
    expect(walkthroughsForGuide["director-roster"]).toEqual(["walkthrough-director-roster"]);
    expect(walkthroughsForGuide["director-club-forms"]).toEqual(["walkthrough-director-club-forms"]);
    const roster = portalGuides.find((guide) => guide.id === "director-roster")!;
    const forms = portalGuides.find((guide) => guide.id === "director-club-forms")!;
    expect(roster.destinationIds).toEqual(["club-roster"]);
    expect(forms.destinationIds).toEqual(["club-forms"]);
  });
});
