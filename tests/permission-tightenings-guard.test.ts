import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("permission rules held by the pages", () => {
  it("opens a club's monthly report only for a club registered for the event", () => {
    const page = read("app/(workspace)/more/clubs/reports/[organizationId]/[month]/page.tsx");
    expect(page).toContain("canOpenClubRecords");
    expect(page).toMatch(/!\(await canOpenClubRecords\(\{ eventId: event\.id, systemAdmin \}, organizationId\)\)\) notFound\(\)/);
    // The check comes before the report is read.
    expect(page.indexOf("canOpenClubRecords({")).toBeLessThan(page.indexOf("getClubReport(organizationId"));
  });

  it("lists only registered clubs on the monthly records grid", () => {
    const page = read("app/(workspace)/more/clubs/reports/page.tsx");
    expect(page).toContain("restrictToOverseenClubs({ eventId: event.id, systemAdmin }, await listClubReportsForYear(clubYear))");
    expect(page).toContain("registeredOnly={!systemAdmin}");
  });

  it("shows the Sterling Volunteers download only with the sensitive-data permission", () => {
    const page = read("app/(workspace)/more/reports/page.tsx");
    const link = page.indexOf("/background-checks`}");
    expect(link).toBeGreaterThan(0);
    expect(page.slice(Math.max(0, link - 300), link)).toContain('permissions.includes("VIEW_SENSITIVE_DATA")');
    expect(page).toContain('includeContact: permissions.includes("VIEW_SENSITIVE_DATA")');
  });

  it("renders the staff approvals section on the finance page, behind the finance permission", () => {
    const page = read("app/(workspace)/finance/page.tsx");
    expect(page).toContain("<StaffApprovalsFinance");
    expect(page).toContain("listStaffApprovalsForFinance(event.id)");
    expect(page.indexOf('"MANAGE_FINANCE"')).toBeLessThan(page.indexOf("listStaffApprovalsForFinance(event.id)"));
  });
});
