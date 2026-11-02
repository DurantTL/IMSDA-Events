import { describe, expect, it } from "vitest";
import { read, sourceFiles } from "./helpers/css-source";

/**
 * Site rule B4 (docs/SITE-RULES.md): every empty list says why it is empty and offers the next step. The shared
 * `EmptyState` and `NoMatchesState` (components/empty-state.tsx) are the one way to write that. tests/empty-states-rule4-1449.test.ts
 * holds the filtered staff lists to them; this guard keeps the rest from growing: a hand-written
 * `<div className="empty-state">` block is counted per file, and a file may not gain one. Fold an old one into the
 * shared component when you touch its page, and lower its count in tests/fixtures/raw-empty-states-1440.json.
 */

const sharedHome = "components/empty-state.tsx";
const rawEmptyState = /<(div|p|section|li|td|span)\b[^>]*className=(?:"|\{`)[^"`]*\bempty-state\b[^"`]*(?:"|`\})[^>]*>/g;

function rawEmptyStateCount(source: string) {
  return [...source.matchAll(rawEmptyState)].length;
}

describe("B4: empty lists use the shared empty states", () => {
  const files = sourceFiles(["app", "components"], [".tsx"]).filter((file) => file !== sharedHome);
  const recorded = JSON.parse(read("tests/fixtures/raw-empty-states-1440.json")) as Record<string, number>;
  const counts = Object.fromEntries(files.map((file) => [file, rawEmptyStateCount(read(file))]).filter(([, count]) => (count as number) > 0));

  it("writes no new hand-built empty-state block: use EmptyState or NoMatchesState", () => {
    const grown = Object.entries(counts).filter(([file, count]) => (count as number) > (recorded[file] ?? 0)).map(([file, count]) => `${file}: ${count} (was ${recorded[file] ?? 0})`);
    expect(grown).toEqual([]);
  });

  it("keeps the recorded counts honest: a file that folded its blocks lowers its count", () => {
    const stale = Object.entries(recorded).filter(([file, count]) => (counts[file] ?? 0) < count).map(([file, count]) => `${file}: lower ${count} to ${counts[file] ?? 0}`);
    expect(stale).toEqual([]);
  });

  it("gives the shared states a why and a next step", () => {
    const shared = read(sharedHome);
    expect(shared).toMatch(/export function EmptyState\b/);
    expect(shared).toMatch(/export function NoMatchesState\b/);
    expect(shared).toMatch(/Clear filters/);
    expect(shared).toMatch(/emptyStateAction/);
  });

  it("counts a hand-built block (the scanner itself)", () => {
    expect(rawEmptyStateCount('<div className="empty-state panel"><h3>None</h3></div><EmptyState title="x" />')).toBe(1);
    expect(rawEmptyStateCount('<EmptyState className="empty-state" title="x" />')).toBe(0);
  });
});
