import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getServerEnv: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getServerEnv: dependencies.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logInfo: dependencies.logInfo, logWarn: dependencies.logWarn }));

import { createAzureKeyVaultDataKeySource } from "@/lib/data-key/azure-key-vault";
import {
  dataKeyMode,
  ensureDataKeyLoaded,
  getDataKeyState,
  resetDataKeyringForTests,
  setDataKeySourceForTests,
  startDataKeyLoading,
} from "@/lib/data-key/keyring";
import { DataKeySourceError } from "@/lib/data-key/types";

const devKey = "synthetic-data-key-0123456789-abcdefghijklmn";
const azureEnv = {
  DATA_KEY_SOURCE: "azure-key-vault",
  AZURE_KEY_VAULT_URL: "https://example-vault.vault.azure.net",
  AZURE_KEY_VAULT_KEY_NAME: "data-kek",
  AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000000",
  AZURE_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
  AZURE_CLIENT_SECRET: "synthetic-client-secret-value",
  DATA_ENCRYPTION_KEY_WRAPPED: "0123456789abcdef0123456789abcdef.c3ludGhldGljLXdyYXBwZWQta2V5LWJ5dGVz",
  DATA_ENCRYPTION_KEY_VERSION: 1,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDataKeyringForTests();
  dependencies.getServerEnv.mockReturnValue({});
});

afterEach(() => {
  vi.useRealTimers();
  resetDataKeyringForTests();
});

describe("data keyring modes", () => {
  it("is not separate when DATA_KEY_SOURCE is unset", async () => {
    expect(dataKeyMode()).toBe("not-separate");
    expect(getDataKeyState()).toEqual({ kind: "not-separate" });
    await expect(ensureDataKeyLoaded()).resolves.toBeUndefined();
  });

  it("unlocks the development source on first use without waiting", () => {
    dependencies.getServerEnv.mockReturnValue({ DATA_KEY_SOURCE: "dev-env", DATA_ENCRYPTION_KEY: devKey, DATA_ENCRYPTION_KEY_VERSION: 3 });
    const state = getDataKeyState();
    expect(state.kind).toBe("ready");
    if (state.kind === "ready") {
      expect(state.ring.current.version).toBe(3);
      expect(state.ring.previous).toBeUndefined();
    }
  });

  it("loads a previous development key with its version", () => {
    dependencies.getServerEnv.mockReturnValue({
      DATA_KEY_SOURCE: "dev-env",
      DATA_ENCRYPTION_KEY: devKey,
      DATA_ENCRYPTION_KEY_VERSION: 2,
      DATA_ENCRYPTION_PREVIOUS_KEY: `${devKey}-old`,
      DATA_ENCRYPTION_PREVIOUS_KEY_VERSION: 1,
    });
    const state = getDataKeyState();
    expect(state.kind === "ready" && state.ring.previous?.version).toBe(1);
  });

  it("reports a development source with no key as unavailable (misconfigured)", () => {
    dependencies.getServerEnv.mockReturnValue({ DATA_KEY_SOURCE: "dev-env" });
    expect(getDataKeyState()).toMatchObject({ kind: "unavailable", reason: "misconfigured" });
  });
});

describe("background loading", () => {
  it("shares one attempt, becomes ready, and logs it once", async () => {
    let calls = 0;
    const ring = { current: { version: 1, ikm: Buffer.alloc(32, 1) } };
    setDataKeySourceForTests({ load: async () => { calls += 1; return ring; } });
    expect(getDataKeyState().kind).toBe("loading");
    await Promise.all([ensureDataKeyLoaded(), ensureDataKeyLoaded()]);
    await ensureDataKeyLoaded();
    expect(calls).toBe(1);
    expect(getDataKeyState().kind).toBe("ready");
    expect(dependencies.logInfo).toHaveBeenCalledTimes(1);
  });

  it("never throws, keeps only a reason category, and warns once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    let calls = 0;
    setDataKeySourceForTests({ load: async () => { calls += 1; throw new DataKeySourceError("access-denied"); } });
    await expect(ensureDataKeyLoaded()).resolves.toBeUndefined();
    expect(getDataKeyState()).toMatchObject({ kind: "unavailable", reason: "access-denied" });

    // Within 30 seconds nothing is retried.
    vi.setSystemTime(new Date("2026-11-15T12:00:20Z"));
    await ensureDataKeyLoaded();
    expect(calls).toBe(1);

    // After 30 seconds it tries again, and a second failure does not warn again.
    vi.setSystemTime(new Date("2026-11-15T12:00:31Z"));
    await ensureDataKeyLoaded();
    expect(calls).toBe(2);
    expect(dependencies.logWarn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dependencies.logWarn.mock.calls)).toBe(
      JSON.stringify([["The personal-data key is unavailable; protected fields are locked until it loads.", { reason: "access-denied" }]]),
    );
  });

  it("recovers when the source answers again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    let fail = true;
    setDataKeySourceForTests({
      load: async () => {
        if (fail) throw new DataKeySourceError("vault-unreachable");
        return { current: { version: 1, ikm: Buffer.alloc(32, 2) } };
      },
    });
    await ensureDataKeyLoaded();
    expect(getDataKeyState().kind).toBe("unavailable");
    fail = false;
    vi.setSystemTime(new Date("2026-11-15T12:01:00Z"));
    await ensureDataKeyLoaded();
    expect(getDataKeyState().kind).toBe("ready");
  });

  it("startDataKeyLoading schedules a background retry that does not keep the process alive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    let calls = 0;
    let fail = true;
    setDataKeySourceForTests({
      load: async () => {
        calls += 1;
        if (fail) throw new DataKeySourceError("vault-unreachable");
        return { current: { version: 1, ikm: Buffer.alloc(32, 3) } };
      },
    });
    await startDataKeyLoading();
    expect(calls).toBe(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    expect(getDataKeyState().kind).toBe("ready");
  });
});

