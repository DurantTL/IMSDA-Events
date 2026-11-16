import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Small layout fixes found by the staff redesign acceptance gate (#1596).
 * The camping summary has up to 13 columns, so it uses the widest shared card switch that fits it: at a 1280 px window its
 * box is under 1260 px and the table becomes the shared cards instead of pushing the page 71 px wider than the window.
 */
describe("staff redesign gate fixes (#1596)", () => {
  it("the club camping summary switches to cards before it outgrows its box", () => {
    const source = readFileSync("app/(workspace)/more/reports/clubs/page.tsx", "utf8");
    const table = source.slice(source.indexOf('<section className="panel report-panel" id="club-camping">'), source.indexOf('id="club-duties"'));
    expect(table).toContain('className="report-table table-cards table-cards-max"');
  });
});

describe("clock times are labeled with their zone (B13, #1596)", () => {
  it("Event health labels each time with the event's zone", () => {
    const source = readFileSync("app/(workspace)/more/health/page.tsx", "utf8");
    expect(source).toContain("return dateTimeInZone(value, timeZone);");
    expect(source).not.toContain('timeStyle: "short"');
  });

  it("Platform settings shows Last changed in Central time with its label", () => {
    const source = readFileSync("components/platform-settings-workspace.tsx", "utf8");
    expect(source).toContain("Last changed {formatInConferenceTime(settings.updatedAt");
    expect(source).not.toContain("toLocaleString()}");
  });
});
