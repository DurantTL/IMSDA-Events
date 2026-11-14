import { describe, expect, it } from "vitest";
import { buildDesignSystem, compareWithDisk, firstParagraphHtml, parsePreview, previewUsage } from "../scripts/design-system/build";
import { extractCss } from "../scripts/design-system/css-extract";
import { classesInCompound, prefixModuleSelector, splitCompounds, splitSelectorList, subjectClasses, subjectCompound } from "../scripts/design-system/selectors";
import { baseValue, buildTokens, collectRootProps, darkValue, findRuleProp, toTokenValue, type TokenNotes } from "../scripts/design-system/tokens";

/** #1773: the design system is generated from the code. Pure-function tests on small fixture CSS. */

describe("selector helpers", () => {
  it("splits a selector list on top-level commas only", () => {
    expect(splitSelectorList(".a, .b:is(.c, .d), [data-x='1,2'], :not(.e, .f)")).toEqual([".a", ".b:is(.c, .d)", "[data-x='1,2']", ":not(.e, .f)"]);
  });

  it("splits compounds on top-level combinators, not inside parentheses or brackets", () => {
    expect(splitCompounds(".a > .b + .c ~ .d .e")).toEqual([".a", ".b", ".c", ".d", ".e"]);
    expect(splitCompounds(".a:nth-child(2n+1) [href~='x y'] .b")).toEqual([".a:nth-child(2n+1)", "[href~='x y']", ".b"]);
    expect(subjectCompound(":where(.app-shell, .x) :where(input:not([type])).field")).toBe(":where(input:not([type])).field");
  });

  it("reads classes from the subject compound, including :is() and :where() but not :not() or :has()", () => {
    expect(subjectClasses(".panel .status-chip.green")).toEqual(["status-chip", "green"]);
    expect(subjectClasses(".host :is(.one, .two a)")).toEqual(["one"]);
    expect(subjectClasses("a:where(.three)")).toEqual(["three"]);
    expect(subjectClasses(".row:not(.skip):has(.inner)")).toEqual(["row"]);
    expect(classesInCompound(".x\\:y.z")).toEqual(["x:y", "z"]);
  });

  it("prefixes module classes, unwraps :global() and leaves attributes and strings alone", () => {
    expect(prefixModuleSelector(".link:hover .icon", "nav")).toBe(".nav__link:hover .nav__icon");
    expect(prefixModuleSelector(".page :global(.public-brand) > .name", "home")).toBe(".home__page .public-brand > .home__name");
    expect(prefixModuleSelector(".a[data-x='.b']:not(.c)", "m")).toBe(".m__a[data-x='.b']:not(.m__c)");
  });
});

