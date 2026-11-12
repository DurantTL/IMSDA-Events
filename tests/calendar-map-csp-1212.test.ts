import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

describe("calendar map: reaching the page (#1212)", () => {
  // A Content-Security-Policy belongs to the document, so a client-side navigation keeps the policy of the page it
  // left and the calendar's map tiles would be blocked. Links into /calendar from other pages are plain anchors.
  it("has no Link or router call to a /calendar href outside the calendar page and its components", () => {
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    for (const file of [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "components"))]) {
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (relative.startsWith("app/(public)/calendar/") || /^components\/calendar-/.test(relative)) continue;
      const source = readFileSync(file, "utf8");
      const target = /(?:href=\{?["'`]|(?:push|replace)\(\s*["'`])\/calendar(?![A-Za-z0-9/-])/g;
      for (const match of source.matchAll(target)) {
        const before = source.slice(0, match.index ?? 0);
        const tag = /<([A-Za-z.]+)[^<]*$/.exec(before)?.[1];
        const isCall = /(?:push|replace)\(/.test(match[0]);
        if (isCall || (tag && tag !== "a")) offenders.push(`${relative}: ${isCall ? "router call" : tag}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
