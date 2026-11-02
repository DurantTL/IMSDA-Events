import { describe, expect, it } from "vitest";
import { cssRules, declared, moduleCssFiles, read, sourceFiles, stripCssComments } from "./helpers/css-source";

/**
 * Site rules L5 and L8, and the look half of G1 and G3 (docs/SITE-RULES.md): buttons use the shared classes, identical
 * radius and color values use the tokens in app/globals.css, and nothing new is a one-off style. Source scans only.
 */

const globalsCss = read("app/globals.css");
const modules = moduleCssFiles().map((file) => ({ file, source: read(file), rules: cssRules(read(file)) }));
const tsxFiles = sourceFiles(["app", "components"], [".tsx"]);

/** The :root block's custom properties that hold a color or a radius. */
const rootBlock = /:root \{([\s\S]*?)\n\}/.exec(stripCssComments(globalsCss))![1]!;
const colorTokens = new Map<string, string>();
const radiusTokens = new Map<string, string>();
for (const match of rootBlock.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  const hex = match[2]!.toLowerCase();
  if (!colorTokens.has(hex)) colorTokens.set(hex, match[1]!);
}
for (const match of rootBlock.matchAll(/(--radius-[\w-]+):\s*(\d+)px\s*;/g)) radiusTokens.set(`${match[2]}px`, match[1]!);

/** A value with every var(...) removed, so a token's own fallback (`var(--card, #fff)`) is not a one-off. */
function withoutVars(value: string) {
  let text = value;
  for (let pass = 0; pass < 3; pass += 1) text = text.replace(/var\([^()]*\)/g, "");
  return text;
}

function declarations(body: string) {
  return body.split(";").flatMap((entry) => {
    const index = entry.indexOf(":");
    return index < 0 ? [] : [{ property: entry.slice(0, index).trim(), value: entry.slice(index + 1).trim() }];
  });
}

const normalHex = (hex: string) => {
  const lower = hex.toLowerCase();
  return lower.length === 4 ? `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}` : lower;
};

/** Properties whose white is a surface (the `--card` token); white text on a dark fill has no token and is left alone. */
const surfaceProperty = /^(background(-color)?|border(-[a-z]+)*|outline(-color)?)$/;

