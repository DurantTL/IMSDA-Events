import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLASS_TRACKING_EXPORT_HEADERS, classTrackingDetailCells } from "@/modules/reporting/director-exports";

const row = (tlt: string) => ({
  personId: "p1", lastName: "Sample", firstName: "Alex", className: "Friend", tlt,
  insignia: ["Friend Pin (awarded)"], eventPatches: [], conductAndTlt: ["Good Conduct Bar (earned)"], masterAwards: [],
});

describe("class tracking report cells (#1861)", () => {
  it("gives every heading after the two name columns a cell, TLT or not", () => {
    for (const tlt of ["Yes", "No", ""]) {
      const cells = classTrackingDetailCells(row(tlt));
      expect(cells).toHaveLength(CLASS_TRACKING_EXPORT_HEADERS.length - 2);
      expect(cells[CLASS_TRACKING_EXPORT_HEADERS.indexOf("TLT") - 2]).toBe(tlt);
    }
  });

  it("builds the on-screen report rows from the shared cell helper", () => {
    const page = readFileSync("app/(public)/account/(portal)/clubs/[organizationId]/exports/class-tracking/page.tsx", "utf8");
    expect(page).toContain("classTrackingDetailCells(row).map(");
    expect(page).toContain("CLASS_TRACKING_EXPORT_HEADERS.slice(2).map(");
  });
});
