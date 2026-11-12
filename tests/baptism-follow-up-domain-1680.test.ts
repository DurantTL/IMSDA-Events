import { describe, expect, it } from "vitest";
import {
  BAPTISM_MAX_LEAD_EMAILS,
  baptismNoticeContent,
  newBaptismNames,
  normalizeBaptismName,
  parseLeadEmails,
  splitBaptismNames,
} from "@/modules/baptism-follow-up/domain";

describe("baptism names (#1680)", () => {
  it("splits on commas, semicolons and new lines, and keeps the club's own spelling", () => {
    expect(splitBaptismNames("Ava  Sample, ben sample;\nCleo Sample").map((name) => name.displayName)).toEqual(["Ava Sample", "ben sample", "Cleo Sample"]);
  });

  it("ignores case and spacing, repeats and none-style answers", () => {
    expect(normalizeBaptismName("  Ava   SAMPLE ")).toBe("ava sample");
    expect(splitBaptismNames("Ava Sample, ava  sample").map((name) => name.key)).toEqual(["ava sample"]);
    for (const answer of ["", "none", "N/A", "No.", "-", null, undefined, 4]) expect(splitBaptismNames(answer)).toEqual([]);
  });

  it("returns only names not notified before", () => {
    const already = new Set(["ava sample"]);
    expect(newBaptismNames("AVA  Sample, Ben Sample", already).map((name) => name.displayName)).toEqual(["Ben Sample"]);
    expect(newBaptismNames("Ava Sample", already)).toEqual([]);
    // A removed name does nothing: only the names in the answer are read.
    expect(newBaptismNames("", already)).toEqual([]);
  });
});

describe("event lead addresses (#1680)", () => {
  it("lowercases, removes repeats and accepts one per line or separated by commas", () => {
    expect(parseLeadEmails("Lead@Example.test\nlead@example.test, second@example.test")).toEqual({ ok: true, emails: ["lead@example.test", "second@example.test"] });
    expect(parseLeadEmails("")).toEqual({ ok: true, emails: [] });
  });

  it("refuses a bad address by line number, without echoing it", () => {
    const result = parseLeadEmails("lead@example.test\nnot-an-email");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Address 2");
      expect(result.message).not.toContain("not-an-email");
    }
  });

  it("allows at most three", () => {
    expect(BAPTISM_MAX_LEAD_EMAILS).toBe(3);
    expect(parseLeadEmails("a@example.test, b@example.test, c@example.test").ok).toBe(true);
    const four = parseLeadEmails("a@example.test, b@example.test, c@example.test, d@example.test");
    expect(four).toEqual({ ok: false, message: "Add at most 3 addresses." });
  });
});

describe("the notice wording (#1680)", () => {
  const base = { names: ["Ava Sample"], clubName: "Sample Pathfinder Club", eventName: "Sample Fall Camporee", dates: "October 9 to 11, 2026" };

  it("carries names, club, event, dates and a request to follow up, and nothing more", () => {
    const lead = baptismNoticeContent({ ...base, role: "lead" });
    expect(lead.subject).toBe("Baptism follow-up: Sample Pathfinder Club, Sample Fall Camporee");
    expect(lead.bodyText).toContain("Name: Ava Sample");
    expect(lead.bodyText).toContain("Club: Sample Pathfinder Club");
    expect(lead.bodyText).toContain("Event: Sample Fall Camporee");
    expect(lead.bodyText).toContain("Date: October 9 to 11, 2026");
    expect(lead.bodyText).toContain("Please follow up with the family.");
    expect(lead.bodyText).not.toMatch(/https?:|@|\d{3}[-) ]\d{3}/);
  });

  it("lists several names and tells the pastor the club is sponsored by their church", () => {
    const pastor = baptismNoticeContent({ ...base, names: ["Ava Sample", "Ben Sample"], role: "pastor" });
    expect(pastor.bodyText).toContain("a club your church sponsors");
    expect(pastor.bodyText).toContain("- Ava Sample\n- Ben Sample");
  });

  it("makes placeholders in a name harmless", () => {
    expect(baptismNoticeContent({ ...base, names: ["{{x}}"], role: "lead" }).bodyText).not.toContain("{{");
  });
});