function tokenLiterals(file: string, source: string) {
  const found: string[] = [];
  for (const rule of cssRules(source)) {
    for (const { property, value } of declarations(rule.body)) {
      const bare = withoutVars(value);
      // A hatch or stripe pattern painted with white is a pattern, not the card surface.
      if (/gradient\(/.test(bare)) continue;
      for (const match of bare.matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
        const hex = normalHex(match[0]);
        const token = colorTokens.get(hex);
        if (token && (hex !== "#ffffff" || surfaceProperty.test(property))) found.push(`${file}:${rule.line} ${rule.selector} { ${property}: ${match[0]} } is ${token}`);
      }
      if (/^background(-color)?$/.test(property) && /^white$/i.test(bare.trim())) found.push(`${file}:${rule.line} ${rule.selector} { ${property}: white } is --card`);
      if (/radius$/.test(property)) {
        for (const match of bare.matchAll(/(?<![\w.-])(\d+)px(?![\w.%-])/g)) {
          const token = radiusTokens.get(`${match[1]}px`);
          if (token) found.push(`${file}:${rule.line} ${rule.selector} { ${property}: ${match[1]}px } is ${token}`);
        }
      }
    }
  }
  return found;
}

describe("L8: identical radius and color values use the tokens", () => {
  /** Files another open PR edits; their remaining literals are fixed once it merges. */
  const waitingForOtherPr: Record<string, string> = {};

  it("reads the tokens from :root", () => {
    expect(colorTokens.get("#582c83")).toBe("--imsda-purple");
    expect(colorTokens.get("#ffffff")).toBe("--card");
    expect(radiusTokens.get("12px")).toBe("--radius-card");
    expect(radiusTokens.get("999px")).toBe("--radius-pill");
  });

  it("has no CSS module literal that equals a token (radius, surface white, brand and status colors)", () => {
    const literals = modules.filter((module) => !(module.file in waitingForOtherPr)).flatMap((module) => tokenLiterals(module.file, module.source));
    expect(literals).toEqual([]);
  });

  it("keeps every waiting entry honest", () => {
    for (const file of Object.keys(waitingForOtherPr)) {
      const entry = modules.find((candidate) => candidate.file === file);
      expect(entry && tokenLiterals(file, entry.source).length, `${file} no longer needs its entry`).toBeGreaterThan(0);
    }
  });

  it("flags the shapes it is meant to catch (the scanner itself)", () => {
    const sample = ".a { border-radius: 12px; background: #fff; color: #fff; border: 1px solid #003B5C; }\n.b { background: var(--card, #fff); border-radius: var(--radius-card, 12px); border-radius: 10px; }";
    const found = tokenLiterals("sample.css", sample).map((line) => line.replace(/^sample\.css:\d+ /, ""));
    expect(found).toEqual([
      ".a { border-radius: 12px } is --radius-card",
      ".a { background: #fff } is --card",
      ".a { border: #003B5C } is --imsda-navy",
    ]);
  });
});

describe("G3: no new one-off color", () => {
  const oneOffColors = (source: string) => [...new Set([...stripCssComments(source).matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)]
    .map((match) => normalHex(match[0]))
    .filter((hex) => !colorTokens.has(hex)))];

  it("adds no color to a CSS module that is neither a token nor already on the reviewed list", () => {
    const recorded = new Set(JSON.parse(read("tests/fixtures/module-css-one-off-colors-1440.json")) as string[]);
    const added = modules.flatMap((module) => oneOffColors(module.source).filter((hex) => !recorded.has(hex)).map((hex) => `${module.file}: ${hex}`));
    expect(added, "use a token from :root in app/globals.css; a different shade waits for a mockup issue (L8, #1350)").toEqual([]);
  });

  it("keeps the reviewed list honest: every color on it is still used", () => {
    const recorded = JSON.parse(read("tests/fixtures/module-css-one-off-colors-1440.json")) as string[];
    const used = new Set(modules.flatMap((module) => oneOffColors(module.source)));
    expect(recorded.filter((hex) => !used.has(hex))).toEqual([]);
  });
});

