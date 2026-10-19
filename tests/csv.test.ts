import { describe, expect, it } from "vitest";
import { servedReportCsv } from "@/modules/meals/served-report";
import { csvCell, toCsv } from "@/modules/reporting/csv";

describe("CSV export safety", () => {
  it("quotes commas and double quotes", () => {
    expect(csvCell('Miller, "Jennifer"')).toBe('"Miller, ""Jennifer"""');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"bad\")")).toBe('"\'=HYPERLINK(""bad"")"');
  });

  it("neutralizes a leading tab", () => {
    expect(csvCell("\tShady")).toBe('"\'\tShady"');
  });

  it("neutralizes a leading carriage return", () => {
    expect(csvCell("\rShady")).toBe('"\'\rShady"');
  });

  it("uses CRLF rows for downloadable exports", () => {
    expect(toCsv([["Name", "Balance"], ["Alicia", 0]])).toBe('"Name","Balance"\r\n"Alicia","0"\r\n');
  });

  it("keeps a negative number a number, and still guards the same text typed as a string", () => {
    expect(csvCell(-2)).toBe('"-2"');
    expect(csvCell(-0.5)).toBe('"-0.5"');
    expect(csvCell("-2")).toBe('"\'-2"');
    expect(csvCell("+1")).toBe('"\'+1"');
    // A number that is not finite is not a figure, so it is guarded like text.
    expect(csvCell(Number.NEGATIVE_INFINITY)).toBe('"\'-Infinity"');
    expect(toCsv([["Variance"], [-2], ["=1+1"]])).toBe('"Variance"\r\n"-2"\r\n"\'=1+1"\r\n');
  });

  it("leaves an existing export of plain numbers unchanged (meals served)", () => {
    const figures = { paying: 3, conference: 1, total: 4 };
    const row = { sold: figures, served: figures, servedOnCancelled: { paying: 0, conference: 0, total: 0 }, notUsed: { paying: 0, conference: 0, total: 0 } };
    const lines = servedReportCsv({ rows: [{ key: "any:LUNCH", serviceDate: "", mealType: "LUNCH", label: "Any day · Lunch", ...row }], totals: { label: "All services", ...row }, anyServed: true })
      .replace("\uFEFF", "").trimEnd().split("\r\n");
    expect(lines[1]).toBe('"Any day · Lunch","3","1","4","3","1","4","0","0","0","0"');
  });
});