describe("extractCss", () => {
  const css = `
.keep { color: red; }
.other { color: blue; }
.host .keep { color: green; }
.keep .inner { color: pink; }
.chip.tone { color: teal; }
:is(.keep, .nope):hover { color: gold; }
:not(.keep) { color: black; }
@media (max-width: 600px) { .keep { color: navy; } .other { color: lime; } }
@media print { .other { color: aqua; } }
@supports (display: grid) { @media (min-width: 10px) { .keep { display: grid; } } }
.pulse { animation: fade 1s; }
.still { animation: unused 1s; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes unused { from { opacity: 0; } to { opacity: 1; } }
@font-face { font-family: X; src: url(x.woff2); }
`;

  it("keeps a rule when its subject compound holds a listed class, and nothing else", () => {
    const result = extractCss(css, "app/globals.css", [{ part: "P", file: "app/globals.css", classes: ["keep", "tone", "pulse"] }]);
    expect(result.css).toContain(".keep { color: red; }");
    expect(result.css).toContain(".host .keep { color: green; }");
    expect(result.css).toContain(".chip.tone { color: teal; }");
    expect(result.css).toContain(":is(.keep, .nope):hover { color: gold; }");
    expect(result.css).not.toContain(".other");
    expect(result.css).not.toContain(".keep .inner");
    expect(result.css).not.toContain(":not(.keep)");
    expect(result.css).not.toContain("@font-face");
    expect(result.hits.get("P|class|keep")).toBeGreaterThan(0);
    expect(result.hits.get("P|class|tone")).toBe(1);
  });

  it("keeps wrapping at-rules around kept rules only", () => {
    const result = extractCss(css, "app/globals.css", [{ part: "P", file: "app/globals.css", classes: ["keep"] }]);
    expect(result.css).toMatch(/@media \(max-width: 600px\) \{\s*\.keep \{ color: navy; \}\s*\}/);
    expect(result.css).not.toContain("lime");
    expect(result.css).not.toContain("@media print");
    expect(result.css).toMatch(/@supports \(display: grid\) \{\s*@media \(min-width: 10px\) \{\s*\.keep \{ display: grid; \}/);
  });

  it("includes a @keyframes only when a kept rule uses it", () => {
    const result = extractCss(css, "app/globals.css", [{ part: "P", file: "app/globals.css", classes: ["pulse"] }]);
    expect(result.css).toContain("@keyframes fade");
    expect(result.css).not.toContain("@keyframes unused");
  });

  it("keeps descendant rules of a scope class and rules whose selector equals a listed one", () => {
    const scoped = extractCss(css, "app/globals.css", [{ part: "P", file: "app/globals.css", scopes: ["host"] }]);
    expect(scoped.css).toContain(".host .keep { color: green; }");
    expect(scoped.css).not.toContain(".keep { color: red; }");
    const exact = extractCss(css, "app/globals.css", [{ part: "P", file: "app/globals.css", selectors: [":not(.keep)"] }]);
    expect(exact.css).toContain(":not(.keep) { color: black; }");
    expect(exact.hits.get("P|selector|:not(.keep)")).toBe(1);
  });

  it("prefixes CSS module classes, unwraps :global() and drops composes", () => {
    const moduleCss = `
.link { composes: base from "./other.module.css"; color: red; }
.nav :global(.public-brand) img { width: 1px; }
.link { animation: slide 1s; }
@keyframes slide { from { opacity: 0; } to { opacity: 1; } }
.unlisted { color: blue; }
`;
    const result = extractCss(moduleCss, "components/brand-link.module.css", [{ part: "P", file: "components/brand-link.module.css", classes: ["link", "public-brand"], scopes: ["public-brand"] }]);
    expect(result.css).toContain(".brand-link__link { color: red; }");
    expect(result.css).not.toContain("composes");
    expect(result.css).toContain(".brand-link__nav .public-brand img { width: 1px; }");
    expect(result.css).toContain("animation: brand-link__slide 1s");
    expect(result.css).toContain("@keyframes brand-link__slide");
    expect(result.css).not.toContain("unlisted");
  });

  it("keeps every rule of a module listed without classes", () => {
    const result = extractCss(".a { color: red; } .b { color: blue; }", "components/x.module.css", [{ part: "P", file: "components/x.module.css" }]);
    expect(result.css).toContain(".x__a");
    expect(result.css).toContain(".x__b");
  });
});

describe("tokens", () => {
  const globals = `
:root { --navy: #003b5c; --ink: #111; --focus: var(--navy); --radius-a: 10px; --radius-alias: var(--radius-a); --new-thing: 4px; }
@media screen { :root { --type-floor: 0.75rem; } }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink: #eee; } }
:root[data-theme="dark"] { --ink: #eee; }
.app-shell { --scoped: 1px; }
.calendar-tone-1 { --cal-fill: #f3edfa; }
`;
  const moduleCss = ".page { --home-green: rgb(85 115 52); }";
  const notes = {
    type: { fonts: [], families: { sans: "Arial" }, groups: [] },
    meta: { repo: "x" },
    color: { themes: [{ id: "light", name: "Light" }], tokens: [
      { name: "navy", usage: "Navy.", css: "--navy" },
      { name: "ink", usage: "Text.", css: "--ink" },
      { name: "focus", usage: "Ring.", css: "--focus" },
      { name: "home-green", usage: "Home.", css: "--home-green", file: "components/home.module.css" },
      { name: "cal-tone-1-fill", usage: "Tone.", css: "--cal-fill", file: "app/globals.css", selector: ".calendar-tone-1" },
      { name: "documented", usage: "Hand value.", value: "#abcdef" },
    ] },
    radius: { tokens: [{ name: "radius-alias", usage: "Alias.", css: "--radius-alias", resolve: true }] },
    typeScale: { tokens: [{ name: "type-floor", usage: "Floor.", css: "--type-floor" }] },
  } as unknown as TokenNotes;
  const files = { "app/globals.css": globals, "components/home.module.css": moduleCss };

  it("reads root custom properties with their media context", () => {
    const definitions = collectRootProps(globals);
    expect(definitions.map((definition) => definition.prop)).not.toContain("--scoped");
    expect(baseValue(definitions, "--ink")).toBe("#111");
    expect(darkValue(definitions, "--ink")).toBe("#eee");
    expect(baseValue(definitions, "--type-floor")).toBe("0.75rem");
    expect(findRuleProp(globals, "--cal-fill", ".calendar-tone-1")).toBe("#f3edfa");
    expect(toTokenValue("var(--navy)")).toBe("{navy}");
    expect(toTokenValue("var(--navy, #000)")).toBe("var(--navy, #000)");
  });

  it("writes light and dark values, references, documented literals and a source for each token", () => {
    const result = buildTokens(notes, { files }, "@font-face { font-family: X; }", "Generated.");
    expect(result.problems).toEqual([]);
    const tokens = (result.json.color as { tokens: { name: string; value: unknown; source: string }[] }).tokens;
    const byName = (name: string) => tokens.find((token) => token.name === name)!;
    expect(byName("navy")).toMatchObject({ value: "#003b5c", source: "app/globals.css" });
    expect(byName("ink").value).toEqual({ light: "#111", dark: "#eee" });
    expect(byName("focus").value).toBe("{navy}");
    expect(byName("home-green")).toMatchObject({ value: "rgb(85 115 52)", source: "components/home.module.css" });
    expect(byName("cal-tone-1-fill")).toMatchObject({ value: "#f3edfa", source: "app/globals.css (.calendar-tone-1)" });
    expect(byName("documented")).toMatchObject({ value: "#abcdef", source: "documented value, not a CSS variable" });
    const radius = (result.json.radius as { tokens: { value: string }[] }).tokens[0];
    expect(radius.value).toBe("10px");
  });

  it("puts a custom property the notes do not describe into the other group", () => {
    const result = buildTokens(notes, { files }, "", "Generated.");
    const other = (result.json.other as { tokens: { name: string; usage: string }[] }).tokens;
    expect(other.map((token) => token.name)).toEqual(["radius-a", "new-thing"]);
    expect(other.every((token) => token.usage === "Not described yet.")).toBe(true);
    expect(result.css).toContain("--new-thing: 4px;");
  });

  it("writes tokens.css with the app's media queries and the documented values", () => {
    const { css } = buildTokens(notes, { files }, "@font-face { font-family: X; }", "Generated header.");
    expect(css.startsWith("/* Generated header. */")).toBe(true);
    expect(css).toContain("@font-face { font-family: X; }");
    expect(css).toMatch(/:root \{\n {2}--navy: #003b5c;/);
    expect(css).toMatch(/@media screen \{\n {2}:root \{\n {4}--type-floor: 0\.75rem;/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme="light"\]\) \{\n {4}--ink: #eee;/);
    expect(css).toContain("--radius-alias: 10px;");
    expect(css).toContain("--documented: #abcdef;");
    expect(css).toContain("--font-sans: Arial;");
    expect(css).not.toContain("--scoped");
  });

  it("fails with a clear message when a noted property no longer exists", () => {
    const broken = { ...notes, color: { tokens: [{ name: "gone", usage: "Gone.", css: "--gone" }, { name: "gone-module", usage: "Gone.", css: "--nope", file: "components/home.module.css" }] } } as unknown as TokenNotes;
    const { problems } = buildTokens(broken, { files }, "", "Generated.");
    expect(problems[0]).toContain('"gone" names --gone but app/globals.css does not define it in a :root block any more');
    expect(problems[1]).toContain("--nope");
  });

  it("is deterministic", () => {
    const first = buildTokens(notes, { files }, "", "Generated.");
    const second = buildTokens(notes, { files }, "", "Generated.");
    expect(JSON.stringify(first.json)).toBe(JSON.stringify(second.json));
    expect(first.css).toBe(second.css);
  });
});

describe("previews and READMEs", () => {
  it("reads the card header and the markup after it", () => {
    expect(parsePreview('<!-- @dsCard group="Actions" height=230 -->\n<div>x</div>\n')).toEqual({ group: "Actions", height: 230, body: "<div>x</div>" });
    expect(parsePreview("<div>no header</div>").height).toBeUndefined();
  });

  it("uses the first paragraph of a README as inline HTML", () => {
    expect(firstParagraphHtml("A menu (`<details>`) with **Actions**\nand more.\n\n- second paragraph")).toBe("A menu (<code>&lt;details&gt;</code>) with <strong>Actions</strong> and more.");
  });

  it("lists the classes and variables a preview uses, apart from its own style block", () => {
    const usage = previewUsage('<!-- c --><style>.own { color: var(--local); --local: 1px; }</style><div class="a own"><span class=\'b\' style="color: var(--tone)"></span></div>');
    expect(usage.classes.sort()).toEqual(["a", "b", "own"]);
    expect([...usage.ownClasses]).toEqual(["own"]);
    expect(usage.variables).toContain("--tone");
    expect(usage.ownVariables.has("--local")).toBe(true);
  });
});

describe("the check", () => {
  const manifest = { groups: ["Actions"], parts: [{ name: "Button", group: "Actions", readme: "components/design-system/Button.md", css: [{ file: "app/globals.css", classes: ["primary-button"] }] }] };
  const notes = { type: { fonts: [], families: { sans: "Arial" }, groups: [] }, meta: { repo: "x" }, color: { tokens: [{ name: "navy", usage: "Navy.", css: "--navy" }] } };
  const sources: Record<string, string> = {
    "scripts/design-system/parts.json": JSON.stringify(manifest),
    "scripts/design-system/token-notes.json": JSON.stringify(notes),
    "scripts/design-system/preview-base.css": ".ds-stage { padding: 20px; }",
    "scripts/design-system/fonts.css": "@font-face { font-family: X; }",
    "app/globals.css": ":root { --navy: #003b5c; }\n.primary-button { background: var(--navy); }\n.other { color: red; }",
    "components/design-system/Button.md": "Buttons for every action.\n\n- One primary per view.\n",
    "docs/design-system/components/Button/preview.html": '<!-- @dsCard group="Actions" height=200 -->\n<div class="ds-stage"><button class="primary-button">Save</button></div>\n',
  };
  const read = (files: Record<string, string>) => (path: string) => files[path];
  const build = (files: Record<string, string>) => buildDesignSystem(read(files), () => ["Button"]);

  it("builds every generated file without problems and compares clean with itself", () => {
    const built = build(sources);
    expect(built.problems).toEqual([]);
    expect([...built.files.keys()].sort()).toEqual([
      "docs/design-system/components/Button/README.md",
      "docs/design-system/components/bundle.css",
      "docs/design-system/gallery.html",
      "docs/design-system/tokens.css",
      "docs/design-system/tokens.json",
    ]);
    const onDisk = Object.fromEntries(built.files);
    expect(compareWithDisk(built.files, read(onDisk), ["docs/design-system/components/Button/README.md"])).toEqual([]);
  });

  it("writes nothing that depends on the date, a commit or an absolute path", () => {
    const text = [...build(sources).files.values()].join("\n");
    expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(text).not.toMatch(/\b[0-9a-f]{7,40}\b(?<![0-9]{7,})/);
    expect(text).not.toMatch(/\/home\/|\/Users\/|[A-Z]:\\/);
    expect(JSON.stringify([...build(sources).files])).toBe(JSON.stringify([...build(sources).files]));
  });

  it("starts each generated file with a note naming the command and its sources", () => {
    const files = build(sources).files;
    expect(files.get("docs/design-system/components/bundle.css")).toMatch(/^\/\* Generated by npm run design-system:sync from scripts\/design-system\/preview-base\.css, app\/globals\.css\./);
    expect(files.get("docs/design-system/tokens.css")).toMatch(/^\/\* Generated by npm run design-system:sync from app\/globals\.css/);
    expect(files.get("docs/design-system/components/Button/README.md")).toMatch(/^<!-- Generated by npm run design-system:sync from components\/design-system\/Button\.md\. Edit that file, not this one\. -->\n/);
    expect(files.get("docs/design-system/gallery.html")).toContain("Generated by npm run design-system:sync");
    expect((JSON.parse(files.get("docs/design-system/tokens.json")!) as { meta: { generated: string } }).meta.generated).toContain("npm run design-system:sync");
  });

  it("reports a stale file after the code changes, and a missing one", () => {
    const built = build(sources);
    const onDisk = Object.fromEntries(built.files);
    const changed = { ...sources, "app/globals.css": sources["app/globals.css"].replace("#003b5c", "#003b5d") };
    const after = build(changed);
    const lines = compareWithDisk(after.files, read(onDisk), []);
    expect(lines).toContain("stale: docs/design-system/tokens.json");
    expect(lines).toContain("stale: docs/design-system/tokens.css");
    delete onDisk["docs/design-system/gallery.html"];
    expect(compareWithDisk(built.files, read(onDisk), [])).toEqual(["missing: docs/design-system/gallery.html"]);
  });

  it("reports an extra README as unexpected", () => {
    const built = build(sources);
    expect(compareWithDisk(built.files, read(Object.fromEntries(built.files)), ["docs/design-system/components/Old/README.md"])[0]).toContain("unexpected: docs/design-system/components/Old/README.md");
  });

  it("fails when a preview uses a class that is in neither the bundle nor its own style, and names the part", () => {
    const html = '<!-- @dsCard group="Actions" height=200 -->\n<div class="ds-stage"><button class="primary-button recreated">Save</button></div>\n';
    const { problems } = build({ ...sources, "docs/design-system/components/Button/preview.html": html });
    expect(problems).toEqual([expect.stringContaining('class "recreated" is in neither bundle.css nor the preview\'s own <style> (part Button)')]);
    const withStyle = '<!-- @dsCard group="Actions" height=200 -->\n<style>.recreated { color: red; }</style>\n<div class="ds-stage"><button class="primary-button recreated">Save</button></div>\n';
    expect(build({ ...sources, "docs/design-system/components/Button/preview.html": withStyle }).problems).toEqual([]);
  });

  it("fails when a preview reads a custom property nothing defines", () => {
    const html = '<!-- @dsCard group="Actions" height=200 -->\n<div class="ds-stage" style="color: var(--missing)"><button class="primary-button">Save</button></div>\n';
    expect(build({ ...sources, "docs/design-system/components/Button/preview.html": html }).problems[0]).toContain("--missing is not defined");
  });

  it("fails when a listed class matches no rule, or a preview has no entry in parts.json", () => {
    const gone = { ...manifest, parts: [{ ...manifest.parts[0], css: [{ file: "app/globals.css", classes: ["primary-button", "renamed-away"] }] }] };
    expect(build({ ...sources, "scripts/design-system/parts.json": JSON.stringify(gone) }).problems[0]).toContain('lists class "renamed-away"');
    expect(buildDesignSystem(read(sources), () => ["Button", "Stray"]).problems[0]).toContain("Stray/preview.html has no entry");
  });

  it("fails when a token note names a property the code no longer defines", () => {
    const stale = { ...notes, color: { tokens: [{ name: "navy", usage: "Navy.", css: "--navy-renamed" }] } };
    expect(build({ ...sources, "scripts/design-system/token-notes.json": JSON.stringify(stale) }).problems[0]).toContain("--navy-renamed");
  });
});
