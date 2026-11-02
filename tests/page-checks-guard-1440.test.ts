import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cssRules, declared, lastCompound, moduleCssFiles, plainPx, read, selectorParts, sourceFiles, stripCssComments, type CssRule,
} from "./helpers/css-source";

/**
 * Site rules C1 to C6 (docs/SITE-RULES.md, "Page checks"): the code-enforced rules from AGENTS.md → Checks, guarded
 * by source scans so a break fails here before the mobile layout audit (scripts/verify-mobile-layout.ts) has to find
 * it in a browser. Static only: no network, database or dev server. Synthetic selectors only.
 */

const globalsCss = read("app/globals.css");
const globalsRules = cssRules(globalsCss);
const moduleFiles = moduleCssFiles();
const modules = moduleFiles.map((file) => ({ file, source: read(file), rules: cssRules(read(file)) }));
const tsxFiles = sourceFiles(["app", "components", "modules"], [".tsx"]);

/** Every rule of the stylesheets a page can use: the shared stylesheet and every CSS module. */
const allRules: Array<CssRule & { file: string }> = [
  ...globalsRules.map((rule) => ({ ...rule, file: "app/globals.css" })),
  ...modules.flatMap((module) => module.rules.map((rule) => ({ ...rule, file: module.file }))),
];