describe("L5: buttons use the shared button classes", () => {
  it("gives the main and light buttons a hover look and the not-allowed cursor when disabled", () => {
    expect(globalsCss).toMatch(/\.primary-button:hover:not\(:disabled\) \{[^}]*background/);
    expect(globalsCss).toMatch(/\.secondary-button:hover:not\(:disabled\) \{[^}]*background/);
    expect(globalsCss).toMatch(/\.primary-button:disabled,\s*\.secondary-button:disabled \{[^}]*cursor: not-allowed/);
  });

  it("never shows a wait or progress cursor on a disabled or busy button (one --cursor-busy token, #1506)", () => {
    expect(rootBlock).toMatch(/--cursor-busy:\s*not-allowed\s*;/);
    const offenders = [{ file: "app/globals.css", rules: cssRules(globalsCss) }, ...modules]
      .flatMap(({ file, rules }) => rules
        .filter((rule) => /:disabled|\[disabled\]|aria-busy|aria-disabled/.test(rule.selector))
        .filter((rule) => /cursor:\s*(wait|progress)\b/.test(rule.body))
        .map((rule) => `${file}:${rule.line} ${rule.selector}`));
    expect(offenders).toEqual([]);
  });

  /**
   * A `<button>` styled only by a CSS module class is a new button look. These are the reviewed ones, each with what
   * it is; a new one should use `primary-button`, `secondary-button`, `text-button` or `icon-button` instead.
   */
  const ownLook: Record<string, string> = {
    "components/public-club-directory.tsx:styles.retryButton": "small retry link-button under the club map message",
    "components/public-club-directory.tsx:styles.resetButton": "small reset link-button in the empty club list",
    "components/two-step-setup.tsx:styles.skip": "text-only 'Not now' / 'Choose a different way' step link",
    "components/sign-in-code-form.tsx:styles.linkButton": "text-only 'Resend' / 'Use a password' link inside a sentence",
    "components/merchandise-admin-workspace.tsx:styles.productSelect": "pick-one product row (an image and a name)",
    "components/form-message.tsx:styles.undo": "Undo link-button inside the shared Saved message (#1455)",
    "components/club-uniform-section.tsx:styles.chipRemove": "tiny remove (x) inside a chip",
    "components/club-earned-awards-workspace.tsx:styles.chipRemove": "tiny remove (x) inside a chip",
  };
  /**
   * The className expression of every `<button ...>` in a file, read with brace matching so `className={x ?? styles.y}`
   * and `className={open ? styles.a : styles.b}` are seen as well as `className={styles.y}` and template strings.
   */
  function buttonClassExpressions(source: string) {
    const found: string[] = [];
    for (const open of source.matchAll(/<button\b/g)) {
      let depth = 0;
      let index = open.index! + open[0].length;
      for (; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        else if (char === ">" && depth === 0 && source[index - 1] !== "=") break;
        else if (depth === 0 && source.startsWith("className={", index)) {
          let end = index + "className={".length;
          let inner = 1;
          for (; end < source.length && inner > 0; end += 1) {
            if (source[end] === "{") inner += 1;
            else if (source[end] === "}") inner -= 1;
          }
          found.push(source.slice(index + "className={".length, end - 1));
          index = end - 1;
        }
      }
    }
    return found;
  }

  /** The module classes an expression names when it carries no class text of its own (no shared class beside them). */
  function moduleOnlyRefs(expression: string) {
    const refs = [...expression.matchAll(/\b(styles|\w+Styles)\.\w+/g)].map((match) => match[0]);
    if (refs.length === 0) return [];
    // Anything written inside quotes or backticks, outside `${...}`, is class text of its own.
    const literals = [...expression.replace(/\$\{[^}]*\}/g, " ").matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim());
    return literals.some(Boolean) ? [] : [...new Set(refs)];
  }

  const moduleOnlyButtons = tsxFiles.flatMap((file) => buttonClassExpressions(read(file)).flatMap((expression) => {
    const refs = moduleOnlyRefs(expression);
    return refs.length > 0 ? [`${file}:${refs.join(" ")}`] : [];
  }));

  it("has no <button> styled only by a module class outside the reviewed list", () => {
    expect(moduleOnlyButtons.filter((entry) => !(entry in ownLook))).toEqual([]);
  });

  it("keeps the reviewed list honest", () => {
    for (const entry of Object.keys(ownLook)) expect(moduleOnlyButtons, `${entry} no longer needs its entry`).toContain(entry);
  });

  it("no longer defines the module button classes #1352 moved onto the shared ones", () => {
    const old = modules.flatMap((module) => [...stripCssComments(module.source).matchAll(/^\.(cisButton|go|tickButton)\b/gm)].map((match) => `${module.file}: .${match[1]}`));
    expect(old).toEqual([]);
  });

  it("keeps every check-in station button at 48px", () => {
    const stationCss = read("components/check-in-station.module.css");
    expect(stationCss).toMatch(/\.cisShell \.large \{[^}]*min-height: 48px/);
    const source = read("components/check-in-station.tsx");
    const buttons = [...source.matchAll(/<button\b[^>]*className=\{`(?:primary|secondary)-button([^`]*)`\}/g)];
    expect(buttons.length).toBeGreaterThan(5);
    expect(buttons.filter((match) => !match[1]!.includes("styles.large")).map((match) => match[0].slice(0, 90))).toEqual([]);
  });

  it("keeps the club finder list a pick-one row in the app colors", () => {
    const rules = cssRules(read("components/public-club-directory.module.css"));
    const row = rules.find((rule) => rule.selector === ".clubButton");
    const selected = rules.find((rule) => rule.selector === ".clubButton.selected");
    expect(row && declared(row.body, "border")).toContain("var(--line)");
    expect(selected && declared(selected.body, "border-color")).toBe("var(--imsda-purple)");
    expect(selected && declared(selected.body, "background")).toBe("var(--imsda-purple-soft)");
    expect(read("components/public-club-directory.tsx")).not.toMatch(/className=\{`?(?:primary|secondary)-button[^}]*clubButton|clubButton[^}]*(?:primary|secondary)-button/);
  });

  it("finds a module-only button (the scanner itself)", () => {
    const refsOf = (sample: string) => buttonClassExpressions(sample).flatMap(moduleOnlyRefs);
    expect(refsOf("<button className={styles.fancy} onClick={go}>Go</button>")).toEqual(["styles.fancy"]);
    // The shapes the first scanner missed: a prop with a module fallback, and a choice between module classes (#1506).
    expect(refsOf("<button aria-haspopup=\"dialog\" className={className ?? styles.trigger} onClick={() => setOpen(true)}>Help</button>")).toEqual(["styles.trigger"]);
    expect(refsOf("<button className={open ? styles.a : styles.b} type=\"button\">Go</button>")).toEqual(["styles.a", "styles.b"]);
    // A shared class beside the module class, or a pass-through className, is fine.
    expect(refsOf("<button className={className ?? `text-button ${styles.trigger}`} type=\"button\">Help</button>")).toEqual([]);
    expect(refsOf("<button className={`primary-button ${styles.large}`} type=\"button\">Go</button>")).toEqual([]);
    expect(refsOf("<button className={className} type=\"button\">Go</button>")).toEqual([]);
  });
});