describe("Azure Key Vault source", () => {
  const ikm = Buffer.alloc(32, 7);

  function vaultFetch(overrides: { token?: () => Response; unwrap?: () => Response } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("https://login.microsoftonline.com/")) return overrides.token?.() ?? json({ access_token: "synthetic-token" });
      return overrides.unwrap?.() ?? json({ value: ikm.toString("base64url") });
    });
    return { fetchImpl, calls };
  }

  it("signs in as the application, then unwraps the key", async () => {
    const { fetchImpl, calls } = vaultFetch();
    const ring = await createAzureKeyVaultDataKeySource({ fetch: fetchImpl, env: azureEnv }).load();
    expect(ring.current.version).toBe(1);
    expect(ring.current.ikm.equals(ikm)).toBe(true);
    expect(ring.previous).toBeUndefined();

    expect(calls[0].url).toBe("https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/oauth2/v2.0/token");
    expect(calls[0].init.method).toBe("POST");
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: azureEnv.AZURE_CLIENT_ID,
      client_secret: azureEnv.AZURE_CLIENT_SECRET,
      scope: "https://vault.azure.net/.default",
    });
    expect(calls[1].url).toBe("https://example-vault.vault.azure.net/keys/data-kek/0123456789abcdef0123456789abcdef/unwrapkey?api-version=7.4");
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer synthetic-token");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ alg: "RSA-OAEP-256", value: "c3ludGhldGljLXdyYXBwZWQta2V5LWJ5dGVz" });
    for (const call of calls) expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("also unwraps a previous key with its own version", async () => {
    const { fetchImpl, calls } = vaultFetch();
    const ring = await createAzureKeyVaultDataKeySource({
      fetch: fetchImpl,
      env: {
        ...azureEnv,
        DATA_ENCRYPTION_KEY_VERSION: 2,
        DATA_ENCRYPTION_PREVIOUS_KEY_WRAPPED: "fedcba9876543210fedcba9876543210.b2xkLXdyYXBwZWQta2V5LWJ5dGVzLXN5bnRoZXRpYw",
        DATA_ENCRYPTION_PREVIOUS_KEY_VERSION: 1,
      },
    }).load();
    expect(ring.current.version).toBe(2);
    expect(ring.previous?.version).toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toContain("/fedcba9876543210fedcba9876543210/unwrapkey");
  });

  async function reasonOf(options: Parameters<typeof vaultFetch>[0], env = azureEnv) {
    const { fetchImpl } = vaultFetch(options);
    try {
      await createAzureKeyVaultDataKeySource({ fetch: fetchImpl, env }).load();
    } catch (error) {
      expect(error).toBeInstanceOf(DataKeySourceError);
      const text = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
      for (const secret of [azureEnv.AZURE_CLIENT_SECRET, "synthetic-token", azureEnv.DATA_ENCRYPTION_KEY_WRAPPED, "secret-body"]) {
        expect(text).not.toContain(secret);
      }
      return (error as DataKeySourceError).reason;
    }
    throw new Error("expected a failure");
  }

  it("maps failures to reason categories only", async () => {
    expect(await reasonOf({ token: () => json({ error: "secret-body" }, 401) })).toBe("access-denied");
    expect(await reasonOf({ unwrap: () => json({ error: "secret-body" }, 403) })).toBe("access-denied");
    expect(await reasonOf({ token: () => json({}, 503) })).toBe("vault-unreachable");
    expect(await reasonOf({ unwrap: () => json({}, 500) })).toBe("vault-unreachable");
    expect(await reasonOf({ unwrap: () => json({ error: "secret-body" }, 400) })).toBe("unwrap-failed");
    expect(await reasonOf({ unwrap: () => json({}, 404) })).toBe("unwrap-failed");
    expect(await reasonOf({ token: () => json({ not_a_token: true }) })).toBe("unwrap-failed");
    expect(await reasonOf({ unwrap: () => new Response("not json") })).toBe("unwrap-failed");
  });

  it("refuses a key that is not exactly 32 bytes", async () => {
    expect(await reasonOf({ unwrap: () => json({ value: Buffer.alloc(16).toString("base64url") }) })).toBe("unwrap-failed");
    expect(await reasonOf({ unwrap: () => json({ value: Buffer.alloc(48).toString("base64url") }) })).toBe("unwrap-failed");
  });

  it("treats a network failure or timeout as unreachable", async () => {
    const failing = vi.fn(async () => { throw new TypeError("secret-body network down"); });
    await expect(createAzureKeyVaultDataKeySource({ fetch: failing, env: azureEnv }).load()).rejects.toMatchObject({ reason: "vault-unreachable" });
  });

  it("reports missing settings as misconfigured without calling the network", async () => {
    const { fetchImpl } = vaultFetch();
    await expect(
      createAzureKeyVaultDataKeySource({ fetch: fetchImpl, env: { ...azureEnv, AZURE_CLIENT_SECRET: undefined } }).load(),
    ).rejects.toMatchObject({ reason: "misconfigured" });
    await expect(
      createAzureKeyVaultDataKeySource({ fetch: fetchImpl, env: { ...azureEnv, DATA_ENCRYPTION_KEY_WRAPPED: "no-dot-here" } }).load(),
    ).rejects.toMatchObject({ reason: "misconfigured" });
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining("unwrapkey"), expect.anything());
  });
});
