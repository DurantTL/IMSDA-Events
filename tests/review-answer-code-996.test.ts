import { describe, expect, it } from "vitest";
import { isCodeLikeAnswer } from "@/modules/forms/review-answer-code";

describe("which review answers may break anywhere (#996)", () => {
  it("lets emails and codes break anywhere", () => {
    for (const value of ["person@example.test", "mobilecheck.walkthrough.1024@example.test", "REG-4030F4CCC25C", "ab12cd", "team_2027_A"]) {
      expect(isCodeLikeAnswer(value), value).toBe(true);
    }
  });

  it("keeps ordinary words whole, however long", () => {
    for (const value of ["Pathfinder", "Saturday", "Mobilecheck", "Wolfeschlegelsteinhausenberger", "Mobilecheck Eagles Club", "515-555-0100 ext", "Yes", ""]) {
      expect(isCodeLikeAnswer(value), value).toBe(false);
    }
  });

  it("ignores answers that are not text", () => {
    for (const value of [undefined, null, 14, ["a1b2c3d4"]]) expect(isCodeLikeAnswer(value)).toBe(false);
  });
});
