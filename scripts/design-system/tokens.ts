import postcss, { type AtRule, type Container } from "postcss";
import { normalizeSelector, splitSelectorList } from "./selectors";

/**
 * Design tokens read from the code (#1773). `token-notes.json` names each token
 * and writes its usage note; the value comes from the stylesheets when the note
 * has a `css` property, and is a documented literal when it has a `value`.
 */

export const DOCUMENTED_SOURCE = "documented value, not a CSS variable";
export const GLOBALS_FILE = "app/globals.css";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export interface TokenNote {
  name: string;
  usage: string;
  /** Custom property that holds the value, such as `--imsda-navy`. */
  css?: string;
  /** Read the property from this file instead of the :root blocks of globals.css. */
  file?: string;
  /** With `file`: read it from the rule with exactly this selector. */
  selector?: string;
  /** A documented literal, for values that are not CSS variables yet. */
  value?: string;
  /** Write the value a `var(--x)` chain ends in, not the reference (for aliases a test compares). */
  resolve?: boolean;
}

export interface TokenSection {
  note?: string;
  themes?: { id: string; name: string }[];
  tokens: TokenNote[];
}

export interface TokenNotes {
  type: Record<string, unknown> & { families: Record<string, string> };
  [section: string]: unknown;
}

export interface PropDefinition {
  prop: string;
  value: string;
  chain: string[];
  selector: string;
}

export interface TokenEntry {
  name: string;
  value: string | { light: string; dark: string };
  usage: string;
  source: string;
}

export interface TokenSources {
  /** Text of every stylesheet the notes can read, keyed by repository path. */
  files: Record<string, string>;
}

export interface TokenOutput {
  json: Record<string, unknown>;
  css: string;
  problems: string[];
  /** Name and base value of each token, for reporting differences from an older copy. */
  flat: Record<string, string>;
}

const ROOT_SELECTORS = new Set([":root", ':root:not([data-theme="light"])', ':root[data-theme="dark"]', ':root[data-theme="light"]']);
export const TOKEN_SECTIONS = ["color", "typeScale", "spacing", "radius", "shadow", "breakpoint", "zIndex", "other"] as const;

function chainOf(node: { parent?: Container | undefined }): string[] {
  const chain: string[] = [];
  let parent = node.parent;
  while (parent && parent.type === "atrule") {
    const atRule = parent as AtRule;
    chain.unshift(normalizeSelector(`@${atRule.name} ${atRule.params}`));
    parent = atRule.parent;
  }
  return chain;
}

/** Custom properties declared in :root blocks (also inside media queries), in source order. */
export function collectRootProps(css: string): PropDefinition[] {
  const found: PropDefinition[] = [];
  postcss.parse(css).walkRules((rule) => {
    const selectors = splitSelectorList(rule.selector).map(normalizeSelector);
    if (selectors.length === 0 || !selectors.every((selector) => ROOT_SELECTORS.has(selector))) return;
    const chain = chainOf(rule);
    const selector = selectors.join(", ");
    rule.each((node) => {
      if (node.type === "decl" && node.prop.startsWith("--")) {
        found.push({ prop: node.prop, value: node.value.trim(), chain, selector });
      }
      return undefined;
    });
  });
  return found;
}

/** The value of a property in the rule with this selector (or in any rule when no selector is given). */
export function findRuleProp(css: string, prop: string, selector?: string): string | undefined {
  let value: string | undefined;
  postcss.parse(css).walkRules((rule) => {
    if (selector && !splitSelectorList(rule.selector).map(normalizeSelector).includes(normalizeSelector(selector))) return;
    rule.each((node) => {
      if (node.type === "decl" && node.prop === prop && (value === undefined || selector)) value = node.value.trim();
      return undefined;
    });
  });
  return value;
}

const isDarkDefinition = (definition: PropDefinition) =>
  definition.chain.some((entry) => entry.includes(DARK_QUERY)) || definition.selector === ':root[data-theme="dark"]';

/** Light (or only) value: the last unconditional :root definition, else the first conditional one. */
export function baseValue(definitions: PropDefinition[], prop: string): string | undefined {
  const own = definitions.filter((definition) => definition.prop === prop && !isDarkDefinition(definition));
  const plain = own.filter((definition) => definition.chain.length === 0);
  return (plain[plain.length - 1] ?? own[0])?.value;
}

export function darkValue(definitions: PropDefinition[], prop: string): string | undefined {
  return definitions.find((definition) => definition.prop === prop && isDarkDefinition(definition))?.value;
}

