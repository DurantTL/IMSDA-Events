import { readdirSync, readFileSync } from "node:fs";
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

  it("keeps the hover and disabled rules wholly inside :where() so component state rules win", () => {
    expect(css).toMatch(/\n:where\(:is\(\.app-shell[^{]*:hover\)\s*\{\s*border-color: var\(--field-border-hover\);/);
    expect(css).toMatch(/\n:where\(:is\(\.app-shell[^{]*:disabled\)\s*\{\s*background-color: var\(--paper\);/);
  });

  it("draws the search box and the filter select as bordered wrappers", () => {
    expect(css).toMatch(/\.search-field \{[^}]*border: 1px solid var\(--field-border\)/);
    expect(css).toMatch(/\.filter-field \{[^}]*border: 1px solid var\(--field-border\)/);
    expect(css).toMatch(/\.money-input \{[^}]*border: 1px solid var\(--field-border\)/);
  });

  it("keeps an invalid public field distinct from the grey field border (coral border and ring)", () => {
    expect(css).toMatch(/\.public-registration-field-invalid textarea \{[^}]*border-color: var\(--coral\); box-shadow: 0 0 0 1px var\(--coral\)/);
  });
});

// ---- scan every stylesheet for a pale border on a field ---------------------------------------

/** Splits on commas that are not inside parentheses or brackets. */
function splitTopLevel(list: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const fieldClassNames = /\.(?:number|date|select|quantity|input|textarea)(?![\w-])/;

/** True when the selector part's styled element (its last compound) is an input, select or textarea. */
function targetsField(part: string, moduleFile: boolean): boolean {
  // `:is(a, b)` / `:where(a, b)` at the end: the target is inside, one list item at a time.
  const group = /:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)\s*$/.exec(part);
  if (group) return splitTopLevel(group[1]).some((inner) => targetsField(inner, moduleFile));
  const last = part.trim().split(/[\s>+~]+/).pop() ?? "";
  const bare = last
    .replace(/:(?:not|is|where|has)\((?:[^()]|\([^()]*\))*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/::?[a-z-]+/g, "");
  if (/(?:^|[^\w-])(?:input|select|textarea)$/.test(bare) || /^(?:input|select|textarea)/.test(bare)) return true;
  return moduleFile && fieldClassNames.test(bare);
}

const borderProps = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?$/;

function paleBorders(source: string, moduleFile: boolean) {
  const offenders: string[] = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const parts = splitTopLevel(selector).filter((part) => targetsField(part, moduleFile));
    if (parts.length === 0) continue;
    for (const [, prop, value] of body.matchAll(/(?:^|[;\s])([a-z-]+):\s*([^;]+)/g)) {
      if (!borderProps.test(prop)) continue;
      for (const [, hex] of value.matchAll(/(#[0-9a-fA-F]{3,8})\b/g)) {
        const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex.slice(0, 7);
        if (contrast(full, "#ffffff") < 3) offenders.push(`${parts.join(", ")} { ${prop}: ${hex} }`);
      }
      if (/var\(--line\b/.test(value)) offenders.push(`${parts.join(", ")} { ${prop}: ${value.trim()} }`);
    }
  }
  return offenders;
}

describe("pale field borders", () => {
  it("recognises the patterns it is meant to catch", () => {
    expect(paleBorders(".form-stack input { border: 1px solid #cbdbe2; }", false)).toHaveLength(1);
    expect(paleBorders(".a input { border-color: #ccc; }", false)).toHaveLength(1);
    expect(paleBorders(".a select { border-top: 1px solid var(--line); }", false)).toHaveLength(1);
    expect(paleBorders(":root :is(.a input, .b select), .c { border-color: #e0e0e0 }", false)).toHaveLength(1);
    expect(paleBorders(".x :where(input:not([type=checkbox]), select) { border: 1px solid #ddd }", false)).toHaveLength(1);
    expect(paleBorders(".select { border: 1px solid #cbdbe2 }", true)).toHaveLength(1);
    expect(paleBorders(".a input { border: 1px solid #6f8591 }", false)).toHaveLength(0);
    expect(paleBorders(".card { border: 1px solid var(--line) }", false)).toHaveLength(0);
  });

  it("leaves no pale border on a rule that styles an input, select or textarea in globals.css", () => {
    expect(paleBorders(css, false)).toEqual([]);
  });

  it("leaves no pale border on a field in any component or page CSS module", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".module.css")) files.push(full);
      }
    };
    for (const dir of ["components", "app"]) walk(path.join(process.cwd(), dir));
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.flatMap((file) => paleBorders(readFileSync(file, "utf8"), true).map((rule) => `${path.relative(process.cwd(), file)}: ${rule}`));
    expect(offenders).toEqual([]);
  });
});