describe("G1: one shared version of each building block", () => {
  const nonCss = sourceFiles(["app", "components", "modules"], [".ts", ".tsx"]);

  it("prints dollar amounts through formatCents, not a local `$${(x / 100).toFixed(2)}`", () => {
    /** Older copies inside modules/, each to fold into formatCents (modules/payments/format-cents.ts) in a later pass. */
    const olderCopies = new Set([
      "modules/imports/wr26-bundle.ts",
      "modules/lodging/domain.ts",
      "modules/lodging/preferences-domain.ts",
    ]);
    const copies = nonCss.filter((file) => file !== "modules/payments/format-cents.ts" && !olderCopies.has(file))
      .filter((file) => /\$\$\{\s*\(?[\w.]+(?:\s*\/\s*100)\)?\.toFixed\(2\)\}|\$\$\{\(Math\.abs\([\w.]+\)\s*\/\s*100\)\.toFixed\(2\)\}/.test(read(file)));
    expect(copies).toEqual([]);
    for (const file of olderCopies) expect(read(file), `${file} no longer needs its entry`).toMatch(/\$\$\{\(?[\w.]*\(?(?:Math\.abs\()?[\w.]+\)?\s*\/\s*100\)\.toFixed\(2\)\}/);
  });

  it("writes Previous and Next page buttons only in ListPager", () => {
    const stepper = new Set(["components/coordinator-monthly-records.tsx"]); // steps between months, not list pages
    const found = tsxFiles.filter((file) => file !== "components/list-pager.tsx" && !stepper.has(file))
      .filter((file) => /rel="(prev|next)"|>\s*(Previous page|Next page)\s*</.test(read(file)));
    expect(found).toEqual([]);
  });

  it("builds a tab list only in the shared tab-list component", () => {
    const found = tsxFiles.filter((file) => file !== "components/tab-list.tsx" && /role="tablist"/.test(read(file)));
    expect(found).toEqual([]);
  });

  it("has one CSV cell writer and no local copy", () => {
    const copies = nonCss.filter((file) => file !== "modules/reporting/csv.ts" && /(?:function|const)\s+(?:csvCell|csvEscape|escapeCsv|quoteCsv|escapeCell)\b/.test(read(file)));
    expect(copies).toEqual([]);
  });

  it("covers the other shared blocks with their own guards", () => {
    for (const guard of [
      "tests/tabs-shared-1353.test.ts", "tests/dialogs-shared-hook-1354.test.ts", "tests/status-chips-1351.test.ts",
      "tests/search-as-you-type-guard-1431.test.ts", "tests/sorting-pager-rule1-1458.test.ts", "tests/field-checks-1451.test.ts",
      "tests/confirm-guard-1448.test.ts", "tests/exports-rule11-1458.test.ts", "tests/person-name-format-1454.test.ts",
      "tests/times-labeled-central-1454.test.ts", "tests/access-pages-rule14.test.ts",
    ]) expect(read(guard).length, guard).toBeGreaterThan(200);
  });
});
