import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { masterAwardStatusTone } from "@/modules/earned-awards/domain";
import { staffRecordKindTone } from "@/modules/club-reports/staff-monthly-records-domain";

const read = (path: string) => readFileSync(path, "utf8");

describe("status chips and badges use the shared classes (#1351)", () => {
  it("maps record and rule states to the approved tones", () => {
    expect(staffRecordKindTone).toEqual({ MISSING: "coral", DRAFT: "gold", DUE: "gold", TO_REVIEW: "purple", REVIEWED: "green", NOT_YET_DUE: "neutral" });
    expect(masterAwardStatusTone).toEqual({ DRAFT: "gold", ACTIVE: "green", INACTIVE: "neutral" });
  });

  it("defines the chip colors from tokens, not hex", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/--coral-soft: #fff1ef;/);
    expect(css).toMatch(/--gold-text: #805807;/);
    expect(css).toMatch(/\.status-chip\.gold \{[^}]*var\(--gold-text\)/);
    expect(css).toMatch(/\.status-chip\.coral \{[^}]*var\(--coral-soft\)/);
  });

  it("no longer keeps one-off chip copies in the module CSS", () => {
    expect(read("components/people-directory.module.css")).not.toMatch(/^\.(chip|kind|green|gold|coral|badge) /m);
    expect(read("components/staff-monthly-records.module.css")).not.toMatch(/^\.(badge|late)[ [{]/m);
    expect(read("components/master-award-rules.module.css")).not.toMatch(/^\.(badge|DRAFT|ACTIVE|INACTIVE|check_flag) /m);
    expect(read("components/site-content-workspace.module.css")).not.toMatch(/^\.(chip|chipWarn|chipGood) /m);
  });

  it("renders the shared classes in the components", () => {
    expect(read("components/people-directory.tsx")).toContain('className="count-badge"');
    expect(read("components/people-directory.tsx")).toContain("`status-chip ${chip.tone}`");
    expect(read("components/staff-monthly-records.tsx")).toContain('<span className="status-chip coral">Late</span>');
    expect(read("components/site-content-workspace.tsx")).toContain('"status-chip green"');
    expect(read("components/master-award-rules-workspace.tsx")).toContain("Manual check");
  });
});
