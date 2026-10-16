import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A class name with no CSS rule renders as a bare label and input (the PBE team name box had no border).
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe("form field wrappers", () => {
  it("never use the unstyled field-group class", () => {
    const users = [...sourceFiles("app"), ...sourceFiles("components")].filter((file) =>
      readFileSync(file, "utf8").includes('className="field-group"'),
    );
    expect(users).toEqual([]);
  });

  it("styles the general link team name like the other public fields", () => {
    const source = readFileSync("components/general-link-registration-flow.tsx", "utf8");
    expect(source).toMatch(/<label className="public-registration-field" htmlFor="general-link-team-name">/);
    expect(readFileSync("app/globals.css", "utf8")).toMatch(/\.public-registration-field input:not\(\[type="checkbox"\]\)/);
  });
});
