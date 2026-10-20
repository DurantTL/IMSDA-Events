import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");

describe("honor pill print override layering (#991)", () => {
  it("shows filtered-out honors in print from inside the base layer, with !important", () => {
    // Tailwind's base layer hides `[hidden]` with !important, which beats any unlayered rule, so the print override
    // must sit in the same layer with !important (an unlayered rule left filtered honors off the printout).
    expect(css).toMatch(/@layer base \{\s*@media print \{\s*\.honor-pill\[hidden\] \{ display: inline-flex !important; \}/);
    expect(css).not.toMatch(/^\s{0,2}\.honor-pill\[hidden\] \{ display: inline-flex !important; \}/m);
  });

  it("has no unlayered [hidden] rule that tries to show an element", () => {
    const rules = [...css.matchAll(/^([^\n{}]*\[hidden\][^\n{}]*)\{([^}]*)\}/gm)];
    const showing = rules.filter(([, , body]) => /display:\s*(?!none)\S/.test(body));
    // Every [hidden] rule that shows something must be indented inside @layer base (4+ spaces).
    expect(showing.length).toBeGreaterThan(0);
    for (const [rule] of showing) expect(rule, rule).toMatch(/^\s{4,}/);
  });
});
