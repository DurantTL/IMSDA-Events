/**
 * Small selector helpers for the design system sync (#1773). There is no
 * selector parser at the top level of node_modules, and the sync only needs a
 * few things: split a list on commas, find the subject compound, read class
 * names (including inside :is() / :where(), but not :not() / :has()), and
 * prefix CSS module classes. All of them respect parentheses, brackets,
 * strings and escapes.
 */

const MATCH_FUNCTIONS = new Set(["is", "where", "global", "local", "matches", "-webkit-any", "-moz-any"]);

function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** Index just past the bracket or parenthesis group that opens at `start`. */
function skipGroup(text: string, start: number): number {
  const open = text[start];
  const close = open === "(" ? ")" : "]";
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") i += 2;
    else if (char === '"' || char === "'") i = skipString(text, i);
    else {
      if (char === open) depth += 1;
      else if (char === close) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
  }
  return text.length;
}

/** Split `text` at top-level characters for which `isSeparator` is true. */
function splitTopLevel(text: string, isSeparator: (char: string) => boolean): string[] {
  const parts: string[] = [];
  let current = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      current += text.slice(i, i + 2);
      i += 2;
    } else if (char === '"' || char === "'") {
      const end = skipString(text, i);
      current += text.slice(i, end);
      i = end;
    } else if (char === "(" || char === "[") {
      const end = skipGroup(text, i);
      current += text.slice(i, end);
      i = end;
    } else if (isSeparator(char)) {
      parts.push(current);
      current = "";
      i += 1;
    } else {
      current += char;
      i += 1;
    }
  }
  parts.push(current);
  return parts;
}

export function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/** Split a selector list on top-level commas. */
export function splitSelectorList(selector: string): string[] {
  return splitTopLevel(selector, (char) => char === ",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Split one complex selector into its compounds, dropping the combinators. */
export function splitCompounds(selector: string): string[] {
  return splitTopLevel(selector, (char) => /[\s>+~]/.test(char))
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The subject compound: the last one after the final top-level combinator. */
export function subjectCompound(selector: string): string {
  const compounds = splitCompounds(selector);
  return compounds[compounds.length - 1] ?? "";
}

function readIdent(text: string, start: number): { name: string; end: number } {
  let i = start;
  let name = "";
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length) {
      name += text[i + 1];
      i += 2;
    } else if (/[A-Za-z0-9_-]/.test(char) || char.charCodeAt(0) > 127) {
      name += char;
      i += 1;
    } else break;
  }
  return { name, end: i };
}

/**
 * Class names in a compound. Looks inside :is(), :where() and :global() (and
 * their arguments' own subject compounds), and skips :not(), :has() and every
 * other functional pseudo-class.
 */
export function classesInCompound(compound: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < compound.length) {
    const char = compound[i];
    if (char === "\\") i += 2;
    else if (char === '"' || char === "'") i = skipString(compound, i);
    else if (char === "[") i = skipGroup(compound, i);
    else if (char === ".") {
      const { name, end } = readIdent(compound, i + 1);
      if (name) found.push(name);
      i = Math.max(end, i + 1);
    } else if (char === ":") {
      let j = i;
      while (compound[j] === ":") j += 1;
      const { name, end } = readIdent(compound, j);
      if (compound[end] === "(") {
        const groupEnd = skipGroup(compound, end);
        if (MATCH_FUNCTIONS.has(name.toLowerCase())) {
          for (const inner of splitSelectorList(compound.slice(end + 1, groupEnd - 1))) {
            found.push(...classesInCompound(subjectCompound(inner)));
          }
        }
        i = groupEnd;
      } else i = Math.max(end, j + 1);
    } else i += 1;
  }
  return found;
}

/** Class names of a selector's subject compound. */
export function subjectClasses(selector: string): string[] {
  return classesInCompound(subjectCompound(selector));
}

/** Every class name that appears anywhere in a selector (for the preview check). */
export function allClassesInSelector(selector: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < selector.length) {
    const char = selector[i];
    if (char === "\\") i += 2;
    else if (char === '"' || char === "'") i = skipString(selector, i);
    else if (char === "[") i = skipGroup(selector, i);
    else if (char === ".") {
      const { name, end } = readIdent(selector, i + 1);
      if (name) found.push(name);
      i = Math.max(end, i + 1);
    } else i += 1;
  }
  return found;
}

/**
 * CSS modules make classes local, so the app's real names are hashed. In the
 * bundle every class becomes `<prefix>__<class>`, and `:global(...)` is
 * unwrapped to the plain selector it holds.
 */
export function prefixModuleSelector(selector: string, prefix: string): string {
  let out = "";
  let i = 0;
  while (i < selector.length) {
    const char = selector[i];
    if (char === "\\") {
      out += selector.slice(i, i + 2);
      i += 2;
    } else if (char === '"' || char === "'") {
      const end = skipString(selector, i);
      out += selector.slice(i, end);
      i = end;
    } else if (char === "[") {
      const end = skipGroup(selector, i);
      out += selector.slice(i, end);
      i = end;
    } else if (selector.startsWith(":global(", i)) {
      const end = skipGroup(selector, i + ":global".length);
      out += selector.slice(i + ":global(".length, end - 1);
      i = end;
    } else if (selector.startsWith(":local(", i)) {
      const end = skipGroup(selector, i + ":local".length);
      out += prefixModuleSelector(selector.slice(i + ":local(".length, end - 1), prefix);
      i = end;
    } else if (char === ".") {
      const { name, end } = readIdent(selector, i + 1);
      if (name) {
        out += `.${prefix}__${name}`;
        i = end;
      } else {
        out += char;
        i += 1;
      }
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}