function resolveReferences(value: string, definitions: PropDefinition[], seen = new Set<string>()): string {
  const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (!match || seen.has(match[1])) return value;
  seen.add(match[1]);
  const next = baseValue(definitions, match[1]);
  return next === undefined ? value : resolveReferences(next, definitions, seen);
}

/** `var(--x)` becomes `{x}`, as the published tokens.json writes references. */
export function toTokenValue(value: string): string {
  const match = /^var\(\s*--([\w-]+)\s*\)$/.exec(value);
  return match ? `{${match[1]}}` : value;
}

interface ResolvedToken {
  section: string;
  note: TokenNote;
  entry: TokenEntry;
  /** Custom property name to write in tokens.css for a token read from a rule or module. */
  cssName: string;
  base: string;
  /** Where tokens.css should write it. */
  kind: "app" | "scoped" | "documented";
}

function sectionTokens(notes: TokenNotes, section: string): TokenSection {
  const value = notes[section] as TokenSection | undefined;
  return value && Array.isArray(value.tokens) ? value : { tokens: [] };
}

function groupByContext(entries: { definition: PropDefinition; value: string }[]) {
  const order: string[] = [];
  const groups = new Map<string, { chain: string[]; selector: string; props: Map<string, string> }>();
  for (const { definition, value } of entries) {
    const key = `${definition.chain.join(" > ")}||${definition.selector}`;
    let group = groups.get(key);
    if (!group) {
      group = { chain: definition.chain, selector: definition.selector, props: new Map() };
      groups.set(key, group);
      order.push(key);
    }
    group.props.set(definition.prop, value);
  }
  // The plain :root block first, then the rest in the order the code declares them.
  order.sort((a, b) => Number(groups.get(a)?.chain.length !== 0 || groups.get(a)?.selector !== ":root") - Number(groups.get(b)?.chain.length !== 0 || groups.get(b)?.selector !== ":root"));
  return order.map((key) => groups.get(key)!);
}

function writeBlock(group: { chain: string[]; selector: string; props: Map<string, string> }): string {
  let indent = "";
  let out = "";
  for (const at of group.chain) {
    out += `${indent}${at} {\n`;
    indent += "  ";
  }
  out += `${indent}${group.selector} {\n`;
  for (const [prop, value] of group.props) out += `${indent}  ${prop}: ${value};\n`;
  out += `${indent}}\n`;
  for (let i = group.chain.length - 1; i >= 0; i -= 1) out += `${"  ".repeat(i)}}\n`;
  return out;
}

