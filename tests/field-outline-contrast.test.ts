import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Form fields on the staff workspace and the account portal must show a boundary: WCAG 2.2 SC 1.4.11
// asks for 3:1 between a control's border and the background behind it. The old #cbdbe2 was 1.4:1, so
// field edges vanished. Vitest has no layout engine; the rendered check is `npm run test:mobile-layout`
// (scripts/verify-mobile-layout.ts, the field-boundary finding). These guard the stylesheet tokens.
const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const token = (name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? "";

// White, the page (--paper), the soft panel tints, and the near-white panel/field fills staff pages use.
const panelBackgrounds = {
  white: "#ffffff",
  "--paper": token("--paper"),
  "--imsda-navy-soft": token("--imsda-navy-soft"),
  "--imsda-purple-soft": token("--imsda-purple-soft"),
  "--imsda-gold-soft": token("--imsda-gold-soft"),
  "--green-soft": token("--green-soft"),
  "#fbfcfd": "#fbfcfd",
  "#f8fafb": "#f8fafb",
};

describe("form field outline tokens", () => {
  it("declares the shared field tokens on :root", () => {
    for (const name of ["--field-border", "--field-border-hover", "--field-bg", "--field-focus"]) {
      expect(css, name).toMatch(new RegExp(`${name}:`));
    }
  });

  it("keeps --field-border at 3:1 against white and every panel background", () => {
    const border = token("--field-border");
    expect(border).toMatch(/^#[0-9a-f]{6}$/i);
    for (const [name, background] of Object.entries(panelBackgrounds)) {
      expect(background, name).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(border, background), `${border} on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the hover border at least as strong as the resting border", () => {
    const hover = token("--field-border-hover");
    expect(contrast(hover, "#ffffff")).toBeGreaterThanOrEqual(contrast(token("--field-border"), "#ffffff"));
  });

  it("keeps the field fill light enough that the border keeps 3:1 against it too", () => {
    expect(contrast(token("--field-border"), token("--field-bg"))).toBeGreaterThanOrEqual(3);
  });
});

describe("form field rules", () => {
  it("has a zero-specificity base rule for inputs, selects and textareas", () => {
    expect(css).toMatch(/:where\(\.app-shell, \.account-portal[^)]*\)\s*:where\(input:not\([^)]*\), select, textarea\)\s*\{\s*border: 1px solid var\(--field-border\);/);
  });

  it("draws the search box and the filter select as bordered wrappers", () => {
    expect(css).toMatch(/\.search-field \{[^}]*border: 1px solid var\(--field-border\)/);
    expect(css).toMatch(/\.filter-field \{[^}]*border: 1px solid var\(--field-border\)/);
    expect(css).toMatch(/\.money-input \{[^}]*border: 1px solid var\(--field-border\)/);
  });

  it("leaves no pale hex border on a rule whose target is an input, select or textarea", () => {
    const offenders: string[] = [];
    for (const [, selector, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      // The element a selector part styles is its last compound: `.x input:not([type=checkbox])` -> input.
      const targetsField = selector.split(",").some((part) => /(?:^|[\s>+~])(?:input|select|textarea)(?:\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*\s*$/.test(part.trim()));
      if (!targetsField) continue;
      for (const [, hex] of body.matchAll(/(?:^|[;\s])border(?:-color)?:[^;]*?(#[0-9a-fA-F]{6})\b/g)) {
        if (contrast(hex, "#ffffff") < 3) offenders.push(`${selector.trim().replace(/\s+/g, " ")} { border: ${hex} }`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
