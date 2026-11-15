import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isVaultUrl, validateServerEnv } from "@/lib/env";

const base = { NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/db?schema=public" };
const signIn = "synthetic-sign-in-key-0123456789-abcdefghijklm";
const dataKey = "synthetic-data-key-0123456789-abcdefghijklmnop";
const wrapped = "0123456789abcdef0123456789abcdef.c3ludGhldGljLXdyYXBwZWQta2V5LWJ5dGVz";

const vault = {
  DATA_KEY_SOURCE: "azure-key-vault",
  AZURE_KEY_VAULT_URL: "https://example-vault.vault.azure.net",
  AZURE_KEY_VAULT_KEY_NAME: "data-kek",
  AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000000",
  AZURE_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
  AZURE_CLIENT_SECRET: "synthetic-client-secret-value",
  DATA_ENCRYPTION_KEY_WRAPPED: wrapped,
};

function issues(env: Record<string, string | undefined>) {
  const result = validateServerEnv({ ...base, ...env });
  return result.ok ? [] : result.issues;
}

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "imsda-data-key-env-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("data key settings (#1652)", () => {
  it("accepts an environment with no data key settings (not separate yet)", () => {
    expect(issues({ SECRET_ENCRYPTION_KEY: signIn })).toEqual([]);
  });

  it("accepts the development source and parses its settings", () => {
    const result = validateServerEnv({
      ...base, SECRET_ENCRYPTION_KEY: signIn, DATA_KEY_SOURCE: "dev-env", DATA_ENCRYPTION_KEY: dataKey, DATA_ENCRYPTION_KEY_VERSION: "2",
      DATA_ENCRYPTION_PREVIOUS_KEY: `${dataKey}-old`, DATA_ENCRYPTION_PREVIOUS_KEY_VERSION: "1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.DATA_ENCRYPTION_KEY_VERSION).toBe(2);
  });

  it("refuses the development source in production, saying what it is for", () => {
    const found = issues({ NODE_ENV: "production", DATA_KEY_SOURCE: "dev-env", DATA_ENCRYPTION_KEY: dataKey });
    expect(found.join("\n")).toMatch(/DATA_KEY_SOURCE: .*local development and CI only/);
    expect(found.join("\n")).not.toContain(dataKey);
  });

  it("needs a development key that differs from the sign-in key", () => {
    expect(issues({ DATA_KEY_SOURCE: "dev-env" }).join("\n")).toMatch(/DATA_ENCRYPTION_KEY: is required/);
    const same = issues({ SECRET_ENCRYPTION_KEY: signIn, DATA_KEY_SOURCE: "dev-env", DATA_ENCRYPTION_KEY: signIn });
    expect(same.join("\n")).toMatch(/DATA_ENCRYPTION_KEY: must not be the same/);
    expect(same.join("\n")).not.toContain(signIn);
  });

  it("applies the previous-key version rules", () => {
    const dev = { SECRET_ENCRYPTION_KEY: signIn, DATA_KEY_SOURCE: "dev-env", DATA_ENCRYPTION_KEY: dataKey };
    expect(issues({ ...dev, DATA_ENCRYPTION_PREVIOUS_KEY_VERSION: "1" }).join("\n")).toMatch(/PREVIOUS_KEY_VERSION: is set but no previous data key/);
    expect(issues({ ...dev, DATA_ENCRYPTION_PREVIOUS_KEY: `${dataKey}-old` }).join("\n")).toMatch(/PREVIOUS_KEY_VERSION: is required/);
    expect(
      issues({ ...dev, DATA_ENCRYPTION_PREVIOUS_KEY: `${dataKey}-old`, DATA_ENCRYPTION_PREVIOUS_KEY_VERSION: "2", DATA_ENCRYPTION_KEY_VERSION: "2" }).join("\n"),
    ).toMatch(/must be lower than DATA_ENCRYPTION_KEY_VERSION/);
  });

  it("accepts a complete vault setup, in production too", () => {
    expect(issues({ ...vault })).toEqual([]);
  });

  it("names every missing vault variable and never a value", () => {
    const found = issues({ DATA_KEY_SOURCE: "azure-key-vault" });
    for (const name of [
      "AZURE_KEY_VAULT_URL", "AZURE_KEY_VAULT_KEY_NAME", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "DATA_ENCRYPTION_KEY_WRAPPED",
    ]) {
      expect(found.some((line) => line.startsWith(`${name}:`)), name).toBe(true);
    }
  });

  it("checks the vault address and the wrapped key format", () => {
    expect(issues({ ...vault, AZURE_KEY_VAULT_URL: "http://example-vault.vault.azure.net" }).join("\n")).toMatch(/AZURE_KEY_VAULT_URL/);
    expect(issues({ ...vault, AZURE_KEY_VAULT_URL: "https://example.test" }).join("\n")).toMatch(/AZURE_KEY_VAULT_URL/);
    const found = issues({ ...vault, DATA_ENCRYPTION_KEY_WRAPPED: "not a wrapped key" });
    expect(found.join("\n")).toMatch(/DATA_ENCRYPTION_KEY_WRAPPED: must look like/);
    expect(found.join("\n")).not.toContain("not a wrapped key");
    expect(isVaultUrl("https://a.vault.azure.net")).toBe(true);
    expect(isVaultUrl("https://a.vault.azure.net/")).toBe(true);
    expect(isVaultUrl("https://user@a.vault.azure.net")).toBe(false);
    expect(isVaultUrl("https://vault.azure.net")).toBe(false);
    expect(isVaultUrl("https://a.vault.azure.net/keys")).toBe(false);
  });

  it("reads the client secret from AZURE_CLIENT_SECRET_FILE like the sign-in key file", () => {
    const file = path.join(directory, "client-secret");
    writeFileSync(file, "synthetic-file-client-secret\n", { mode: 0o400 });
    const { AZURE_CLIENT_SECRET: _omit, ...withoutSecret } = vault;
    void _omit;
    const result = validateServerEnv({ ...base, ...withoutSecret, AZURE_CLIENT_SECRET_FILE: file });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.AZURE_CLIENT_SECRET).toBe("synthetic-file-client-secret");

    const both = issues({ ...vault, AZURE_CLIENT_SECRET_FILE: file });
    expect(both.join("\n")).toMatch(/AZURE_CLIENT_SECRET_FILE: .*both set/);
    expect(both.join("\n")).not.toContain("synthetic-file-client-secret");

    const missing = issues({ ...withoutSecret, AZURE_CLIENT_SECRET_FILE: path.join(directory, "nope") });
    expect(missing.join("\n")).toMatch(/does not exist/);
  });
});
