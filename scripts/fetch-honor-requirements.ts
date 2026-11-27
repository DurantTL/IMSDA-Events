/**
 * Builds the honor requirements CSV (#2054) from the Pathfinder Wiki, the
 * North American Division Youth Ministries' site, whose text is licensed
 * CC BY-SA 3.0 (recorded in modules/requirements/sources.ts). Run it on a
 * computer with internet access, review the file, then upload it on the
 * staff Honor catalog page (Import requirements). The app itself never
 * fetches the wiki. Re-run it about once a year, or when NAD revises honors;
 * the import skips honors whose text hasn't changed.
 *
 *   npm run requirements:fetch -- --out honor-requirements.csv
 *   npm run requirements:fetch -- --honors my-honors.csv --only BIRDS,CAMPING-SKILLS-I --out part.csv
 *
 * --honors  A CSV with Code and Name columns (default: docs/reference/imports/honors.csv,
 *           the honor catalog import file). An optional "Wiki Page" column overrides the
 *           page title for an honor whose wiki name differs from ours.
 * --only    Comma-separated honor codes to fetch (default: all of them).
 * --delay   Milliseconds between requests (default 1000), to be polite to the wiki.
 *
 * Every row carries the page it came from and the license, and the import
 * refuses rows from any source whose license isn't recorded. Honors with no
 * wiki page, or a page the reader couldn't find requirements on, are listed
 * at the end so they can be checked by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvMatrix } from "../modules/imports/csv-parser";
import { toCsv } from "../modules/reporting/csv";
import { REQUIREMENT_CSV_HEADERS } from "../modules/requirements/requirements-csv";
import { PATHFINDER_WIKI } from "../modules/requirements/sources";
import { parseWikiRequirementsHtml, wikiPageUrl, wikiParseApiUrl, wikiRequirementsTitle } from "../modules/requirements/wiki-parser";

type HonorInput = { code: string; name: string; title: string };

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function readHonorList(csvText: string): HonorInput[] {
  const [header, ...rows] = parseCsvMatrix(csvText.replace(/^﻿/, ""));
  if (!header) return [];
  const names = header.map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ""));
  const code = names.indexOf("code");
  const name = names.indexOf("name");
  const page = names.indexOf("wikipage");
  if (code < 0 || name < 0) throw new Error("The honors file needs Code and Name columns.");
  return rows
    .map((cells) => ({ code: (cells[code] ?? "").trim(), name: (cells[name] ?? "").trim(), page: page >= 0 ? (cells[page] ?? "").trim() : "" }))
    .filter((row) => row.code && row.name)
    .map((row) => ({ code: row.code, name: row.name, title: row.page || wikiRequirementsTitle(row.name) }));
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function fetchPage(title: string): Promise<{ title: string; html: string } | null> {
  const response = await fetch(wikiParseApiUrl(title), { headers: { "User-Agent": "honor-requirements-import/1.0 (CC BY-SA attribution kept per page)" } });
  if (!response.ok) throw new Error(`The wiki answered ${response.status} for ${title}.`);
  const body = await response.json() as { parse?: { title?: string; text?: string }; error?: { code?: string } };
  if (body.error?.code === "missingtitle") return null;
  if (!body.parse?.text) return null;
  return { title: body.parse.title ?? title, html: body.parse.text };
}

async function main() {
  const out = argument("out");
  if (!out) throw new Error("Give an output file: --out honor-requirements.csv");
  const honorsFile = argument("honors") ?? "docs/reference/imports/honors.csv";
  const only = new Set((argument("only") ?? "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean));
  const delay = Number(argument("delay") ?? "1000");
  const honors = readHonorList(readFileSync(honorsFile, "utf8")).filter((honor) => only.size === 0 || only.has(honor.code.toUpperCase()));
  const retrievedOn = today();
  const rows: string[][] = [[...REQUIREMENT_CSV_HEADERS]];
  const missing: string[] = [];
  const empty: string[] = [];

  for (const [index, honor] of honors.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const page = await fetchPage(honor.title);
    if (!page) {
      missing.push(`${honor.code} (${honor.title})`);
      continue;
    }
    const lines = parseWikiRequirementsHtml(page.html);
    if (lines.length === 0) {
      empty.push(`${honor.code} (${page.title})`);
      continue;
    }
    const sourceUrl = wikiPageUrl(page.title);
    for (const line of lines) {
      rows.push([honor.code, honor.name, "en", retrievedOn, sourceUrl, PATHFINDER_WIKI.license, line.section, String(line.number), line.label, line.text]);
    }
    process.stdout.write(`${honor.code}: ${lines.filter((line) => !line.label).length} requirements\n`);
  }

  writeFileSync(out, toCsv(rows));
  process.stdout.write(`\nWrote ${rows.length - 1} rows for ${honors.length - missing.length - empty.length} honors to ${out}.\n`);
  if (missing.length > 0) process.stdout.write(`\nNo wiki page (add a Wiki Page column to the honors file to point at the right one):\n  ${missing.join("\n  ")}\n`);
  if (empty.length > 0) process.stdout.write(`\nA page with no requirements the reader could find (check by hand):\n  ${empty.join("\n  ")}\n`);
}

if (process.argv[1]?.endsWith("fetch-honor-requirements.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