export function buildTokens(notes: TokenNotes, sources: TokenSources, fontFaces: string, header: string): TokenOutput {
  const problems: string[] = [];
  const globals = sources.files[GLOBALS_FILE];
  if (globals === undefined) throw new Error(`${GLOBALS_FILE} was not read.`);
  const definitions = collectRootProps(globals);
  const claimed = new Set<string>();
  const resolved: ResolvedToken[] = [];
  const seenNames = new Map<string, string>();

  for (const section of TOKEN_SECTIONS) {
    for (const note of sectionTokens(notes, section).tokens) {
      const label = `token-notes.json: ${section} "${note.name}"`;
      if (seenNames.has(note.name)) problems.push(`${label} is listed twice (also in ${seenNames.get(note.name)}).`);
      seenNames.set(note.name, section);
      if (note.value !== undefined && note.css) problems.push(`${label} has both "value" and "css"; use one.`);
      if (note.value !== undefined) {
        resolved.push({ section, note, cssName: `--${note.name}`, base: note.value, kind: "documented", entry: { name: note.name, value: note.value, usage: note.usage, source: DOCUMENTED_SOURCE } });
        continue;
      }
      if (!note.css) {
        problems.push(`${label} has neither "css" nor "value".`);
        continue;
      }
      if (note.file) {
        const text = sources.files[note.file];
        const found = text === undefined ? undefined : findRuleProp(text, note.css, note.selector);
        if (found === undefined) {
          problems.push(`${label} names ${note.css}${note.selector ? ` in "${note.selector}"` : ""} but ${note.file} does not define it any more. Update token-notes.json.`);
          continue;
        }
        resolved.push({ section, note, cssName: `--${note.name}`, base: found, kind: "scoped", entry: { name: note.name, value: toTokenValue(found), usage: note.usage, source: note.selector ? `${note.file} (${note.selector})` : note.file } });
        continue;
      }
      claimed.add(note.css);
      const base = baseValue(definitions, note.css);
      if (base === undefined) {
        problems.push(`${label} names ${note.css} but ${GLOBALS_FILE} does not define it in a :root block any more. Update token-notes.json.`);
        continue;
      }
      const dark = darkValue(definitions, note.css);
      const final = note.resolve ? resolveReferences(base, definitions) : base;
      const finalDark = dark === undefined ? undefined : note.resolve ? resolveReferences(dark, definitions) : dark;
      resolved.push({
        section,
        note,
        cssName: note.css,
        base: final,
        kind: "app",
        entry: {
          name: note.name,
          value: finalDark === undefined ? toTokenValue(final) : { light: toTokenValue(final), dark: toTokenValue(finalDark) },
          usage: note.usage,
          source: GLOBALS_FILE,
        },
      });
    }
  }

  // Anything the app defines that the notes do not describe yet still goes out, so a new token fails the check until synced.
  const undescribed: string[] = [];
  for (const definition of definitions) {
    if (claimed.has(definition.prop) || undescribed.includes(definition.prop)) continue;
    undescribed.push(definition.prop);
  }
  for (const prop of undescribed) {
    const base = baseValue(definitions, prop) ?? "";
    const dark = darkValue(definitions, prop);
    const name = prop.slice(2);
    const section = "other";
    const note: TokenNote = { name, usage: "Not described yet.", css: prop };
    resolved.push({
      section,
      note,
      cssName: prop,
      base,
      kind: "app",
      entry: {
        name,
        value: dark === undefined ? toTokenValue(base) : { light: toTokenValue(base), dark: toTokenValue(dark) },
        usage: note.usage,
        source: GLOBALS_FILE,
      },
    });
  }

  const json: Record<string, unknown> = { name: "IMAdventist", version: 1 };
  const flat: Record<string, string> = {};
  for (const section of TOKEN_SECTIONS) {
    const tokens = resolved.filter((token) => token.section === section).map((token) => token.entry);
    for (const token of resolved.filter((entry) => entry.section === section)) {
      flat[`${section}/${token.entry.name}`] = typeof token.entry.value === "string" ? token.entry.value : `${token.entry.value.light} | dark ${token.entry.value.dark}`;
    }
    if (section === "other" && tokens.length === 0) continue;
    const source = sectionTokens(notes, section);
    const out: Record<string, unknown> = {};
    if (source.themes) out.themes = source.themes;
    if (source.note) out.note = source.note;
    out.tokens = tokens;
    json[section] = out;
    if (section === "color") json.type = notes.type;
  }
  // Keep the published order: color, type, then the rest.
  const ordered: Record<string, unknown> = {};
  for (const key of ["name", "version", "color", "type", "typeScale", "spacing", "radius", "shadow", "breakpoint", "zIndex", "other"]) {
    if (key in json) ordered[key] = json[key];
  }
  ordered.meta = notes.meta;

  // tokens.css
  let css = `/* ${header} */\n${fontFaces.trim()}\n`;
  const appTokens = resolved.filter((token) => token.kind === "app");
  const overrides = new Map(appTokens.filter((token) => token.note.resolve).map((token) => [token.cssName, token.base]));
  css += "\n/* Custom properties the app defines in its :root blocks (app/globals.css), in the media queries the app uses. */\n";
  for (const group of groupByContext(definitions.map((definition) => ({ definition, value: overrides.get(definition.prop) ?? definition.value })))) {
    css += writeBlock(group);
  }
  const scoped = resolved.filter((token) => token.kind === "scoped");
  if (scoped.length > 0) {
    css += "\n/* Values the app sets on a single rule or CSS module, written as :root variables so the documented token name works anywhere. */\n:root {\n";
    for (const token of scoped) css += `  ${token.cssName}: ${token.base}; /* ${typeof token.entry.source === "string" ? token.entry.source : ""} */\n`;
    css += "}\n";
  }
  const documented = resolved.filter((token) => token.kind === "documented");
  const families = Object.entries(notes.type.families).map(([key, value]) => [`--font-${key}`, value] as const);
  css += "\n/* Documented values that are not CSS variables in the app yet, and the font stacks. */\n:root {\n";
  for (const [prop, value] of families) css += `  ${prop}: ${value};\n`;
  for (const token of documented) css += `  ${token.cssName}: ${token.base};\n`;
  css += "}\n";

  return { json: ordered, css, problems, flat };
}
