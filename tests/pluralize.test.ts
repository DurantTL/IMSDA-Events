import { describe, expect, it } from "vitest";
import { countLabel, pluralize } from "@/lib/pluralize";

describe("pluralize", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralize(1, "club")).toBe("club");
    expect(pluralize(0, "club")).toBe("clubs");
    expect(pluralize(2, "club")).toBe("clubs");
  });

  it("takes an irregular plural", () => {
    expect(pluralize(2, "person", "people")).toBe("people");
    expect(countLabel(1, "person", "people")).toBe("1 person");
  });

  it("labels counts", () => {
    expect(countLabel(0, "code")).toBe("0 codes");
    expect(countLabel(1, "code")).toBe("1 code");
    expect(countLabel(12, "club")).toBe("12 clubs");
  });
});