describe("C1: staff headings and labels are at least 14px", () => {
  const isHeadingOrLabel = (part: string) => {
    const compound = lastCompound(part);
    return /^(h[1-6]|label|legend)(?![\w-])/.test(compound) || /\.[\w-]*(heading|title|label|legend)[\w-]*$/i.test(compound.replace(/(::?[\w-]+)+$/, ""));
  };
  const undersized = allRules.flatMap((rule) => {
    const size = declared(rule.body, "font-size");
    const px = plainPx(size);
    // A size written as max(var(--type-...floor...), X) is raised to the floor on screen; only a bare small size is flagged.
    if (px === null || px >= 14 || !selectorParts(rule.selector).some(isHeadingOrLabel)) return [];
    return [`${rule.file}: ${rule.selector} { font-size: ${size} }`];
  });

  /** Known small sizes, each with its reason. A new one must be fixed with the floor form, not added here. */
  const allowed: Record<string, string> = {};

  it("has no bare font-size under 14px on a heading or label rule, outside the reviewed list", () => {
    const unexpected = undersized.filter((entry) => !Object.keys(allowed).some((key) => entry.startsWith(`${key} {`)));
    expect(unexpected).toEqual([]);
  });

  it("keeps the allowlist honest: every entry still matches a rule", () => {
    for (const key of Object.keys(allowed)) {
      expect(undersized.some((entry) => entry.startsWith(`${key} {`)), `${key} no longer needs its allowlist entry`).toBe(true);
    }
  });

  it("finds a small heading rule (the scanner itself)", () => {
    const [rule] = cssRules(".card h3 { font-size: 0.8rem; }");
    expect(plainPx(declared(rule!.body, "font-size"))).toBeLessThan(14);
    expect(selectorParts(rule!.selector).some(isHeadingOrLabel)).toBe(true);
    expect(plainPx(declared("font-size: max(var(--type-staff-floor, 0px), 0.8rem)", "font-size"))).toBeNull();
  });

  it("has no inline h1 or h2 text smaller than 14px", () => {
    const small = tsxFiles.flatMap((file) => {
      const source = read(file);
      return [...source.matchAll(/<h[12]\b[^>]*style=\{\{[^}]*fontSize:\s*"?(\d+(?:\.\d+)?)(?:px)?"?/g)]
        .filter((match) => Number(match[1]) < 14)
        .map((match) => `${file}: ${match[0].slice(0, 80)}`);
    });
    expect(small).toEqual([]);
  });

  it("keeps the 14px staff floor in the stylesheet", () => {
    expect(globalsCss).toMatch(/\.app-shell \{[^}]*--type-staff-floor: 0\.875rem/);
  });
});

describe("C2: tap targets are at least 44px", () => {
  const tapLike = (part: string) => {
    const compound = lastCompound(part);
    return /(button|btn|trigger|toggle|tab|close|action|link|open[A-Z]|select)/i.test(compound) && !/(icon|marker|avatar|badge|::before|::after)/i.test(compound);
  };
  // A rule that only applies where a mouse is the pointer is not a phone tap target.
  const desktopOnly = (rule: CssRule) => rule.at.some((at) => /min-width:\s*(7[7-9]\d|[89]\d\d|\d{4})px|pointer:\s*fine|hover:\s*hover|print/.test(at));
  const small = modules.flatMap((module) => module.rules.flatMap((rule) => {
    if (desktopOnly(rule) || !selectorParts(rule.selector).some(tapLike)) return [];
    return (["height", "min-height"] as const).flatMap((property) => {
      const px = plainPx(declared(rule.body, property));
      return px !== null && px < 44 ? [`${module.file}:${rule.line} ${rule.selector} { ${property}: ${declared(rule.body, property)} }`] : [];
    });
  }));

  it("keeps the 44px token", () => {
    expect(globalsCss).toMatch(/:root \{[^}]*--touch-target: 44px;/);
  });

  it("sets no button, link, tab or menu trigger in a CSS module shorter than 44px", () => {
    expect(small).toEqual([]);
  });

  it("finds a short button rule (the scanner itself)", () => {
    const [rule] = cssRules(".saveButton { min-height: 40px; }");
    expect(selectorParts(rule!.selector).some(tapLike)).toBe(true);
    expect(plainPx(declared(rule!.body, "min-height"))).toBeLessThan(44);
  });

  it("keeps the phone tap-target block and the audit that measures it", () => {
    expect(globalsCss).toMatch(/:root \.account-nav a \{ min-height: var\(--touch-target\); \}/);
    expect(read("scripts/verify-mobile-layout.ts")).toMatch(/const touchTarget = 44;/);
  });
});

describe("C3: hidden text uses the global sr-only class", () => {
  const hiddenPatterns: Array<[string, RegExp]> = [
    ["clip: rect(0 ...)", /clip:\s*rect\(\s*0/],
    ["clip-path: inset(50%)", /clip-path:\s*inset\(\s*50%/],
    ["a 1px by 1px box", /width:\s*1px[^}]*height:\s*1px|height:\s*1px[^}]*width:\s*1px/],
  ];
  const offenders = modules.flatMap((module) => [
    ...module.rules.flatMap((rule) => hiddenPatterns.filter(([, pattern]) => pattern.test(rule.body)).map(([name]) => `${module.file}:${rule.line} ${rule.selector} hides text with ${name}`)),
    ...[...stripCssComments(module.source).matchAll(/\.(sr-?only|srOnly|visually-?hidden|visuallyHidden|screen-?reader-?only)\b/gi)].map((match) => `${module.file} defines ${match[0]}`),
  ]);

  it("has no visually hidden class or hiding pattern in any CSS module", () => {
    expect(offenders).toEqual([]);
  });

  it("detects the patterns it is meant to catch (the scanner itself)", () => {
    const [rule] = cssRules(".hidden { position: absolute; width: 1px; height: 1px; clip: rect(0, 0, 0, 0); }");
    expect(hiddenPatterns.filter(([, pattern]) => pattern.test(rule!.body)).length).toBe(2);
  });

  it("keeps the one global sr-only class", () => {
    expect(globalsRules.some((rule) => rule.selector === ".sr-only" && /clip:\s*rect\(0/.test(rule.body))).toBe(true);
  });

  it("uses no other visually hidden class name in a page or component", () => {
    const names = tsxFiles.flatMap((file) => [...read(file).matchAll(/className=(?:"|\{`)[^"`]*\b(visually-hidden|visuallyHidden|screen-reader-only|srOnly)\b/g)].map((match) => `${file}: ${match[1]}`));
    expect(names).toEqual([]);
  });
});

describe("C4: a fixed bar must not cover text", () => {
  /**
   * Every `position: fixed` rule (other than the page shell) is listed with what it is. A bar with a `<button>` in it is
   * an action bar: the audit's sticky-bar-covers-content check (#996) opens each page and fails when one sits over text,
   * so a new fixed rule here has to be classed by a person: an overlay that replaces the page on purpose, or a bar the
   * audit watches. Use a link trigger when a bar should not count as an action bar.
   */
  const reviewed: Record<string, string> = {
    ".skip-link": "overlay: skip link, only visible on focus",
    ".sidebar": "shell: the staff sidebar column",
    ".modal-backdrop": "overlay: dialog backdrop covers the page on purpose",
    ".mobile-nav": "bar: phone bottom navigation, links only; the audit watches it",
    ".searchable-select-picker": "overlay: open option list, closes on selection",
    ".team-more-menu-list": "overlay: open menu",
    ".sidebar-tooltip": "overlay: hover tooltip, no controls",
    ".more-launcher": "overlay: phone More sheet",
    ".more-launcher-scrim": "overlay: sheet backdrop",
    ".back-to-top-button": "bar: one 44px corner button; the audit's back-to-top check proves it sits on no other control",
    ".public-registration-attendee.is-sheet": "overlay: phone attendee sheet",
    ".event-gallery-backdrop": "overlay: gallery backdrop",
    ".system-menu-scrim": "overlay: menu backdrop",
    ".system-menu": "overlay: open menu",
    '.fb-shell[data-inspector="open"] .fb-sidebar': "overlay: builder inspector takes the whole phone screen",
    ".fb-phone-sheet": "overlay: builder phone sheet",
  };
  const fixed = allRules.filter((rule) => /position:\s*fixed/.test(rule.body) && !/^(html|body)\b/.test(rule.selector));

  it("has no fixed rule that is not reviewed here", () => {
    expect(fixed.filter((rule) => !(rule.selector in reviewed)).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`)).toEqual([]);
  });

  it("keeps the reviewed list honest: every entry is still a fixed rule", () => {
    const selectors = new Set(fixed.map((rule) => rule.selector));
    expect(Object.keys(reviewed).filter((selector) => !selectors.has(selector))).toEqual([]);
  });

  it("puts no fixed positioning in a component's inline style", () => {
    const inline = tsxFiles.filter((file) => /style=\{\{[^}]*position:\s*"fixed"/.test(read(file)));
    expect(inline).toEqual([]);
  });

  it("keeps the audit check that opens each page and looks for a bar over text", () => {
    const audit = read("scripts/verify-mobile-layout.ts");
    expect(audit).toContain("sticky-bar-covers-content");
    expect(audit).toContain("self-test bar action");
  });
});

describe("C5: where new CSS goes", () => {
  const builderMarker = "/* Registration form builder editor shell (#1132)";
  const settingsMarker = "/* Form settings tab";

  it("keeps both markers, in order", () => {
    const builder = globalsCss.indexOf(builderMarker);
    const settings = globalsCss.indexOf(settingsMarker);
    expect(builder).toBeGreaterThan(0);
    expect(settings).toBeGreaterThan(builder);
  });

  it("adds no new rule after the builder marker: new CSS goes before it, or in a CSS module", () => {
    const after = cssRules(globalsCss.slice(globalsCss.indexOf(builderMarker)));
    const counts: Record<string, number> = {};
    for (const rule of after) {
      const key = [...rule.at, rule.selector].join(" => ");
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const recorded = JSON.parse(read("tests/fixtures/globals-after-builder-marker-1440.json")) as Record<string, number>;
    const added = Object.keys(counts).filter((key) => (counts[key] ?? 0) > (recorded[key] ?? 0));
    expect(added, "new CSS in app/globals.css goes before the /* Registration form builder editor shell (#1132) marker").toEqual([]);
  });

  it("has no :hover rule after the Form settings marker", () => {
    const after = globalsCss.slice(globalsCss.indexOf(settingsMarker));
    expect(stripCssComments(after)).not.toMatch(/:hover/);
  });

  it("fails on a rule added after the marker (the check itself)", () => {
    const counts: Record<string, number> = { ".a": 1 };
    const recorded: Record<string, number> = { ".a": 1 };
    const sample = cssRules(".a { color: red; } .b { color: red; }");
    for (const rule of sample.slice(1)) counts[rule.selector] = (counts[rule.selector] ?? 0) + 1;
    expect(Object.keys(counts).filter((key) => (counts[key] ?? 0) > (recorded[key] ?? 0))).toEqual([".b"]);
  });
});

describe("C6: .field-help is overridden in a new layout", () => {
  /** `className={`field-help ${styles.name}`}` pairs: file, the CSS module that file imports, and the module class. */
  const pairs = tsxFiles.flatMap((file) => {
    const source = read(file);
    const imports = new Map([...source.matchAll(/import\s+(\w+)\s+from\s+"([^"]+\.module\.css)"/g)].map((match) => [match[1]!, match[2]!]));
    const found: Array<{ file: string; css: string; className: string }> = [];
    for (const match of source.matchAll(/className=(?:\{`|")([^"`]*)(?:`\}|")/g)) {
      const text = match[1]!;
      if (!/(^|\s)field-help(\s|$)/.test(text)) continue;
      for (const use of text.matchAll(/\$\{(\w+)\.(\w+)\}/g)) {
        const css = imports.get(use[1]!);
        if (css) found.push({ file, css: css.startsWith("@/") ? css.slice(2) : path.posix.join(path.posix.dirname(file), css), className: use[2]! });
      }
    }
    return found;
  });

  it("finds the layouts it is meant to check", () => {
    expect(pairs.length).toBeGreaterThan(10);
  });

  it("gives every module class that sits on .field-help its own margin, so the -9px pull never applies", () => {
    const missing = pairs.filter(({ css, className }) => {
      const rules = cssRules(read(css));
      return !rules.some((rule) => selectorParts(rule.selector).some((part) => part.includes(`.${className}`) && /field-help/.test(part)) && /(^|[;\s])margin(-top)?\s*:/.test(rule.body) && !/margin(-top)?\s*:\s*-/.test(rule.body))
        && !rules.some((rule) => selectorParts(rule.selector).some((part) => lastCompound(part) === `.${className}`) && /(^|[;\s])margin(-top)?\s*:/.test(rule.body) && !/margin(-top)?\s*:\s*-/.test(rule.body));
    });
    expect(missing.map(({ file, css, className }) => `${file}: .${className} has no margin override in ${css}`)).toEqual([]);
  });

  it("keeps the shared pull-up that the rule is about", () => {
    expect(globalsRules.some((rule) => rule.selector === ".field-help" && /margin:\s*-9px 0 0/.test(rule.body))).toBe(true);
  });

  it("keeps no negative margin on a module rule for .field-help", () => {
    const negative = modules.flatMap((module) => module.rules
      .filter((rule) => /field-help/.test(rule.selector) && /margin(-top)?\s*:\s*-/.test(rule.body))
      .map((rule) => `${module.file}:${rule.line} ${rule.selector}`));
    expect(negative).toEqual([]);
  });
});
