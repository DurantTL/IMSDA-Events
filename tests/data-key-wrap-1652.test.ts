import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDataKeyWrap, wrapDataKey } from "../scripts/data-key-wrap";
import { WRAPPED_KEY_PATTERN } from "../lib/env";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const kekVersion = "0123456789abcdef0123456789abcdef";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "imsda-data-key-wrap-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function unwrap(line: string) {
  const value = line.replace("DATA_ENCRYPTION_KEY_WRAPPED=", "");
  const [version, ciphertext] = [value.slice(0, value.indexOf(".")), value.slice(value.indexOf(".") + 1)];
  const plain = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(ciphertext, "base64url"),
  );
  return { version, plain };
}

describe("data-key:wrap (#1652)", () => {
  it("wraps 32 bytes that the private key unwraps, in the format the server reads", () => {
    const key = Buffer.alloc(32, 9);
    const line = wrapDataKey({ publicKeyPem: publicPem, kekVersion, key });
    expect(line.startsWith(`DATA_ENCRYPTION_KEY_WRAPPED=${kekVersion}.`)).toBe(true);
    expect(WRAPPED_KEY_PATTERN.test(line.replace("DATA_ENCRYPTION_KEY_WRAPPED=", ""))).toBe(true);
    const opened = unwrap(line);
    expect(opened.version).toBe(kekVersion);
    expect(opened.plain.equals(key)).toBe(true);
  });

  it("generates a different random key each time", () => {
    const first = unwrap(wrapDataKey({ publicKeyPem: publicPem, kekVersion })).plain;
    const second = unwrap(wrapDataKey({ publicKeyPem: publicPem, kekVersion })).plain;
    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(false);
  });

  it("prints only the wrapped line and never the plain key", () => {
    const file = path.join(directory, "kek.pem");
    writeFileSync(file, publicPem);
    const out: string[] = [];
    const code = runDataKeyWrap(["--public-key", file, "--kek-version", kekVersion], { log: (line) => out.push(line), error: (line) => out.push(line) });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const plain = unwrap(out[0]).plain;
    expect(out[0]).not.toContain(plain.toString("base64url"));
    expect(out[0]).not.toContain(plain.toString("hex"));
  });

  it("refuses missing arguments, a bad version id and an unusable key file without echoing input", () => {
    const out: string[] = [];
    const io = { log: (line: string) => out.push(line), error: (line: string) => out.push(line) };
    expect(runDataKeyWrap([], io)).toBe(1);
    expect(runDataKeyWrap(["--public-key", path.join(directory, "missing.pem"), "--kek-version", kekVersion], io)).toBe(1);
    const file = path.join(directory, "bad.pem");
    writeFileSync(file, "not a key");
    expect(runDataKeyWrap(["--public-key", file, "--kek-version", kekVersion], io)).toBe(1);
    const good = path.join(directory, "kek.pem");
    writeFileSync(good, publicPem);
    expect(runDataKeyWrap(["--public-key", good, "--kek-version", "not hex!"], io)).toBe(1);
    expect(out.join("\n")).not.toContain("not a key");
    expect(out.join("\n")).not.toContain("not hex!");
  });
});
