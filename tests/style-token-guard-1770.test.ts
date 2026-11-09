import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssRules, moduleCssFiles, read, root, stripCssComments } from "./helpers/css-source";

/**
 * Site rule G3 (docs/SITE-RULES.md, #1770): everything is styled from the shared tokens. New CSS in app/globals.css or a
 * *.module.css file may not use a raw color, a raw font-size or a raw border-radius. The raw values that existed on
 * November 9, 2026 are frozen as counts per file in tests/fixtures/style-token-baseline-1770.json; the counts only shrink.
 *
 * Lowering the baseline after you replace a raw value:
 *   STYLE_BASELINE_LOWER=1 npx vitest run tests/style-token-guard-1770.test.ts
 * That rewrites the fixture with the lower counts (it never raises one). Review and commit the fixture change.
 */

type Kind = "color" | "fontSize" | "radius";
type Violation = { kind: Kind; file: string; line: number; property: string; value: string; use: string };
type Counts = Record<Kind, Record<string, number>>;

const FIXTURE = "tests/fixtures/style-token-baseline-1770.json";
const kinds: Kind[] = ["color", "fontSize", "radius"];
const kindLabel: Record<Kind, string> = { color: "raw color", fontSize: "raw font-size", radius: "raw border-radius" };

const globalsSource = read("app/globals.css");
const rootBlock = /:root \{([\s\S]*?)\n\}/.exec(stripCssComments(globalsSource))![1]!;
const colorTokens = new Map<string, string>();
const radiusTokens = new Map<string, string>();
const normalHex = (hex: string) => {
  const lower = hex.toLowerCase();
  return lower.length === 4 ? `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}` : lower;
};
for (const match of rootBlock.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) if (!colorTokens.has(normalHex(match[2]!))) colorTokens.set(normalHex(match[2]!), match[1]!);
for (const match of rootBlock.matchAll(/(--radius-[\w-]+):\s*(\d+)px\s*;/g)) radiusTokens.set(`${match[2]}px`, match[1]!);

/** Blanks every var(...) so a token's own fallback (`var(--card, #fff)`) is not a raw value. */
function withoutVars(value: string) {
  let text = value;
  for (let pass = 0; pass < 4; pass += 1) text = text.replace(/var\([^()]*\)/g, "");
  return text;
}

const hexColor = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b/g;
const colorFunction = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i;
/** Named colors count only where a color is the whole value of a color property. Keywords such as transparent, currentColor, inherit and none are not raw colors. */
const namedColors = /^(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|navy|teal|maroon|lime|aqua|fuchsia|olive|pink|brown|gold)$/i;
const colorProperty = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule(?:-color)?)$/;

const radiusProperty = /^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/;
const allowedRadiusPart = /^(?:0|0px|50%|var\(--radius-[\w-]+(?:\s*,[^)]*)?\))$/;
const allowedFontSize = /^(?:var\(--[\w-]+(?:\s*,[^()]*)?\)|max\(\s*var\(--type-staff-floor\s*,\s*0px\s*\)\s*,[\s\S]+\))$/;

