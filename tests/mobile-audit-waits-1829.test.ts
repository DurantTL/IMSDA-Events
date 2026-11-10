import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #1829 / #1830: the mobile layout audit must wait for the page, not race it. Pages open through one helper that waits out the
 * shell's loading screen, and "this should be there" checks wait for the element instead of counting it at once.
 */
const script = readFileSync(path.join(process.cwd(), "scripts/verify-mobile-layout.ts"), "utf8");

/** The source with the one allowed helper removed, so only other uses are left. */
function withoutGotoHelper(source: string) {
  const start = source.indexOf("async function gotoSettled(");
  expect(start, "scripts/verify-mobile-layout.ts must define gotoSettled").toBeGreaterThan(-1);
  const end = source.indexOf("\n}\n", start);
  return source.slice(0, start) + source.slice(end + 3);
}

describe("#1829 #1830 mobile audit waits", () => {
  it("opens pages only through gotoSettled", () => {
    const stray = withoutGotoHelper(script).split("\n").filter((line) => /\.goto\(/.test(line) && !/^\s*(\*|\/\/)/.test(line));
    expect(stray, "Open a page in the audit with gotoSettled(page, url), which waits out the shell's loading screen, instead of page.goto.").toEqual([]);
  });

  it("calls page.goto once, inside the helper", () => {
    expect(script.match(/page\.goto\(/g)?.length).toBe(1);
  });

  it("never records a missing element straight from an instant count", () => {
    const instant = script.match(/\.count\(\)\)?\s*(===\s*0|<\s*1)?\)\s*\{?\s*record\(/g) ?? [];
    expect(instant, "Check that something is present with appears(locator), which waits for it, instead of recording a finding when .count() is 0 right after an action.").toEqual([]);
  });

  it("has the waiting presence helper", () => {
    expect(script).toContain("async function appears(");
    expect(script).toContain('waitFor({ state: "visible"');
  });
});
