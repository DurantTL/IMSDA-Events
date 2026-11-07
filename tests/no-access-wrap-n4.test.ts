import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The "no access" card wraps a very long email instead of scrolling sideways at 390px (N4, 2026-11-06). */
describe("AccessRestricted wraps long words (N4)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = (selector: string) => css.split("\n").find((line) => line.startsWith(`${selector} {`)) ?? "";

  it("lets the heading and the text break anywhere", () => {
    expect(rule(".forbidden-state :is(h1, h2)")).toContain("overflow-wrap: anywhere");
    expect(rule(".forbidden-state > p:not(.eyebrow)")).toContain("overflow-wrap: anywhere");
  });
});
