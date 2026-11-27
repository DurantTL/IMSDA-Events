import type { RequirementLine } from "@/modules/requirements/domain";

/**
 * Reads the requirement lines out of a Pathfinder Wiki requirements page
 * (#2054), as the wiki's parse API renders it to HTML. Used only by the local
 * script `scripts/fetch-honor-requirements.ts`; the app never fetches the
 * wiki. The output is a draft for a person to review in the CSV before it is
 * imported.
 *
 * Wiki pages write requirements two ways, and both are read:
 * - paragraphs that start with the number ("1. ...", "a. ...");
 * - ordered lists, numbered by position (a nested list is lettered).
 *
 * Tables (the info box, navigation boxes), edit links, footnote markers and
 * the table of contents are dropped. Reading stops at a heading such as
 * References or Notes once requirements have started.
 */

const DROPPED_BLOCKS = [
  /<table\b[\s\S]*?<\/table>/gi,
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
  /<sup\b[^>]*class="[^"]*\breference\b[^"]*"[^>]*>[\s\S]*?<\/sup>/gi,
  /<span\b[^>]*class="[^"]*\bmw-editsection\b[^"]*"[^>]*>[\s\S]*?<\/span>\s*<\/span>/gi,
  /<span\b[^>]*class="[^"]*\bmw-editsection\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
  /<div\b[^>]*(?:id="toc"|class="[^"]*\btoc\b[^"]*")[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
  /<!--[\s\S]*?-->/g,
];

const STOP_HEADINGS = /^(references?|notes?|see also|answer key|answers|resources|external links|sources)$/i;
const BLOCK_TAGS = new Set(["p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "dd", "dt", "dl", "blockquote", "center", "pre"]);

type RawLine = { text: string; heading: boolean };

/** Named and numeric character references the wiki emits. */
export function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

const letterFor = (index: number) => String.fromCharCode(97 + (index % 26));
const romanFor = (index: number) => ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"][index] ?? String(index + 1);

/** The page as plain lines: block elements end a line, list items get their number or letter written in front. */
function htmlToLines(html: string): RawLine[] {
  let source = html;
  for (const pattern of DROPPED_BLOCKS) source = source.replace(pattern, " ");
  const lines: RawLine[] = [];
  let current = "";
  let heading = false;
  const lists: Array<{ ordered: boolean; count: number; type: string }> = [];
  const flush = () => {
    const text = decodeEntities(current).replace(/\s+/g, " ").trim();
    if (text) lines.push({ text, heading });
    current = "";
    heading = false;
  };
  for (const match of source.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi)) {
    if (match[4] !== undefined) {
      current += match[4];
      continue;
    }
    const closing = match[1] === "/";
    const tag = match[2]!.toLowerCase();
    const attributes = match[3] ?? "";
    if (tag === "ol" || tag === "ul") {
      flush();
      if (closing) lists.pop();
      else {
        const type = /\btype="([^"]*)"/i.exec(attributes)?.[1] ?? "";
        const start = Number(/\bstart="(\d+)"/i.exec(attributes)?.[1] ?? "1");
        lists.push({ ordered: tag === "ol", count: start - 1, type });
      }
      continue;
    }
    if (tag === "li") {
      flush();
      if (closing) continue;
      const list = lists[lists.length - 1];
      if (list?.ordered) {
        const value = /\bvalue="(\d+)"/i.exec(attributes)?.[1];
        list.count = value ? Number(value) : list.count + 1;
        const depth = lists.filter((entry) => entry.ordered).length;
        const style = list.type || (depth === 1 ? "1" : depth === 2 ? "a" : "i");
        const marker = style === "a" ? letterFor(list.count - 1) : style === "i" ? romanFor(list.count - 1) : String(list.count);
        current = `${marker}. `;
      }
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      flush();
      if (!closing) heading = true;
      continue;
    }
    if (BLOCK_TAGS.has(tag)) flush();
  }
  flush();
  return lines;
}

const TOP = /^(\d{1,3})[.)]\s*(.*)$/;
const PART = /^([a-z])[.)]\s+(.+)$/;
const SUB_PART = /^((?:i{1,3}|iv|v|vi{1,3}|ix|x))[.)]\s+(.+)$/;

/**
 * Requirement lines from a rendered requirements page. Text before the first
 * numbered line (the page's introduction) is left out; an unnumbered line
 * after a requirement is added to it.
 */
export function parseWikiRequirementsHtml(html: string): RequirementLine[] {
  const result: RequirementLine[] = [];
  let lastLetter = "";
  for (const { text, heading } of htmlToLines(html)) {
    if (heading) {
      if (result.length > 0 && STOP_HEADINGS.test(text)) break;
      continue;
    }
    const top = TOP.exec(text);
    if (top && Number(top[1]) >= 1) {
      // The text may sit on the next line ("1." alone, then a paragraph); it is added below.
      result.push({ section: "", number: Number(top[1]), label: "", text: top[2] ?? "" });
      lastLetter = "";
      continue;
    }
    const last = result[result.length - 1];
    if (!last) continue;
    const sub = SUB_PART.exec(text);
    // "i." after "h." is the letter i; after another letter it starts the roman parts under that letter.
    if (sub && lastLetter && !(sub[1] === "i" && lastLetter === "h") && !(sub[1] === "v" && lastLetter === "u") && !(sub[1] === "x" && lastLetter === "w")) {
      result.push({ section: "", number: last.number, label: `${lastLetter}.${sub[1]}`, text: sub[2]! });
      continue;
    }
    const part = PART.exec(text);
    if (part) {
      lastLetter = part[1]!;
      result.push({ section: "", number: last.number, label: part[1]!, text: part[2]! });
      continue;
    }
    last.text = `${last.text} ${text}`.trim();
  }
  return result.filter((line) => line.text !== "");
}

/** The wiki page title for an honor's requirements: "Swimming - Advanced" becomes "AY Honors/Swimming - Advanced/Requirements". */
export function wikiRequirementsTitle(honorName: string) {
  return `AY Honors/${honorName.trim()}/Requirements`;
}

/** The page address for a wiki title, as it is linked in the credit line. */
export function wikiPageUrl(title: string) {
  return `https://wiki.pathfindersonline.org/w/${encodeURI(title.replace(/ /g, "_"))}`;
}

/** The parse API address that renders a title to HTML, following redirects. */
export function wikiParseApiUrl(title: string) {
  const params = new URLSearchParams({ action: "parse", page: title, prop: "text", format: "json", formatversion: "2", redirects: "1" });
  return `https://wiki.pathfindersonline.org/api.php?${params.toString()}`;
}