/** Splits on spaces and slashes outside parentheses, so `var(--a, 1px) 0 / 4px` gives its four parts. */
function topLevelParts(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && (/\s/.test(char) || char === "/")) {
      if (current) parts.push(current);
      current = "";
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/** Every raw color, font-size and border-radius declaration in one CSS file's text. Custom-property definitions (`--x: #fff`) are token definitions and are skipped. */
export function scanStyles(file: string, source: string): Violation[] {
  const found: Violation[] = [];
  for (const rule of cssRules(source)) {
    // url(...) may hold ";" (data URIs) and is never a style value; blank it, keeping line breaks.
    const body = rule.body.replace(/url\([^)]*\)/g, (match) => match.replace(/[^\n]/g, " "));
    let offset = 0;
    for (const entry of body.split(";")) {
      const start = offset;
      offset += entry.length + 1;
      const index = entry.indexOf(":");
      if (index < 0) continue;
      const property = entry.slice(0, index).trim().toLowerCase();
      if (!/^[a-z][\w-]*$/.test(property)) continue; // custom properties (--x) and nested selectors
      const value = entry.slice(index + 1).trim().replace(/\s*!important$/i, "");
      const leading = entry.slice(0, entry.length - entry.trimStart().length);
      const line = rule.line + body.slice(0, start + leading.length).split("\n").length - 1;
      const add = (kind: Kind, use: string) => found.push({ kind, file, line, property, value: value.replace(/\s+/g, " "), use });

      const bare = withoutVars(value);
      if (property === "font-size" && !allowedFontSize.test(value.replace(/\s+/g, " "))) {
        add("fontSize", "var(--text-helper-min), another size token, or max(var(--type-staff-floor, 0px), <size>) for staff text");
      }
      if (radiusProperty.test(property) && !topLevelParts(value).every((part) => allowedRadiusPart.test(part))) {
        const px = /(?<![\w.-])(\d+)px/.exec(bare)?.[1];
        add("radius", (px && radiusTokens.get(`${px}px`) ? `var(${radiusTokens.get(`${px}px`)})` : "a var(--radius-*) token") + ", 50% or 0");
      }
      const isColorValue = colorProperty.test(property) || /gradient\(|shadow$/.test(`${property} ${bare}`);
      if (isColorValue || /^(?:box-shadow|text-shadow|filter|background-image)$/.test(property)) {
        const hexes = [...bare.matchAll(hexColor)].map((match) => normalHex(match[0]));
        const named = colorProperty.test(property) && bare.split(/\s+/).some((part) => namedColors.test(part));
        if (hexes.length > 0 || colorFunction.test(bare) || named) {
          const token = hexes.map((hex) => colorTokens.get(hex)).find(Boolean);
          add("color", token ? `var(${token})` : "a color token from :root in app/globals.css (a new shade needs a mockup, rule G2)");
        }
      }
    }
  }
  return found;
}

const cssFiles = ["app/globals.css", ...moduleCssFiles()];
const scanned = new Map(cssFiles.map((file) => [file, scanStyles(file, read(file))]));
const allViolations = [...scanned.values()].flat();

function countsOf(violations: Violation[]): Counts {
  const counts: Counts = { color: {}, fontSize: {}, radius: {} };
  for (const item of violations) counts[item.kind][item.file] = (counts[item.kind][item.file] ?? 0) + 1;
  return counts;
}

/** The plain-language problems between the baseline and the current counts: a rise names the lines, a drop asks for a lower fixture. */
export function compareToBaseline(baseline: Counts, violations: Violation[]): string[] {
  const current = countsOf(violations);
  const problems: string[] = [];
  for (const kind of kinds) {
    const files = new Set([...Object.keys(baseline[kind] ?? {}), ...Object.keys(current[kind])]);
    for (const file of [...files].sort()) {
      const before = baseline[kind]?.[file] ?? 0;
      const now = current[kind][file] ?? 0;
      if (now > before) {
        problems.push(`${file} has ${now} ${kindLabel[kind]} lines, the baseline allows ${before}. Use a token. Lines with a raw value:`);
        for (const item of violations.filter((entry) => entry.kind === kind && entry.file === file)) {
          problems.push(`  ${item.file}:${item.line} ${item.property}: ${item.value}  ->  use ${item.use}`);
        }
      } else if (now < before) {
        problems.push(`${file} now has ${now} ${kindLabel[kind]} lines, the baseline says ${before}. Lower it: STYLE_BASELINE_LOWER=1 npx vitest run tests/style-token-guard-1770.test.ts, then commit ${FIXTURE}.`);
      }
    }
  }
  return problems;
}

function sortedCounts(counts: Counts): Counts {
  const sort = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return { color: sort(counts.color), fontSize: sort(counts.fontSize), radius: sort(counts.radius) };
}

describe("G3: no new raw color, font-size or border-radius (#1770)", () => {
  const baseline = JSON.parse(read(FIXTURE)) as Counts;

  if (process.env.STYLE_BASELINE_LOWER === "1") {
    it("lowers the baseline fixture to the current counts (never raises one)", () => {
      const current = countsOf(allViolations);
      const lowered: Counts = { color: {}, fontSize: {}, radius: {} };
      for (const kind of kinds) {
        for (const [file, count] of Object.entries(current[kind])) {
          const limit = Math.min(count, baseline[kind][file] ?? 0);
          if (limit > 0) lowered[kind][file] = limit;
        }
      }
      writeFileSync(path.join(root, FIXTURE), `${JSON.stringify(sortedCounts(lowered), null, 2)}\n`);
    });
    return;
  }

  it("matches the reviewed baseline: no file gains a raw value and none loses one without lowering the fixture", () => {
    expect(compareToBaseline(baseline, allViolations)).toEqual([]);
  });

  it("keeps the baseline sorted, with positive whole counts", () => {
    expect(baseline).toEqual(sortedCounts(baseline));
    for (const kind of kinds) for (const count of Object.values(baseline[kind])) expect(Number.isInteger(count) && count > 0).toBe(true);
  });

  it("reads the tokens from :root", () => {
    expect(colorTokens.get("#582c83")).toBe("--imsda-purple");
    expect(radiusTokens.get("12px")).toBe("--radius-card");
  });

  it("proves itself: one injected example of each kind fails, with the file, line and token to use", () => {
    const sample = [
      ".ok { color: var(--imsda-purple); font-size: var(--text-helper-min); border-radius: var(--radius-card); }",
      ".ok2 { font-size: max(var(--type-staff-floor, 0px), 0.875rem); border-radius: 50%; background: transparent; color: currentColor; }",
      ":root { --brand: #123456; --r: 7px; --s: 13px; }",
      ".bad { color: #ff0000;",
      "  font-size: 13px;",
      "  border-radius: 7px; }",
    ].join("\n");
    const found = scanStyles("sample.css", sample);
    expect(found.map((item) => `${item.kind}@${item.line}`)).toEqual(["color@4", "fontSize@5", "radius@6"]);
    const problems = compareToBaseline({ color: {}, fontSize: {}, radius: {} }, found);
    expect(problems.join("\n")).toContain("sample.css:4 color: #ff0000");
    expect(problems.join("\n")).toContain("sample.css:5 font-size: 13px");
    expect(problems.join("\n")).toContain("sample.css:6 border-radius: 7px");
    expect(problems.join("\n")).toContain("use");
    // A raw value that equals a token names that token.
    expect(compareToBaseline({ color: {}, fontSize: {}, radius: {} }, scanStyles("t.css", ".a { border-radius: 12px; background: #582C83; }")).join("\n")).toMatch(/--imsda-purple[\s\S]*--radius-card/);
  });

  it("proves the ratchet both ways: a rise fails and a drop without a lowered fixture fails", () => {
    const two = scanStyles("a.css", ".a { font-size: 13px; }\n.b { font-size: 14px; }");
    expect(compareToBaseline({ color: {}, fontSize: { "a.css": 2 }, radius: {} }, two)).toEqual([]);
    expect(compareToBaseline({ color: {}, fontSize: { "a.css": 1 }, radius: {} }, two)[0]).toMatch(/a\.css has 2 raw font-size lines, the baseline allows 1/);
    expect(compareToBaseline({ color: {}, fontSize: { "a.css": 3 }, radius: {} }, two)[0]).toMatch(/Lower it/);
    expect(compareToBaseline({ color: {}, fontSize: { "gone.css": 1 }, radius: {} }, [])[0]).toMatch(/Lower it/);
  });

  it("covers the edge cases: keywords pass, corner shorthands and gradients are read, comments and custom properties are ignored", () => {
    const sample = [
      "/* .c { color: #fff; font-size: 9px; border-radius: 3px; } */",
      ".k { color: inherit; background: none; border-color: currentColor; outline-color: transparent; border-radius: 0; }",
      ".t { --x: #fff; --size: 11px; background: var(--card, #fff); border-radius: var(--radius-pill, 999px); }",
      ".u { background: url(\"data:image/svg+xml;utf8,<svg fill='%23fff'/>\"); }",
      ".bad { border-top-left-radius: 4px; border-radius: 12px 12px 0 0; font-size: inherit; font-size: 1em;",
      "  background: linear-gradient(90deg, rgba(0,0,0,.1), #fff); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); border: 1px solid #ccc; color: white; }",
    ].join("\n");
    const found = scanStyles("s.css", sample).map((item) => `${item.kind}:${item.property}`);
    expect(found).toEqual(["radius:border-top-left-radius", "radius:border-radius", "fontSize:font-size", "fontSize:font-size", "color:background", "color:box-shadow", "color:border", "color:color"]);
  });
});
