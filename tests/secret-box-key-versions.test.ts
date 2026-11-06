import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: dependencies.getServerEnv }));

import {
  SecretBoxError,
  currentSecretKeyVersion,
  fingerprintSecret,
  fingerprintSecretCandidates,
  openSecret,
  openSecretWithKey,
  previousSecretKeyVersion,
  sealSecret,
  sealSecretWithKey,
  sealedKeyVersion,
} from "@/lib/secret-box";

const oldKey = "synthetic-old-key-0123456789-abcdefghijklmnopq";
const newKey = "synthetic-new-key-0123456789-abcdefghijklmnopq";
const purpose = "mfa-totp-secret";

function env(values: Record<string, unknown>) {
  dependencies.getServerEnv.mockReturnValue(values);
}

/** A value as the code wrote it before key versions existed: `v1.<nonce>.<tag>.<ct>`, no additional data. */
function legacyV1(key: string, plaintext: string, forPurpose: string) {
  const derived = Buffer.from(hkdfSync("sha256", Buffer.from(key), Buffer.from("imsda-events-secret-box"), Buffer.from(forPurpose), 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

beforeEach(() => {
  vi.clearAllMocks();
  env({ SECRET_ENCRYPTION_KEY: oldKey });
});

describe("key versions", () => {
  it("opens a legacy v1 value as key version 1", () => {
    const legacy = legacyV1(oldKey, "synthetic-secret", purpose);
    expect(sealedKeyVersion(legacy)).toBe(1);
    expect(openSecret(legacy, purpose)).toBe("synthetic-secret");
  });

  it("writes the legacy v1 format while the current version is 1, v2 from version 2", () => {
    const first = sealSecret("x", purpose);
    expect(first.startsWith("v1.")).toBe(true);
    expect(sealedKeyVersion(first)).toBe(1);
    env({ SECRET_ENCRYPTION_KEY: newKey, SECRET_ENCRYPTION_KEY_VERSION: 2 });
    expect(sealSecret("x", purpose).startsWith("v2.2.")).toBe(true);
    env({ SECRET_ENCRYPTION_KEY: newKey, SECRET_ENCRYPTION_KEY_VERSION: 3 });
    const sealed = sealSecret("x", purpose);
    expect(sealed.startsWith("v2.3.")).toBe(true);
    expect(sealedKeyVersion(sealed)).toBe(3);
    expect(currentSecretKeyVersion()).toBe(3);
    expect(openSecret(sealed, purpose)).toBe("x");
  });

  it("opens each value with the key of its version during a rotation", () => {
    const oldV1 = legacyV1(oldKey, "from-legacy", purpose);
    const oldV1Written = sealSecret("from-v2-version-1", purpose);
    env({
      SECRET_ENCRYPTION_KEY: newKey,
      SECRET_ENCRYPTION_KEY_VERSION: 2,
      SECRET_ENCRYPTION_PREVIOUS_KEY: oldKey,
      SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION: 1,
    });
    const current = sealSecret("from-current", purpose);
    expect(previousSecretKeyVersion()).toBe(1);
    expect(openSecret(oldV1, purpose)).toBe("from-legacy");
    expect(openSecret(oldV1Written, purpose)).toBe("from-v2-version-1");
    expect(openSecret(current, purpose)).toBe("from-current");
    expect(sealedKeyVersion(current)).toBe(2);
  });

  it("refuses a version that is not loaded, naming only the version", () => {
    const sealed = sealSecret("synthetic-plaintext-marker", "health-record:rec_123:allergies");
    env({ SECRET_ENCRYPTION_KEY: newKey, SECRET_ENCRYPTION_KEY_VERSION: 2 });
    let message = "";
    try {
      openSecret(sealed, "health-record:rec_123:allergies");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretBoxError);
      message = (error as Error).message;
    }
    expect(message).toBe("The stored value was sealed with key version 1, which is not loaded.");
    const everything = message;
    for (const secret of [oldKey, newKey, "rec_123", "allergies", sealed, sealed.split(".")[4], "synthetic-plaintext-marker"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("refuses a value whose version was edited", () => {
    env({
      SECRET_ENCRYPTION_KEY: newKey,
      SECRET_ENCRYPTION_KEY_VERSION: 2,
      SECRET_ENCRYPTION_PREVIOUS_KEY: oldKey,
      SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION: 1,
    });
    const sealed = sealSecret("x", purpose);
    const parts = sealed.split(".");
    // Relabelled as the previous version: it would be tried against the previous key, which did not seal it.
    expect(() => openSecret(["v2", "1", ...parts.slice(2)].join("."), purpose)).toThrowError(/could not be decrypted/);
    // Relabelled as the same version but under another key it could never have been sealed with.
    env({ SECRET_ENCRYPTION_KEY: oldKey, SECRET_ENCRYPTION_KEY_VERSION: 5 });
    const five = sealSecret("x", purpose);
    const relabelled = ["v2", "6", ...five.split(".").slice(2)].join(".");
    env({ SECRET_ENCRYPTION_KEY: oldKey, SECRET_ENCRYPTION_KEY_VERSION: 6 });
    expect(() => openSecret(relabelled, purpose)).toThrowError(/could not be decrypted/);
  });

  it("rejects malformed versions and formats", () => {
    env({ SECRET_ENCRYPTION_KEY: oldKey, SECRET_ENCRYPTION_KEY_VERSION: 2 });
    const parts = sealSecret("x", purpose).split(".");
    for (const bad of [
      ["v2", "0", ...parts.slice(2)],
      ["v2", "-1", ...parts.slice(2)],
      ["v2", "one", ...parts.slice(2)],
      ["v2", ...parts.slice(2)],
      ["v3", ...parts.slice(1)],
    ]) {
      expect(() => openSecret(bad.join("."), purpose)).toThrowError(/expected sealed format/);
    }
  });

  it("uses the current key for fingerprints, and offers the previous one as a lookup candidate", () => {
    const first = fingerprintSecret("https://example.test/a", "calendar-feed-url");
    env({
      SECRET_ENCRYPTION_KEY: newKey,
      SECRET_ENCRYPTION_KEY_VERSION: 2,
      SECRET_ENCRYPTION_PREVIOUS_KEY: oldKey,
      SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION: 1,
    });
    const current = fingerprintSecret("https://example.test/a", "calendar-feed-url");
    expect(current).not.toBe(first);
    expect(fingerprintSecretCandidates("https://example.test/a", "calendar-feed-url")).toEqual([current, first]);
    env({ SECRET_ENCRYPTION_KEY: newKey, SECRET_ENCRYPTION_KEY_VERSION: 2 });
    expect(fingerprintSecretCandidates("https://example.test/a", "calendar-feed-url")).toEqual([current]);
  });

  it("operator tools open v1 and v2 with the given key whatever its version", () => {
    const key = "synthetic-backup-key-0123456789-abcdefghijklmn";
    const v2 = sealSecretWithKey("restore", purpose, key, 4);
    expect(v2.startsWith("v2.4.")).toBe(true);
    expect(sealSecretWithKey("one", purpose, key).startsWith("v1.")).toBe(true);
    expect(openSecretWithKey(v2, purpose, key)).toBe("restore");
    expect(openSecretWithKey(legacyV1(key, "legacy-restore", purpose), purpose, key)).toBe("legacy-restore");
    expect(openSecretWithKey(sealSecretWithKey("default", purpose, key), purpose, key)).toBe("default");
    expect(() => openSecretWithKey(v2, purpose, oldKey)).toThrowError(/could not be decrypted/);
  });
});
