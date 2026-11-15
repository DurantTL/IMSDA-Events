/**
 * Makes a new personal-data key and wraps it for the key vault (#1652). A person
 * runs this once, from docs/DATA-KEY-AZURE-KEY-VAULT.md, and again to rotate the
 * data key.
 *
 *   npm run data-key:wrap -- --public-key <pem file> --kek-version <vault key version id>
 *
 * It generates 32 random bytes in memory, wraps them with the vault key's PUBLIC
 * key (RSA-OAEP with SHA-256, the same wrapping the vault unwraps), and prints
 * one line for the server environment:
 *
 *   DATA_ENCRYPTION_KEY_WRAPPED=<kek version>.<wrapped key>
 *
 * The plain data key is never printed, written to a file or logged: only the
 * wrapped copy leaves this process, and only the vault can unwrap it. The public
 * key file is not secret (`az keyvault key download --encoding PEM`).
 */
import { constants, publicEncrypt, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const KEK_VERSION_PATTERN = /^[0-9a-fA-F]{8,64}$/;

export type WrapOptions = {
  publicKeyPem: string;
  kekVersion: string;
  /** Test seam: the 32 bytes to wrap. Left out, 32 random bytes are generated. */
  key?: Buffer;
};

/** Returns the environment line. Throws a short message (never key bytes) for bad input. */
export function wrapDataKey(options: WrapOptions): string {
  if (!KEK_VERSION_PATTERN.test(options.kekVersion)) {
    throw new Error("--kek-version must be the vault key's version id (letters a-f and digits, as shown by the vault).");
  }
  const key = options.key ?? randomBytes(32);
  if (key.length !== 32) throw new Error("The data key must be 32 bytes.");
  let wrapped: Buffer;
  try {
    wrapped = publicEncrypt(
      { key: options.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      key,
    );
  } catch {
    throw new Error("The public key file could not be used to wrap a key. Download the vault key's public part as PEM and try again.");
  }
  return `DATA_ENCRYPTION_KEY_WRAPPED=${options.kekVersion}.${wrapped.toString("base64url")}`;
}

function argument(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function runDataKeyWrap(args: string[], io: { log: (line: string) => void; error: (line: string) => void }): number {
  const publicKeyPath = argument(args, "--public-key");
  const kekVersion = argument(args, "--kek-version");
  if (!publicKeyPath || !kekVersion) {
    io.error("Usage: npm run data-key:wrap -- --public-key <pem file> --kek-version <vault key version id>");
    return 1;
  }
  let pem: string;
  try {
    pem = readFileSync(publicKeyPath, "utf8");
  } catch {
    io.error("[data-key-wrap] FAILED: the public key file could not be read.");
    return 1;
  }
  try {
    io.log(wrapDataKey({ publicKeyPem: pem, kekVersion }));
    return 0;
  } catch (error) {
    io.error(`[data-key-wrap] FAILED: ${error instanceof Error ? error.message : "could not wrap a key"}`);
    return 1;
  }
}

if (process.argv[1]?.endsWith("data-key-wrap.ts")) {
  process.exit(runDataKeyWrap(process.argv.slice(2), { log: (line) => console.log(line), error: (line) => console.error(line) }));
}
