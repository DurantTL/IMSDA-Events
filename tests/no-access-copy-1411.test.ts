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
    expect(noAccessCopy({ from: "event-setup", hasEvents: true, email }).heading).toContain("Creating events needs a system administrator");
    expect(noAccessCopy({ from: "event-setup", hasEvents: true, email }).body).toContain("New events are set up by IMSDA system administrators");
    expect(noAccessCopy({ from: null, hasEvents: true, email }).heading).toContain("This page needs a system administrator");
    for (const from of ["event-setup", null]) {
      const copy = noAccessCopy({ from, hasEvents: true, email });
      expect(copy.body.toLowerCase()).not.toContain(copy.heading.toLowerCase());
    }
    expect(noAccessCopy({ from: "other", hasEvents: true, email }).showEvents).toBe(true);
  });

  it("tells a Clubs Administrator that System management needs a system administrator, with a way back to Club administration (from=system only)", () => {
    for (const hasEvents of [false, true]) {
      const copy = noAccessCopy({ from: "system", hasEvents, email, clubsAdmin: true });
      expect(copy.heading).toBe("System management needs a system administrator");
      expect(copy.whoToAsk).toBe("an IMSDA system administrator");
      expect(copy.showClubs).toBe(true);
      expect(`${copy.heading} ${copy.body}`).not.toContain("event assignment");
      expect(copy.body).not.toMatch(/\bask\b/i);
    }
    const setup = noAccessCopy({ from: "event-setup", hasEvents: false, email, clubsAdmin: true });
    expect(setup.heading).toContain("Creating events needs a system administrator");
    expect(setup.showClubs).toBe(true);
  });

  it("does not give the System management copy to a Clubs Administrator for any other reason", () => {
    expect(noAccessCopy({ from: null, hasEvents: true, email, clubsAdmin: true }).heading).toBe("This page needs a system administrator");
    expect(noAccessCopy({ from: null, hasEvents: true, email, clubsAdmin: true }).showClubs).toBeUndefined();
  });

  it("leaves event staff copy unchanged", () => {
    expect(noAccessCopy({ from: null, hasEvents: false, email, clubsAdmin: false }).heading).toBe("No events are assigned");
    expect(noAccessCopy({ from: null, hasEvents: true, email }).showClubs).toBeUndefined();
  });
});
