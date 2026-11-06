import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

/** #1557 round 2: the Noto Sans swap made button rows and headings re-wrap after first paint on phones. */
describe("web font swap does not move the page (#1557)", () => {
  it("defines a size-adjusted fallback for each weight range", () => {
    const faces = css.match(/@font-face\s*\{[^}]*"Noto Sans Fallback"[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toMatch(/size-adjust:\s*10\d(\.\d+)?%/);
      expect(face).toMatch(/ascent-override:/);
      expect(face).toMatch(/descent-override:/);
      expect(face).toMatch(/src:\s*local\(/);
    }
  });

  it("puts the fallback between the web font and the generic stack on body", () => {
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*"Noto Sans",\s*"Noto Sans Fallback",\s*Arial,\s*sans-serif;/);
  });

  it("keeps the fallback before the form builder marker", () => {
    expect(css.indexOf('"Noto Sans Fallback"')).toBeGreaterThan(-1);
    expect(css.indexOf('"Noto Sans Fallback"')).toBeLessThan(css.indexOf("/* Registration form builder editor shell (#1132)"));
  });

  it("reserves the side-card help lines on /account so the cards below do not move at the swap", () => {
    const moduleCss = readFileSync(path.join(process.cwd(), "app/(public)/account/(portal)/overview.module.css"), "utf8");
    expect(moduleCss).toMatch(/@media \(min-width: 901px\) \{\s*\.reserveHelp \{\s*min-height: calc\(var\(--help-lines, 1\) \* 1lh\);/);
    const page = readFileSync(path.join(process.cwd(), "app/(public)/account/(portal)/page.tsx"), "utf8");
    expect(page).toContain("{...reservedHelp(helpText)}");
    expect(page).toMatch(/\{\.\.\.reservedHelp\(`Registrations connected to this verified email appear here\. \$\{accountSecurityNote\}`\)\}/);
  });
});
