import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The registration detail's panels sit side by side, so each needs its own key (#2017). Two siblings keyed by the same
// registration id made React warn and could leave one of them out on a registration made through a form.
describe("registration detail panel keys (#2017)", () => {
  it("gives the communication and signatures panels different keys", () => {
    const source = readFileSync("components/people-workspace.tsx", "utf8");
    expect(source).not.toMatch(/<Registration(Communications|Signatures)Panel\s+key=\{selected\.id\}/);
    expect(source).toContain("key={`communications-${selected.id}`}");
    expect(source).toContain("key={`signatures-${selected.id}`}");
  });
});
