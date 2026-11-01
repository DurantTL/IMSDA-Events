import { describe, expect, it } from "vitest";
import { noAccessCopy } from "@/modules/access/no-access-copy";

describe("noAccessCopy (#1411 E6)", () => {
  const email = "staff@example.test";
  it("keeps the original copy when nothing is assigned", () => {
    expect(noAccessCopy({ from: "event-setup", hasEvents: false, email }).body).toContain("does not have an active event assignment");
  });
  it("names who to ask in each case, without repeating it in the body", () => {
    expect(noAccessCopy({ from: null, hasEvents: false, email }).whoToAsk).toBe("an IMSDA event administrator");
    expect(noAccessCopy({ from: "event-setup", hasEvents: true, email }).whoToAsk).toBe("a system administrator");
    expect(noAccessCopy({ from: null, hasEvents: true, email }).body).not.toMatch(/\bask\b/i);
  });
  it("says event creation needs a system administrator only from event setup", () => {
    expect(noAccessCopy({ from: "event-setup", hasEvents: true, email }).body).toContain("Creating events needs a system administrator.");
    expect(noAccessCopy({ from: null, hasEvents: true, email }).body).toContain("This page needs a system administrator.");
    expect(noAccessCopy({ from: "other", hasEvents: true, email }).showEvents).toBe(true);
  });
});
