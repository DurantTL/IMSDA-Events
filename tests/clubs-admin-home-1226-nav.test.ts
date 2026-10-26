import { describe, expect, it } from "vitest";
import { clubsAdminActiveHref, clubsAdminNavigation } from "@/components/staff-navigation";
import { adminRoleLanding } from "@/modules/access/admin-roles-domain";

/** #1226: the Clubs sidebar's new first item and the Clubs landing. */
describe("Clubs navigation", () => {
  it("puts Club administration first", () => {
    expect(clubsAdminNavigation[0]).toMatchObject({ href: "/admin/clubs", label: "Club administration" });
  });

  it("lights Club administration only on exactly /admin/clubs", () => {
    expect(clubsAdminActiveHref("/admin/clubs")).toBe("/admin/clubs");
    expect(clubsAdminActiveHref("/admin/clubs/summary")).toBe("/admin/clubs/summary");
    expect(clubsAdminActiveHref("/admin/clubs/applications")).toBe("/admin/clubs/applications");
    expect(clubsAdminActiveHref("/admin/clubs/reports/club-1/2026-10")).toBe("/admin/clubs/reports");
    expect(clubsAdminActiveHref("/admin/clubs/reports/year-end")).toBe("/admin/clubs/reports/year-end");
    expect(clubsAdminActiveHref("/admin/club-forms/some_form")).toBe("/admin/club-forms");
    // Pages the sidebar does not list light nothing, as before.
    expect(clubsAdminActiveHref("/admin/clubs/transfers")).toBeNull();
    expect(clubsAdminActiveHref("/admin/accounts")).toBeNull();
  });

  it("lands a Clubs Administrator on the dashboard", () => {
    expect(adminRoleLanding("CLUBS_ADMIN")).toBe("/admin/clubs");
  });
});
