import { describe, expect, it } from "vitest";
import { buildSearchDestinations, type DestinationSearchContext } from "@/components/destination-search-model";
import { clubsAdminGroups } from "@/components/staff-navigation";
import { eventPermissions } from "@/modules/access/permissions";
import { clubsAdminGuides } from "@/modules/help/clubs-admin-guides";
import { helpDestinations, helpGuides } from "@/modules/help/guides";
import { canSeeGuide, guideForViewer, guideLinksForViewer, visibleGuides, type HelpViewer } from "@/modules/help/visibility";

/** Help guides for Clubs Administrators (#1882). Synthetic viewers only. */
const clubsGuides = helpGuides.filter((guide) => guide.workspace === "Clubs");
const eventStaff: HelpViewer = { isSystemAdmin: false, isClubsAdministrator: false, selectedEventId: "evt_synthetic", permissions: [...eventPermissions] };
const clubsAdmin: HelpViewer = { isSystemAdmin: false, isClubsAdministrator: true, selectedEventId: "", permissions: [] };
const sysAdmin: HelpViewer = { isSystemAdmin: true, isClubsAdministrator: true, selectedEventId: "evt_synthetic", permissions: [...eventPermissions] };

describe("Clubs guides", () => {
  it("are every guide in the Clubs workspace, for the clubs audience, and nothing else is", () => {
    expect(clubsGuides.length).toBeGreaterThanOrEqual(12);
    for (const guide of helpGuides) expect(guide.workspace === "Clubs", guide.id).toBe(guide.audience.kind === "clubs");
    for (const guide of clubsAdminGuides) expect(guide.lastReviewed, guide.id).toBe("2026-11-12");
  });

  it("use only Clubs pages, so a Clubs Administrator gets every link", () => {
    for (const guide of clubsGuides) {
      for (const id of guide.destinationIds) expect(helpDestinations[id]?.scope, `${guide.id}:${id}`).toBe("Clubs");
      const { links, unavailable } = guideLinksForViewer(guide, clubsAdmin);
      expect(unavailable, guide.id).toBe(0);
      expect(links.length, guide.id).toBe(guide.destinationIds.length);
    }
  });

  it("name the Clubs pages with the Clubs sidebar's own labels", () => {
    const sidebar = new Set(clubsAdminGroups.flatMap((group) => group.items.map((item) => item.label)));
    for (const id of ["club-summary", "club-transfers", "club-sterling", "club-monthly-records", "club-year-end", "club-invites", "club-import", "club-people-access"]) {
      expect(sidebar.has(helpDestinations[id]!.label), id).toBe(true);
    }
  });

  it("do not mention the automatic late reminder switch", () => {
    const text = clubsGuides.flatMap((guide) => [guide.summary, guide.next, ...guide.needs, ...guide.changes, ...guide.steps, ...guide.verify]).join("\n");
    expect(text).not.toMatch(/late reminder|automatic reminder/i);
  });
});

describe("who sees the Clubs guides", () => {
  it("hides them from event staff, and answers like an unknown id", () => {
    expect(visibleGuides(eventStaff).some((guide) => guide.workspace === "Clubs")).toBe(false);
    for (const guide of clubsGuides) {
      expect(canSeeGuide(guide, eventStaff)).toBe(false);
      expect(guideForViewer(guide.id, eventStaff)).toBeUndefined();
    }
    expect(guideForViewer("no-such-guide", eventStaff)).toBeUndefined();
  });

  it("gives event staff no Clubs links, even on a guide shared with an event task", () => {
    const invite = helpGuides.find((guide) => guide.id === "invite-staff")!;
    expect(guideLinksForViewer(invite, eventStaff).links.map((link) => link.href).some((href) => href.startsWith("/admin/clubs"))).toBe(false);
  });

  it("shows every Clubs guide to a Clubs Administrator, and no System guide", () => {
    expect(visibleGuides(clubsAdmin).filter((guide) => guide.workspace === "Clubs").map((guide) => guide.id)).toEqual(clubsGuides.map((guide) => guide.id));
    expect(visibleGuides(clubsAdmin).some((guide) => guide.workspace === "System")).toBe(false);
    expect(guideForViewer("clubs-find-a-club", clubsAdmin)?.id).toBe("clubs-find-a-club");
  });

  it("gives a Clubs Administrator the Clubs links but not a System-only link", () => {
    const invite = helpGuides.find((guide) => guide.id === "invite-staff")!;
    const links = guideLinksForViewer(invite, clubsAdmin);
    expect(links.links.map((link) => link.href)).toEqual(["/admin/clubs/leaders"]);
    expect(links.unavailable).toBe(2);
  });

  it("shows a system administrator every guide", () => {
    expect(visibleGuides(sysAdmin).map((guide) => guide.id)).toEqual(helpGuides.map((guide) => guide.id));
  });
});

describe("Help search for Clubs guides", () => {
  const base: DestinationSearchContext = { isSystemAdmin: false, selectedEventId: "evt_synthetic", permissions: [], clubOversight: false, clubEvent: false, clubFormsAccess: false };
  const helpHrefs = (context: DestinationSearchContext) => buildSearchDestinations(context).filter((destination) => destination.scope === "Help").map((destination) => destination.href);

  it("lists them in the Clubs Administrator view and for a system administrator, and not for event staff", () => {
    expect(helpHrefs({ ...base, clubsAdmin: { healthImport: true } })).toContain("/help/clubs-find-a-club?event=evt_synthetic");
    expect(helpHrefs({ ...base, isSystemAdmin: true, permissions: [...eventPermissions] })).toContain("/help/clubs-find-a-club?event=evt_synthetic");
    expect(helpHrefs({ ...base, permissions: [...eventPermissions] }).some((href) => href.includes("clubs-") || href.includes("walkthrough-clubs"))).toBe(false);
  });
});
