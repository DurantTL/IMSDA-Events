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

/** `resumes` is set on text that follows a nested list inside a list item: it belongs to the item at that depth (1 = the requirement, 2 = its lettered part). */
type RawLine = { text: string; heading: boolean; resumes?: number };

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
  let resumes: number | undefined;
  const lists: Array<{ ordered: boolean; count: number; type: string }> = [];
  const orderedDepth = () => lists.filter((entry) => entry.ordered).length;
  const flush = () => {
    const text = decodeEntities(current).replace(/\s+/g, " ").trim();
    if (text) lines.push(resumes ? { text, heading, resumes } : { text, heading });
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
      if (closing) {
        lists.pop();
        // Text after a nested list, still inside the outer item, continues that item.
        resumes = orderedDepth() > 0 ? orderedDepth() : undefined;
      } else {
        resumes = undefined;
        const type = /\btype="([^"]*)"/i.exec(attributes)?.[1] ?? "";
        const start = Number(/\bstart="(\d+)"/i.exec(attributes)?.[1] ?? "1");
        lists.push({ ordered: tag === "ol", count: start - 1, type });
      }
      continue;
    }
    if (tag === "li") {
      flush();
      resumes = undefined;
      if (closing) continue;
      const list = lists[lists.length - 1];
      if (list?.ordered) {
        const value = /\bvalue="(\d+)"/i.exec(attributes)?.[1];
        list.count = value ? Number(value) : list.count + 1;
        const depth = orderedDepth();
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

// A space (or the end of the line) must follow the marker, so "2.5 km" is text, not requirement 2.
const TOP = /^(\d{1,3})[.)](?:\s+(.*)|$)/;
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
  let lastTop: RequirementLine | undefined;
  let lastPart: RequirementLine | undefined;
  for (const { text, heading, resumes } of htmlToLines(html)) {
    if (heading) {
      if (result.length > 0 && STOP_HEADINGS.test(text)) break;
      continue;
    }
    const top = TOP.exec(text);
    if (top && Number(top[1]) >= 1) {
      // The text may sit on the next line ("1." alone, then a paragraph); it is added below.
      lastTop = { section: "", number: Number(top[1]), label: "", text: top[2] ?? "" };
      result.push(lastTop);
      lastLetter = "";
      lastPart = undefined;
      continue;
    }
    const last = result[result.length - 1];
    if (!last || !lastTop) continue;
    if (resumes === 1 || (resumes === 2 && lastPart)) {
      const owner = resumes === 1 ? lastTop : lastPart!;
      owner.text = `${owner.text} ${text}`.trim();
      continue;
    }
    const sub = SUB_PART.exec(text);
    // "i." after "h." is the letter i; after another letter it starts the roman parts under that letter.
    if (sub && lastLetter && !(sub[1] === "i" && lastLetter === "h") && !(sub[1] === "v" && lastLetter === "u") && !(sub[1] === "x" && lastLetter === "w")) {
      result.push({ section: "", number: last.number, label: `${lastLetter}.${sub[1]}`, text: sub[2]! });
      continue;
    }
    const part = PART.exec(text);
    if (part) {
      lastLetter = part[1]!;
      lastPart = { section: "", number: last.number, label: part[1]!, text: part[2]! };
      result.push(lastPart);
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
