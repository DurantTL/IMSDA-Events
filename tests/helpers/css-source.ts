import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Shared source readers for the rule guard tests (#1440). Plain file reads: no network, database or dev server. */
export const root = process.cwd();

export function read(file: string) {
  return readFileSync(path.join(root, file), "utf8");
}

/** Every file under `dirs` (relative to the repository root) whose name ends with one of `suffixes`. */
export function sourceFiles(dirs: string[], suffixes: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(root, dir))) {
      if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
      const relative = `${dir}/${name}`;
      if (statSync(path.join(root, relative)).isDirectory()) walk(relative);
      else if (suffixes.some((suffix) => name.endsWith(suffix))) found.push(relative);
    }
  };
  for (const dir of dirs) walk(dir);
  return found.sort();
}

export const moduleCssFiles = () => sourceFiles(["app", "components", "modules"], [".module.css"]);

/** The CSS with every comment blanked out but its line breaks kept, so a character index still maps to a line. */
export function stripCssComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

export type CssRule = {
  /** The selector text, whitespace collapsed. */
  selector: string;
  /** The declarations between the braces (nested at-rules are separate rules). */
  body: string;
  /** The enclosing at-rule preludes, outermost first, such as `@media (max-width: 700px)`. */
  at: string[];
  line: number;
};

/** A small flat CSS reader: every style rule with its enclosing at-rules. Good enough to scan, not to render. */
export function cssRules(source: string): CssRule[] {
  const css = stripCssComments(source);
  const out: CssRule[] = [];
  const stack: Array<{ head: string; isAt: boolean; open: number }> = [];
  let head = "";
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      const text = head.trim();
      stack.push({ head: text.replace(/\s+/g, " "), isAt: text.startsWith("@"), open: index });
      head = "";
    } else if (char === "}") {
      const top = stack.pop();
      if (top && !top.isAt) {
        out.push({
          selector: top.head,
          body: css.slice(top.open + 1, index),
          at: stack.filter((entry) => entry.isAt).map((entry) => entry.head),
          line: css.slice(0, top.open).split("\n").length,
        });
      }
      head = "";
    } else if (char === ";" && stack.length === 0) {
      head = "";
    } else {
      head += char;
    }
  }
  return out;
}

/** The comma-separated parts of a selector list, outside any parentheses. */
export function selectorParts(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selector) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The last compound selector of one selector part (`.a .b:hover` gives `.b:hover`). */
export function lastCompound(part: string) {
  const stripped = part.replace(/:global\(([^()]*)\)/g, "$1").replace(/\([^()]*\)/g, "");
  const pieces = stripped.split(/[\s>+~]+/).filter(Boolean);
  return pieces[pieces.length - 1] ?? "";
}

/** The first value written for a property in a rule body, or null. */
export function declared(body: string, property: string): string | null {
  const match = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`).exec(body);
  return match ? match[1]!.trim() : null;
}

/** A length written as plain px or rem (16px root), in px; anything else (calc, var, auto, %) is null. */
export function plainPx(value: string | null): number | null {
  const match = value ? /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim()) : null;
  if (!match) return null;
  return match[2] === "px" ? Number(match[1]) : Number(match[1]) * 16;
}
