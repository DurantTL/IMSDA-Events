import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Helpers for the #1772 page header guards: which staff pages and components draw an `h1`, and which pages draw a titled PageHeader. */
export const root = join(__dirname, "..", "..");

/** A block comment starts after whitespace or a brace, so a path such as "/more/*" inside a string is left alone. */
export const stripComments = (source: string) => source.replace(/(^|[\s{;(])\/\*[\s\S]*?\*\//g, "$1").replace(/^\s*\/\/.*$/gm, "");
export const source = (file: string) => stripComments(readFileSync(join(root, file), "utf8"));

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Staff pages: everything under the shell's route group, plus the staff pages that sit outside it. */
export const standaloneStaffPages = ["app/select-event/page.tsx", "app/archived-events/page.tsx", "app/check-in-station/page.tsx"];
export const workspacePages = () => walk("app/(workspace)").filter((file) => file.endsWith("/page.tsx"));

/** The repo files a source file imports: `@/` paths and relative paths, to a .tsx or .ts file or a folder's index. */
function importsOf(file: string): string[] {
  const found: string[] = [];
  for (const match of source(file).matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    const spec = match[1]!;
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? join(file, "..", spec) : null;
    if (!base) continue;
    for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
      const clean = candidate.replace(/\\/g, "/");
      if (existsSync(join(root, clean))) {
        found.push(clean);
        break;
      }
    }
  }
  return found;
}

/** Every file reached from the given files through imports (`@/...` and relative), the starting files included. */
export function reachFrom(starts: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

/** Every file a staff page reaches, the pages themselves included. */
export const staffReach = () => reachFrom([...walk("app/(workspace)"), ...standaloneStaffPages]);

/** A heading level 1 in markup (`<h1`) or chosen at run time (`"h1"`, as in `headingLevel === 1 ? "h1" : "h2"`). */
export const drawsH1 = (file: string) => /<h1\b|["'`]h1["'`]/.test(source(file));

/** The files that define the header and the states that stand in for a page's title; they are not pages' own uses of it. */
export const headerDefinitionFiles = (file: string) => file === "components/page-header.tsx" || file === "components/own-header-state.tsx" || file.startsWith("components/page-templates/");

/** The route a workspace page file serves: `app/(workspace)/more/clubs/[id]/page.tsx` is `/more/clubs/[id]`. */
export const routeOf = (file: string) => `/${relative("app/(workspace)", file).replace(/\/?page\.tsx$/, "")}`.replace(/^\/$/, "/").replace(/\/+/g, "/");

/** The text of every opening tag of the given components, with braces balanced so `=>` and `{{ }}` do not end it early. */
export function openingTags(text: string, names: readonly string[]): { name: string; tag: string }[] {
  const found: { name: string; tag: string }[] = [];
  const pattern = new RegExp(`<(${names.join("|")})\\b`, "g");
  for (const match of text.matchAll(pattern)) {
    let depth = 0;
    let end = match.index! + match[0].length;
    for (; end < text.length; end += 1) {
      const char = text[end]!;
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && text[end - 1] !== "=") break;
    }
    found.push({ name: match[1]!, tag: text.slice(match.index!, end + 1) });
  }
  return found;
}

export const titledHeaderComponents = ["PageHeader", "HubPage", "ListPage", "DetailPage", "FormPage", "StepPage"] as const;

/** The title expressions a page file gives its PageHeader or page template, as written (`"Printouts"`, `staffPageTitles.printouts`, `club.name`). */
export function pageTitleExpressions(text: string): string[] {
  return openingTags(text, titledHeaderComponents).flatMap(({ tag }) => {
    const match = /\btitle(?:=|:\s*)(?:\{\s*)?("[^"]*"|[\w.]+)/.exec(tag);
    return match ? [match[1]!] : [];
  });
}
