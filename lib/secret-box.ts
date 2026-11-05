import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";

/**
 * Authenticated encryption for the few values that must be recoverable rather
 * than hashed.
 *
 * A TOTP secret is the first: verifying a code requires the secret itself, so
 * unlike a password or a session token it cannot be stored as a digest. What it
 * can be is useless to anyone holding only a database dump.
 *
 * AES-256-GCM with a random 96-bit nonce per value. The key is derived from
 * `SECRET_ENCRYPTION_KEY` (or the file named by `SECRET_ENCRYPTION_KEY_FILE`, see `lib/env.ts`) through HKDF with a per-purpose info string, so two
 * kinds of ciphertext are never encrypted under the same key and a value cannot
 * be moved from one column to another.
 *
 * Key versions (#1516): a value is `v2.<keyVersion>.<nonce>.<tag>.<ct>` and the
 * version is authenticated as additional data, so it cannot be edited. A `v1`
 * value (written before versioning) counts as key version 1. Writes always use
 * the current key. Reads use the loaded key whose version matches the value:
 * the current one, or during a rotation the previous one
 * (`SECRET_ENCRYPTION_PREVIOUS_KEY*`). `npm run key:rotate` moves values to
 * the current key.
 */

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
/** Values written before key versioning (#1516): `v1.<nonce>.<tag>.<ct>`, key version 1, no additional data. */
const LEGACY_FORMAT = "v1";
/** Current values: `v2.<keyVersion>.<nonce>.<tag>.<ct>`; the version is also authenticated as additional data. */
const FORMAT = "v2";

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

const NO_KEY_MESSAGE =
  "SECRET_ENCRYPTION_KEY (or SECRET_ENCRYPTION_KEY_FILE) must be set before encrypted values can be read or written.";

function deriveKey(configured: string | undefined, purpose: string) {
  if (!configured) throw new SecretBoxError(NO_KEY_MESSAGE);
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(configured, "utf8"),
    Buffer.from("imsda-events-secret-box", "utf8"),
    Buffer.from(purpose, "utf8"),
    KEY_BYTES,
  ));
}

type LoadedKey = { key: string; version: number };

/** The keys this process holds: the current one, and during a rotation the previous one (read-only). */
function loadedKeys(): { current: LoadedKey | undefined; previous: LoadedKey | undefined } {
  const env = getServerEnv();
  const current = env.SECRET_ENCRYPTION_KEY
    ? { key: env.SECRET_ENCRYPTION_KEY, version: env.SECRET_ENCRYPTION_KEY_VERSION ?? 1 }
    : undefined;
  const previousVersion = env.SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION;
  const previous = env.SECRET_ENCRYPTION_PREVIOUS_KEY && previousVersion !== undefined
    ? { key: env.SECRET_ENCRYPTION_PREVIOUS_KEY, version: previousVersion }
    : undefined;
  return { current, previous };
}

function additionalData(version: number) {
  return Buffer.from(`imsda-key-v${version}`, "utf8");
}

function sealWith(key: Buffer, plaintext: string, version: number) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(additionalData(version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    FORMAT,
    String(version),
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

type ParsedSealed = { version: number; nonce: string; tag: string; ciphertext: string; aad: Buffer | undefined };

const NOT_SEALED_MESSAGE = "The stored value is not in the expected sealed format.";

function parseSealed(sealed: string): ParsedSealed {
  const parts = sealed.split(".");
  if (parts[0] === LEGACY_FORMAT && parts.length === 4) {
    const [, nonce, tag, ciphertext] = parts;
    if (nonce && tag && ciphertext) return { version: 1, nonce, tag, ciphertext, aad: undefined };
  }
  if (parts[0] === FORMAT && parts.length === 5 && /^[1-9]\d{0,5}$/.test(parts[1])) {
    const [, versionText, nonce, tag, ciphertext] = parts;
    const version = Number(versionText);
    if (nonce && tag && ciphertext) return { version, nonce, tag, ciphertext, aad: additionalData(version) };
  }
  throw new SecretBoxError(NOT_SEALED_MESSAGE);
}

/** The key version a sealed value says it was sealed with (1 for a value from before versioning). */
export function sealedKeyVersion(sealed: string) {
  return parseSealed(sealed).version;
}

function openWith(getKey: (version: number) => Buffer, sealed: string) {
  const parsed = parseSealed(sealed);
  const key = getKey(parsed.version);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.nonce, "base64url"));
    if (parsed.aad) decipher.setAAD(parsed.aad);
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // A wrong key and a tampered ciphertext are the same event here: the value
    // cannot be trusted, and which of the two it was is not the caller's to know.
    throw new SecretBoxError(
      "The stored value could not be decrypted. The encryption key may have changed.",
    );
  }
}

