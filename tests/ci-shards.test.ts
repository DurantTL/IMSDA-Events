import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CI runs the database-backed `npm run test:*` scripts in parallel shards
// (#1233). These checks keep every script in exactly one shard, so a script
// added to package.json cannot be silently left out of CI.

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const workflow = read(".github/workflows/ci.yml");
const packageScripts = Object.keys(
  (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts,
).filter((name) => name.startsWith("test:"));

// package.json scripts that ci.yml does not run, each with where it runs instead.
const NOT_IN_CI = new Set([
  "test:watch", // vitest in watch mode, for local use
  "test:badge-print", // badge-print.yml
  "test:mobile-layout", // mobile-layout.yml
  "test:club-form-roster-add", // not in ci.yml before the shards (#1233)
  "test:custom-message", // not in ci.yml before the shards (#1233)
]);

const SHARD_JOB = /^(db-scripts-\d+|http-scripts)$/;

type Job = { id: string; lines: string[] };

function jobs(): Job[] {
  const result: Job[] = [];
  let inJobs = false;
  for (const line of workflow.split("\n")) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) result.push({ id: header[1], lines: [] });
    else result.at(-1)?.lines.push(line);
  }
  return result;
}

const scriptsIn = (lines: string[]) =>
  lines.flatMap((line) => [...line.matchAll(/npm run (test:[\w:-]+)/g)].map((match) => match[1]));

describe("CI database-script shards (#1233)", () => {
  const all = jobs();

  it("runs every package.json test:* script in exactly one shard", () => {
    const placements = new Map<string, string[]>();
    for (const job of all) {
      for (const script of scriptsIn(job.lines)) {
        placements.set(script, [...(placements.get(script) ?? []), job.id]);
      }
    }
    for (const [script, ids] of placements) {
      expect(ids, script).toHaveLength(1);
      expect(ids[0], script).toMatch(SHARD_JOB);
    }
    const expected = packageScripts.filter((name) => !NOT_IN_CI.has(name)).sort();
    expect([...placements.keys()].sort()).toEqual(expected);
    expect(expected).toHaveLength(91);
  });

  it("keeps the scripts that need the app in the shard that starts it", () => {
    const http = all.find((job) => job.id === "http-scripts");
    expect(http).toBeDefined();
    const start = http!.lines.findIndex((line) => line.includes("name: Start the built app"));
    expect(start).toBeGreaterThan(-1);
    expect(http!.lines.slice(0, start).join("\n")).toContain("- run: npm run build");
    const afterStart = new Set(scriptsIn(http!.lines.slice(start)));
    for (const script of scriptsIn(all.flatMap((job) => job.lines))) {
      if (script.endsWith("-http") || script.startsWith("test:public-")) {
        expect(afterStart.has(script), script).toBe(true);
      }
    }
  });

  it("gates the required verify check on npm run verify and every shard", () => {
    const verify = all.find((job) => job.id === "verify");
    expect(verify).toBeDefined();
    expect(verify!.lines.some((line) => /^ {4}name:/.test(line))).toBe(false);
    const needs = /^ {4}needs: \[(.*)\]\s*$/.exec(verify!.lines.find((line) => /^ {4}needs:/.test(line)) ?? "");
    expect(needs).not.toBeNull();
    const needed = new Set(needs![1].split(",").map((id) => id.trim()));
    for (const job of all) {
      if (SHARD_JOB.test(job.id) || job.id === "verify-app" || job.id === "scope") {
        expect(needed.has(job.id), job.id).toBe(true);
      }
    }
    expect(all.filter((job) => SHARD_JOB.test(job.id)).length).toBeGreaterThanOrEqual(2);
    // No job but the aggregate may show up as "verify" in the checks list.
    expect(all.filter((job) => job.lines.some((line) => /^ {4}name: verify\s*$/.test(line)))).toEqual([]);
  });
});
