import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDataKeyringForTests, setDataKeyStateForTests } from "../lib/data-key/keyring";
import { resetServerEnvCache } from "../lib/env";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => { throw new Error("The database is not used here."); } }));

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

describe("key:rotate and key:check with a separate data key (#1652)", () => {
  afterEach(() => {
    resetDataKeyringForTests();
    resetServerEnvCache();
    vi.unstubAllEnvs();
  });

  function useProcessEnv(values: Record<string, string>) {
    for (const [name, value] of Object.entries({ NODE_ENV: "development", DATABASE_URL: base.DATABASE_URL, ...values })) vi.stubEnv(name, value);
    resetServerEnvCache();
  }

  const devData = { DATA_KEY_SOURCE: "dev-env", DATA_ENCRYPTION_KEY: "synthetic-data-key-0123456789-abcdefghijklmnop" };

  it("key:rotate refuses --apply while the data key is unavailable, naming no key", async () => {
    useProcessEnv({ SECRET_ENCRYPTION_KEY: current, ...devData });
    setDataKeyStateForTests({ kind: "unavailable", reason: "access-denied" });
    const { run, text } = harness({ ...base, SECRET_ENCRYPTION_KEY: current, ...devData }, true);
    expect(await run()).toBe(1);
    expect(text()).toMatch(/personal-data key is configured but could not be loaded/);
    expect(text()).not.toContain(current);
    expect(text()).not.toContain(devData.DATA_ENCRYPTION_KEY);
  });

  it("key:rotate refuses --apply while a previous data key is configured but could not be loaded", async () => {
    useProcessEnv({ SECRET_ENCRYPTION_KEY: current, ...devData });
    setDataKeyStateForTests({ kind: "ready", ring: { current: { version: 2, ikm: Buffer.alloc(32, 3) }, previousProblem: "access-denied" } });
    const { run, text } = harness({ ...base, SECRET_ENCRYPTION_KEY: current, ...devData }, true);
    expect(await run()).toBe(1);
    expect(text()).toMatch(/previous personal-data key is configured but could not be loaded/);
  });

  it("key:check fails while the data key is unavailable and prints the reason category", async () => {
    useProcessEnv({ SECRET_ENCRYPTION_KEY: current, ...devData });
    setDataKeyStateForTests({ kind: "unavailable", reason: "vault-unreachable" });
    const out: string[] = [];
    const code = await runKeyCheck({
      env: { ...base, SECRET_ENCRYPTION_KEY: current, ...devData },
      log: (line) => out.push(line),
      error: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/data key: unavailable \(vault-unreachable\)/);
    expect(out.join("\n")).not.toContain(current);
  });

  it("describes the data key on one line each way", async () => {
    const { dataKeyLine } = await import("../scripts/key-check");
    expect(dataKeyLine({ mode: "not-separate", state: "not-separate", version: null, previousVersion: null, reason: null })).toBe("not separate yet (using the sign-in key)");
    expect(dataKeyLine({ mode: "dev-env", state: "ready", version: 2, previousVersion: 1, reason: null })).toBe("version 2; previous loaded (version 1)");
    expect(dataKeyLine({ mode: "azure-key-vault", state: "ready", version: 1, previousVersion: null, reason: null })).toBe("version 1; previous not loaded");
    expect(dataKeyLine({ mode: "azure-key-vault", state: "unavailable", version: null, previousVersion: null, reason: "unwrap-failed" })).toBe("unavailable (unwrap-failed)");
  });

  it("environment problems include the data key settings", () => {
    const problems = environmentProblems({ ...base, SECRET_ENCRYPTION_KEY: current, DATA_KEY_SOURCE: "azure-key-vault" });
    expect(problems.join("\n")).toMatch(/AZURE_KEY_VAULT_URL: is required/);
    expect(problems.join("\n")).not.toContain(current);
  });
});
