import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { replaceApprovalReview } from "@/modules/communications/scheduled-email-options";

describe("the approval panel after a changed review (#177)", () => {
  it("shows the review that is true now, and leaves a closed panel closed", () => {
    const open = { schedule: { id: "s1", revision: 2 }, review: { reviewFingerprint: "old", eligibleCount: 10 } };
    const moved = { reviewFingerprint: "new", eligibleCount: 7 };
    const next = replaceApprovalReview(open, moved);
    expect(next).toEqual({ schedule: open.schedule, review: moved });
    expect(open.review.reviewFingerprint).toBe("old");
    expect(replaceApprovalReview(null, moved)).toBeNull();
  });

  it("the workspace uses it when a request comes back with a moved review, for the approval panel and the form", () => {
    const source = readFileSync(path.join(process.cwd(), "components/scheduled-emails-workspace.tsx"), "utf8");
    const handler = source.slice(source.indexOf("const moved = result.review;"), source.indexOf("throw new Error(result.message"));
    expect(handler).toContain("setApproval((current) => replaceApprovalReview(current, moved))");
    expect(handler).toContain("setFormReview(moved)");
  });
});