function notLoaded(version: number) {
  // The version number only: never the value, its purpose or a key.
  return new SecretBoxError(`The stored value was sealed with key version ${version}, which is not loaded.`);
}

/** Picks the loaded key whose version matches the value's. */
function keyForVersion(version: number, purpose: string) {
  const { current, previous } = loadedKeys();
  if (!current) throw new SecretBoxError(NO_KEY_MESSAGE);
  if (version === current.version) return deriveKey(current.key, purpose);
  if (previous && version === previous.version) return deriveKey(previous.key, purpose);
  throw notLoaded(version);
}

/** Returns `v2.<keyVersion>.<nonce>.<tag>.<ciphertext>`, all base64url, sealed with the current key. */
export function sealSecret(plaintext: string, purpose: string) {
  const { current } = loadedKeys();
  if (!current) throw new SecretBoxError(NO_KEY_MESSAGE);
  return sealWith(deriveKey(current.key, purpose), plaintext, current.version);
}

/** Opens a `v1` or `v2` value with whichever loaded key matches the value's key version. */
export function openSecret(sealed: string, purpose: string) {
  return openWith((version) => keyForVersion(version, purpose), sealed);
}

/** The shortest key the production environment accepts. */
export const MIN_SECRET_KEY_LENGTH = 32;

function operatorKey(key: string, purpose: string) {
  if (key.length < MIN_SECRET_KEY_LENGTH) {
    throw new SecretBoxError(`The key must contain at least ${MIN_SECRET_KEY_LENGTH} characters.`);
  }
  return deriveKey(key, purpose);
}

/**
 * Operator-tool only (`scripts/backup/verify-key-restore.ts`): like
 * `sealSecret`, but with a key the caller resolved itself, so a tool can run
 * without loading the whole server environment. Enforces the production
 * minimum key length. Application code must use `sealSecret`.
 */
export function sealSecretWithKey(plaintext: string, purpose: string, key: string, version = 1) {
  return sealWith(operatorKey(key, purpose), plaintext, version);
}

/**
 * Operator-tool only: like `openSecret`, with an explicit key of at least the
 * production minimum length. It opens a `v1` or a `v2` value with that key
 * whatever key version the value names, so a backup copy of one key can be
 * tested against the database. Application code must use `openSecret`.
 */
export function openSecretWithKey(sealed: string, purpose: string, key: string) {
  return openWith(() => operatorKey(key, purpose), sealed);
}

/**
 * A keyed, stable fingerprint of a value (HMAC-SHA256, base64url), for finding
 * "the same secret" without storing or decrypting it. It is derived from
 * `SECRET_ENCRYPTION_KEY` (always the current key) with its own purpose string,
 * so it can't be computed (or guessed by brute force) without the key, and a
 * fingerprint from one purpose says nothing about another.
 */
export function fingerprintSecret(value: string, purpose: string) {
  const { current } = loadedKeys();
  if (!current) throw new SecretBoxError(NO_KEY_MESSAGE);
  return fingerprintWith(current.key, value, purpose);
}

function fingerprintWith(key: string, value: string, purpose: string) {
  return createHmac("sha256", deriveKey(key, `fingerprint:${purpose}`)).update(value, "utf8").digest("base64url");
}

/**
 * The fingerprints a lookup should match: the current key's and, while a
 * rotation has the previous key loaded, the previous key's, so a duplicate is
 * not missed before the rows have been re-fingerprinted. The current one is first.
 */
export function fingerprintSecretCandidates(value: string, purpose: string) {
  const { current, previous } = loadedKeys();
  if (!current) throw new SecretBoxError(NO_KEY_MESSAGE);
  const candidates = [fingerprintWith(current.key, value, purpose)];
  if (previous) candidates.push(fingerprintWith(previous.key, value, purpose));
  return candidates;
}

export function isSecretEncryptionConfigured() {
  return Boolean(getServerEnv().SECRET_ENCRYPTION_KEY);
}

/** The key version new values are sealed with. Throws `SecretBoxError` when no key is configured. */
export function currentSecretKeyVersion() {
  const { current } = loadedKeys();
  if (!current) throw new SecretBoxError(NO_KEY_MESSAGE);
  return current.version;
}

/** The version of the previous key while a rotation has it loaded, otherwise null. */
export function previousSecretKeyVersion() {
  return loadedKeys().previous?.version ?? null;
}
