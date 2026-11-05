import { describe, expect, it } from "vitest";
import { environmentProblems, runKeyCheck } from "../scripts/key-check";
import { runKeyRotate } from "../scripts/key-rotate";

const current = "synthetic-current-key-0123456789-abcdefghijklm";
const previous = "synthetic-previous-key-0123456789-abcdefghijkl";
const base = { NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/db?schema=public" };

function harness(env: Record<string, string | undefined>, apply = false) {
  const out: string[] = [];
  const run = () => runKeyRotate({ env, apply, log: (line) => out.push(line), error: (line) => out.push(line) });
  return { run, text: () => out.join("\n") };
}

describe("key:rotate and key:check refusals", () => {
  it("key:check fails plainly with no key", async () => {
    const out: string[] = [];
    const code = await runKeyCheck({ env: { ...base }, log: (l) => out.push(l), error: (l) => out.push(l) });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/SECRET_ENCRYPTION_KEY \(or SECRET_ENCRYPTION_KEY_FILE\) is not set/);
  });

  it("key:rotate needs the previous key", async () => {
    const { run, text } = harness({ ...base, SECRET_ENCRYPTION_KEY: current, SECRET_ENCRYPTION_KEY_VERSION: "2" });
    expect(await run()).toBe(1);
    expect(text()).toMatch(/both keys must be loaded/);
    expect(text()).not.toContain(current);
  });

  it("key:rotate refuses an invalid rotation setup, naming no key", async () => {
    for (const env of [
      { SECRET_ENCRYPTION_PREVIOUS_KEY: previous, SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION: "2", SECRET_ENCRYPTION_KEY_VERSION: "2" },
      { SECRET_ENCRYPTION_PREVIOUS_KEY: previous, SECRET_ENCRYPTION_KEY_VERSION: "2" },
      { SECRET_ENCRYPTION_PREVIOUS_KEY: current, SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION: "1", SECRET_ENCRYPTION_KEY_VERSION: "2" },
    ]) {
      const { run, text } = harness({ ...base, SECRET_ENCRYPTION_KEY: current, ...env }, true);
      expect(await run()).toBe(1);
      expect(text()).toMatch(/FAILED/);
      expect(text()).not.toContain(current);
      expect(text()).not.toContain(previous);
    }
  });

  it("reports environment problems without a key in them", () => {
    const problems = environmentProblems({ ...base, SECRET_ENCRYPTION_KEY: current, SECRET_ENCRYPTION_PREVIOUS_KEY: previous });
    expect(problems.join("\n")).toMatch(/SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION/);
    expect(problems.join("\n")).not.toContain(previous);
  });
});
