import { createDecipheriv, hkdfSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: dependencies.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

import { resetDataKeyringForTests, setDataKeyStateForTests } from "@/lib/data-key/keyring";
import {
  DataKeyUnavailableError,
  SecretBoxError,
  currentDataKeyVersion,
  dataKeyStatus,
  dataSealedKeyring,
  fingerprintData,
  fingerprintDataCandidates,
  fingerprintSecret,
  isDataEncryptionAvailable,
  isDataKeyUnavailable,
  openData,
  openSecret,
  previousDataKeyVersion,
  sealData,
  sealSecret,
  sealedDataKeyVersion,
} from "@/lib/secret-box";

const signInKey = "synthetic-sign-in-key-0123456789-abcdefghijklm";
const purpose = "club-roster:birth-date";
const ikm1 = Buffer.alloc(32, 11);
const ikm2 = Buffer.alloc(32, 22);

beforeEach(() => {
  vi.clearAllMocks();
  resetDataKeyringForTests();
  dependencies.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: signInKey, SECRET_ENCRYPTION_KEY_VERSION: 1 });
});

function ready(version = 1, previous?: { version: number; ikm: Buffer }) {
  setDataKeyStateForTests({ kind: "ready", ring: { current: { version, ikm: version === 1 ? ikm1 : ikm2 }, previous } });
}

describe("while the data key is not separate", () => {
  beforeEach(() => setDataKeyStateForTests("not-separate"));

  it("seals and opens with the sign-in key, exactly as before", () => {
    const sealed = sealData("2010-04-02", purpose);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(openSecret(sealed, purpose)).toBe("2010-04-02");
    expect(openData(sealed, purpose)).toBe("2010-04-02");
    expect(dataSealedKeyring(sealed)).toBe("sign-in");
    expect(fingerprintData("x", "p")).toBe(fingerprintSecret("x", "p"));
    expect(isDataEncryptionAvailable()).toBe(true);
    expect(isDataKeyUnavailable()).toBe(false);
    expect(dataKeyStatus()).toMatchObject({ mode: "not-separate", state: "not-separate" });
  });

  it("is not available without a sign-in key", () => {
    dependencies.getServerEnv.mockReturnValue({});
    expect(isDataEncryptionAvailable()).toBe(false);
  });

  it("cannot open a data-key value", () => {
    ready();
    const sealed = sealData("2010-04-02", purpose);
    setDataKeyStateForTests("not-separate");
    expect(() => openData(sealed, purpose)).toThrow(DataKeyUnavailableError);
  });
});

describe("with a separate data key", () => {
  it("writes d1 values under the data key, with the version authenticated", () => {
    ready(1);
    const sealed = sealData("2010-04-02", purpose);
    expect(sealed.split(".")[0]).toBe("d1");
    expect(sealedDataKeyVersion(sealed)).toBe(1);
    expect(dataSealedKeyring(sealed)).toBe("data");
    expect(openData(sealed, purpose)).toBe("2010-04-02");
    // The sign-in key alone cannot open it.
    expect(() => openSecret(sealed, purpose)).toThrow(SecretBoxError);
    // A different purpose cannot open it.
    expect(() => openData(sealed, "club-roster:other")).toThrow(SecretBoxError);
    // An edited version fails authentication.
    const parts = sealed.split(".");
    parts[1] = "2";
    ready(2, { version: 1, ikm: ikm1 });
    expect(() => openData(parts.join("."), purpose)).toThrow(SecretBoxError);
  });

  it("matches the documented format: HKDF with the data salt and the version as additional data", () => {
    ready(1);
    const sealed = sealData("hello", purpose);
    const [, , nonce, tag, ct] = sealed.split(".");
    const key = Buffer.from(hkdfSync("sha256", ikm1, Buffer.from("imsda-events-data-key"), Buffer.from(purpose), 32));
    
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
    decipher.setAAD(Buffer.from("imsda-data-key-v1"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    expect(Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString()).toBe("hello");
  });

  it("opens values not moved yet with the sign-in key", () => {
    setDataKeyStateForTests("not-separate");
    const old = sealSecret("2010-04-02", purpose);
    ready();
    expect(dataSealedKeyring(old)).toBe("sign-in");
    expect(openData(old, purpose)).toBe("2010-04-02");
  });

  it("opens the previous key's values during a rotation and refuses an unloaded version", () => {
    ready(1);
    const v1 = sealData("a", purpose);
    ready(2, { version: 1, ikm: ikm1 });
    expect(openData(v1, purpose)).toBe("a");
    expect(sealedDataKeyVersion(sealData("b", purpose))).toBe(2);
    expect(previousDataKeyVersion()).toBe(1);
    expect(currentDataKeyVersion()).toBe(2);
    ready(2);
    expect(() => openData(v1, purpose)).toThrow(/data key version 1, which is not loaded/);
    expect(previousDataKeyVersion()).toBeNull();
  });

  it("fingerprints with the data key and lists data, previous data, then sign-in candidates", () => {
    ready(2, { version: 1, ikm: ikm1 });
    const current = fingerprintData("https://calendar.example.test/a.ics", "calendar-feed-url");
    expect(current).not.toBe(fingerprintSecret("https://calendar.example.test/a.ics", "calendar-feed-url"));
    const candidates = fingerprintDataCandidates("https://calendar.example.test/a.ics", "calendar-feed-url");
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toBe(current);
    expect(candidates[2]).toBe(fingerprintSecret("https://calendar.example.test/a.ics", "calendar-feed-url"));
  });

  it("is available only when the key is ready, and reports a status without a key", () => {
    ready(3);
    expect(isDataEncryptionAvailable()).toBe(true);
    expect(dataKeyStatus()).toEqual({ mode: "azure-key-vault", state: "ready", version: 3, previousVersion: null, reason: null });
  });
});

describe("while the data key is unavailable or loading", () => {
  for (const state of [{ kind: "unavailable" as const, reason: "access-denied" as const }, { kind: "loading" as const }]) {
    it(`locks protected values (${state.kind}) and leaves the sign-in key alone`, () => {
      ready();
      const sealed = sealData("2010-04-02", purpose);
      setDataKeyStateForTests(state);
      expect(() => sealData("x", purpose)).toThrow(DataKeyUnavailableError);
      expect(() => openData(sealed, purpose)).toThrow(DataKeyUnavailableError);
      expect(() => fingerprintData("x", "p")).toThrow(DataKeyUnavailableError);
      expect(() => fingerprintDataCandidates("x", "p")).toThrow(DataKeyUnavailableError);
      expect(() => currentDataKeyVersion()).toThrow(DataKeyUnavailableError);
      expect(isDataEncryptionAvailable()).toBe(false);
      expect(isDataKeyUnavailable()).toBe(true);
      // Sign-in values still work, and so do values not yet moved.
      expect(openSecret(sealSecret("123456", "security-check-code"), "security-check-code")).toBe("123456");
      expect(openData(sealSecret("2010", purpose), purpose)).toBe("2010");
    });
  }

  it("is a SecretBoxError with a neutral message, and the status names a reason category only", () => {
    setDataKeyStateForTests({ kind: "unavailable", reason: "unwrap-failed" });
    try {
      sealData("secret-plaintext", "secret-purpose");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretBoxError);
      expect((error as Error).name).toBe("DataKeyUnavailableError");
      expect((error as Error).message).not.toMatch(/secret-plaintext|secret-purpose/);
    }
    expect(dataKeyStatus()).toMatchObject({ state: "unavailable", reason: "unwrap-failed", version: null });
  });
});
