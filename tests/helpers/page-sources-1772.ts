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

/** Every file a staff page reaches through `@/components/...` imports, the pages themselves included. */
export function staffReach(): Set<string> {
  const seen = new Set<string>();
  const queue = [...walk("app/(workspace)"), ...standaloneStaffPages];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of source(file).matchAll(/from\s+"@\/(components\/[^"]+)"/g)) {
      for (const extension of [".tsx", ".ts"]) {
        const candidate = `${match[1]}${extension}`;
        if (existsSync(join(root, candidate))) queue.push(candidate);
      }
    }
  }
  return seen;
}

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
