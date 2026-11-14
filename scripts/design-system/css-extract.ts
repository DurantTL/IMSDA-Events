import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Rule } from "postcss";
import { classesInCompound, normalizeSelector, prefixModuleSelector, splitCompounds, splitSelectorList, subjectClasses } from "./selectors";

/** One CSS source of a documented part (an entry of `css` in parts.json). */
export interface CssSource {
  part: string;
  file: string;
  classes?: string[];
  selectors?: string[];
  /** Classes whose descendant rules are kept: a rule where one of these is in a compound before the subject (`.report-table th`). */
  scopes?: string[];
  /** Keep every rule of the file. */
  all?: boolean;
}

export interface ExtractResult {
  css: string;
  /** How many rules each listed class or selector matched, keyed by `part|kind|value`. */
  hits: Map<string, number>;
  problems: string[];
}

const WRAPPING_AT_RULES = new Set(["media", "supports", "container", "layer"]);

export const hitKey = (part: string, kind: "class" | "selector" | "scope", value: string) => `${part}|${kind}|${value}`;

export function isModuleFile(file: string): boolean {
  return /\.module\.css$/.test(file);
}

export function modulePrefix(file: string): string {
  return (file.split("/").pop() ?? file).replace(/\.module\.css$/, "");
}

function ruleMatches(rule: Rule, sources: CssSource[], wholeFile: boolean, hits: Map<string, number>): boolean {
  const selectors = splitSelectorList(rule.selector);
  const normalized = selectors.map(normalizeSelector);
  const subjects = new Set(selectors.flatMap(subjectClasses));
  const ancestors = new Set(selectors.flatMap((selector) => splitCompounds(selector).slice(0, -1).flatMap(classesInCompound)));
  let matched = false;
  for (const source of sources) {
    for (const name of source.classes ?? []) {
      if (subjects.has(name)) {
        matched = true;
        hits.set(hitKey(source.part, "class", name), (hits.get(hitKey(source.part, "class", name)) ?? 0) + 1);
      }
    }
    for (const name of source.scopes ?? []) {
      if (ancestors.has(name)) {
        matched = true;
        hits.set(hitKey(source.part, "scope", name), (hits.get(hitKey(source.part, "scope", name)) ?? 0) + 1);
      }
    }
    for (const selector of source.selectors ?? []) {
      if (normalized.includes(normalizeSelector(selector))) {
        matched = true;
        hits.set(hitKey(source.part, "selector", selector), (hits.get(hitKey(source.part, "selector", selector)) ?? 0) + 1);
      }
    }
  }
  return matched || wholeFile;
}

function keyframeNames(css: string): string[] {
  const names = new Set<string>();
  postcss.parse(css).walkAtRules(/keyframes$/, (atRule) => {
    names.add(atRule.params.trim());
  });
  return [...names];
}

function usesAnimation(declaration: Declaration, names: Set<string>): string[] {
  if (!/^(-webkit-)?animation(-name)?$/i.test(declaration.prop)) return [];
  return declaration.value.split(/[\s,]+/).filter((token) => names.has(token));
}

function renameKeyframes(value: string, names: Set<string>, prefix: string): string {
  return value
    .split(/(\s+|,)/)
    .map((token) => (names.has(token) ? `${prefix}__${token}` : token))
    .join("");
}

/**
 * One pass over a stylesheet. A style rule is kept when one of its selectors'
 * subject compound holds one of the listed classes, or when the selector equals
 * a listed one. A file listed without classes or selectors, and not a module,
 * keeps nothing; a module listed that way keeps every rule. Wrapping at-rules
 * stay around kept rules, and a @keyframes comes along when a kept rule uses it.
 */
export function extractCss(text: string, file: string, sources: CssSource[]): ExtractResult {
  const isModule = isModuleFile(file);
  const prefix = modulePrefix(file);
  const hits = new Map<string, number>();
  const problems: string[] = [];
  const wholeFile = sources.some((source) => source.all) || (isModule && sources.some((source) => !source.classes?.length && !source.selectors?.length && !source.scopes?.length));
  const root = postcss.parse(text, { from: file });
  const allKeyframes = new Set(keyframeNames(text));
  const keyframes: AtRule[] = [];
  const used = new Set<string>();

  root.walkAtRules(/keyframes$/, (atRule) => {
    keyframes.push(atRule);
  });

  function keepRule(rule: Rule): Rule | null {
    if (rule.some((node) => node.type === "rule")) {
      problems.push(`${file}: nested rule inside "${normalizeSelector(rule.selector)}" is not supported by the sync.`);
      return null;
    }
    if (!ruleMatches(rule, sources, wholeFile, hits)) return null;
    const clone = rule.clone();
    clone.raws.before = "\n";
    clone.walkDecls((declaration) => {
      if (declaration.prop === "composes") {
        declaration.remove();
        return;
      }
      for (const name of usesAnimation(declaration, allKeyframes)) used.add(name);
      if (isModule && /^(-webkit-)?animation(-name)?$/i.test(declaration.prop)) {
        declaration.value = renameKeyframes(declaration.value, allKeyframes, prefix);
      }
    });
    if (isModule) clone.selector = prefixModuleSelector(clone.selector, prefix);
    return clone;
  }

  function walk(container: Container): ChildNode[] {
    const kept: ChildNode[] = [];
    container.each((node) => {
      if (node.type === "rule") {
        const clone = keepRule(node);
        if (clone) kept.push(clone);
      } else if (node.type === "atrule" && WRAPPING_AT_RULES.has(node.name.toLowerCase()) && node.nodes) {
        const inner = walk(node);
        if (inner.length > 0) {
          const wrapper = node.clone();
          wrapper.removeAll();
          wrapper.raws.before = "\n";
          for (const child of inner) wrapper.append(child);
          kept.push(wrapper);
        }
      }
      return undefined;
    });
    return kept;
  }

  const body = walk(root);
  const out = postcss.root();
  for (const node of body) out.append(node);
  for (const frames of keyframes) {
    const name = frames.params.trim();
    if (!used.has(name)) continue;
    const clone = frames.clone();
    clone.raws.before = "\n";
    if (isModule) clone.params = `${prefix}__${name}`;
    out.append(clone);
  }

  return { css: out.toString().trim(), hits, problems };
}

/** Every class that appears anywhere in a stylesheet's selectors. */
export function classesDefinedIn(css: string, allClassesInSelector: (selector: string) => string[]): Set<string> {
  const names = new Set<string>();
  postcss.parse(css).walkRules((rule) => {
    for (const selector of splitSelectorList(rule.selector)) {
      for (const name of allClassesInSelector(selector)) names.add(name);
    }
  });
  return names;
}
