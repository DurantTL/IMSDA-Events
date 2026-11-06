import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_CARD_INTRO, HELP_NOTES, SECURITY_NOTES } from "@/app/(public)/account/(portal)/overview-help";

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
    expect(page).toContain("{...reservedHelp(helpNote.lines)}");
    expect(page).toContain("{...reservedHelp(securityNote.lines)}");
  });

  // Each count is what the web font renders in the 272px side column (measured in a browser at 1280px). Changing a
  // string changes the text length, so this fails until the count is measured again and both are updated.
  it("pins the measured line count of every side-card help variant", () => {
    const intro = ACCOUNT_CARD_INTRO.length + 1;
    expect([
      [intro + SECURITY_NOTES.on.text.length, SECURITY_NOTES.on.lines],
      [intro + SECURITY_NOTES.off.text.length, SECURITY_NOTES.off.lines],
      [intro + SECURITY_NOTES.club.text.length, SECURITY_NOTES.club.lines],
      [HELP_NOTES.withEvent.text.length, HELP_NOTES.withEvent.lines],
      [HELP_NOTES.noEvent.text.length, HELP_NOTES.noEvent.lines],
    ]).toEqual([[83, 3], [131, 4], [166, 5], [90, 3], [99, 3]]);
  });

  it("keeps club form filter selects at least 44px tall", () => {
    expect(css).toMatch(/\.club-form-filter select \{ min-height: 44px; \}/);
  });
});
