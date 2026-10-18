import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { arrowFocusTarget } from "@/components/account-section-nav";

/** #997 / WCAG 2.4.3: a scroll arrow hides when its edge is reached, so focus must move before it disappears. */
describe("tab strip scroll arrows keep keyboard focus (#997)", () => {
  it("moves focus off the end arrow once the end is reached: to the start arrow when it shows, else the last tab", () => {
    expect(arrowFocusTarget({ focused: "end", fadeStart: true, fadeEnd: false })).toBe("start-arrow");
    expect(arrowFocusTarget({ focused: "end", fadeStart: false, fadeEnd: false })).toBe("last-tab");
  });

  it("moves focus off the start arrow once the start is reached: to the end arrow when it shows, else the first tab", () => {
    expect(arrowFocusTarget({ focused: "start", fadeStart: false, fadeEnd: true })).toBe("end-arrow");
    expect(arrowFocusTarget({ focused: "start", fadeStart: false, fadeEnd: false })).toBe("first-tab");
  });

  it("leaves focus alone while the focused arrow still shows, or when no arrow has focus", () => {
    expect(arrowFocusTarget({ focused: "end", fadeStart: true, fadeEnd: true })).toBeNull();
    expect(arrowFocusTarget({ focused: "start", fadeStart: true, fadeEnd: true })).toBeNull();
    expect(arrowFocusTarget({ focused: null, fadeStart: false, fadeEnd: false })).toBeNull();
  });

  it("decides before the fade flags change, so the arrow is never hidden while it has focus", () => {
    const source = readFileSync(path.join(process.cwd(), "components/account-section-nav.tsx"), "utf8");
    const update = source.slice(source.indexOf("const updateFades = () => {"));
    expect(update.indexOf("arrowFocusTarget(")).toBeGreaterThan(-1);
    expect(update.indexOf("arrowFocusTarget(")).toBeLessThan(update.indexOf('setFade("fadeStart"'));
  });
});
