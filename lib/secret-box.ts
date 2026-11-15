import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { ensureDataKeyLoaded, getDataKeyState, readyDataKeys, dataKeyMode } from "@/lib/data-key/keyring";
import type { DataKeyMaterial, DataKeyUnavailableReason } from "@/lib/data-key/types";
import { getServerEnv } from "@/lib/env";

/**
 * Authenticated encryption for the few values that must be recoverable rather
 * than hashed. There are two keys (#1652, docs/decisions/0017-sign-in-key-and-data-key.md):
 *
 *  - the SIGN-IN key (`sealSecret`, `openSecret`, `fingerprintSecret`): sign-in
 *    secrets and codes. Always available from the server's key file.
 *  - the personal-data key (`sealData`, `openData`, `fingerprintData`, near
 *    the end of this file): health records, birth dates, sensitive club form
 *    answers and calendar feed addresses. Loaded from `lib/data-key/`; while
 *    `DATA_KEY_SOURCE` is not set it IS the sign-in key.
 *
 * The rest of this comment describes the sign-in key.
 *
 * A TOTP secret is the first: verifying a code requires the secret itself, so
 * unlike a password or a session token it cannot be stored as a digest. What it
 * can be is useless to anyone holding only a database dump.
 *
 * AES-256-GCM with a random 96-bit nonce per value. The key is derived from
 * the sign-in key (`SECRET_ENCRYPTION_KEY`, or the file named by `SECRET_ENCRYPTION_KEY_FILE`, see `lib/env.ts`) through HKDF with a per-purpose info string, so two
 * kinds of ciphertext are never encrypted under the same key and a value cannot
 * be moved from one column to another.
 *
 * Key versions (#1516): while the key version is 1, values are written in the
 * original `v1.<nonce>.<tag>.<ct>` format (version 1 is implied), so an older
 * image can still read them. From version 2 a value is
 * `v2.<keyVersion>.<nonce>.<tag>.<ct>` and the version is authenticated as
 * additional data, so it cannot be edited. Writes always use
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
  // Key version 1 keeps the legacy format, so an image from before versioning can still read it (rollback).
  // Version 2 and up use the format that authenticates the version.
  if (version > 1) cipher.setAAD(additionalData(version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    ...(version > 1 ? [FORMAT, String(version)] : [LEGACY_FORMAT]),
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

/**
 * Sealed with the current key, all base64url: `v1.<nonce>.<tag>.<ciphertext>` while the current key version is 1,
 * `v2.<keyVersion>.<nonce>.<tag>.<ciphertext>` from version 2.
 */
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
 * the sign-in key (`SECRET_ENCRYPTION_KEY`, always the current key) with its own purpose string,
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

/** The sign-in key version new values are sealed with. Throws `SecretBoxError` when no key is configured. */
export function currentSecretKeyVersion() {
  const { current } = loadedKeys();
  if (!current) throw new SecretBoxError(NO_KEY_MESSAGE);
  return current.version;
}

/** The version of the previous key while a rotation has it loaded, otherwise null. */
export function previousSecretKeyVersion() {
  return loadedKeys().previous?.version ?? null;
}

// ---------------------------------------------------------------------------
// The personal-data key (#1652)
// ---------------------------------------------------------------------------

/** Data-key values: `d1.<keyVersion>.<nonce>.<tag>.<ct>`, the version authenticated as additional data. */
const DATA_FORMAT = "d1";
/** Differs from the sign-in salt, so the two keys never derive the same purpose key. */
const DATA_SALT = "imsda-events-data-key";

/**
 * The personal-data key is not loaded: still loading, or its source failed. Callers lock the protected field
 * and carry on; nothing else about the page depends on it. The message carries no key, purpose or value.
 */
export class DataKeyUnavailableError extends SecretBoxError {
  constructor(message = "The personal-data key is unavailable right now.") {
    super(message);
    this.name = "DataKeyUnavailableError";
  }
}

function deriveDataKey(ikm: Buffer, purpose: string) {
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.from(DATA_SALT, "utf8"), Buffer.from(purpose, "utf8"), KEY_BYTES));
}

function dataAdditionalData(version: number) {
  return Buffer.from(`imsda-data-key-v${version}`, "utf8");
}

/** The ring when the data key is separate and loaded; throws `DataKeyUnavailableError` when it is separate and not loaded. */
function separateRing() {
  const ring = readyDataKeys();
  if (ring) return ring;
  void ensureDataKeyLoaded();
  throw new DataKeyUnavailableError();
}

type ParsedData = { version: number; nonce: string; tag: string; ciphertext: string };

function parseData(sealed: string): ParsedData {
  const parts = sealed.split(".");
  if (parts[0] === DATA_FORMAT && parts.length === 5 && /^[1-9]\d{0,5}$/.test(parts[1])) {
    const [, versionText, nonce, tag, ciphertext] = parts;
    if (nonce && tag && ciphertext) return { version: Number(versionText), nonce, tag, ciphertext };
  }
  throw new SecretBoxError(NOT_SEALED_MESSAGE);
}

/** Which key sealed a stored value: the personal-data key (`d1.`) or the sign-in key (`v1.`, `v2.`). */
export function dataSealedKeyring(sealed: string): "sign-in" | "data" {
  return sealed.startsWith(`${DATA_FORMAT}.`) ? "data" : "sign-in";
}

/** The key version a `d1` value says it was sealed with. */
export function sealedDataKeyVersion(sealed: string) {
  return parseData(sealed).version;
}

/**
 * Seals a personal-data value. While `DATA_KEY_SOURCE` is not set this is `sealSecret` (the sign-in key). With a
 * separate data key it writes a `d1` value under the current data key; while that key is loading or unavailable
 * it throws `DataKeyUnavailableError` and nothing is written.
 */
export function sealData(plaintext: string, purpose: string) {
  if (dataKeyMode() === "not-separate") return sealSecret(plaintext, purpose);
  const { current } = separateRing();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveDataKey(current.ikm, purpose), nonce);
  cipher.setAAD(dataAdditionalData(current.version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    DATA_FORMAT,
    String(current.version),
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function dataKeyForVersion(version: number): DataKeyMaterial {
  const ring = separateRing();
  if (version === ring.current.version) return ring.current;
  if (ring.previous && version === ring.previous.version) return ring.previous;
  // A previous key is configured but could not be loaded: a value on any other version may be sealed with it, so it is
  // locked (retried in the background), not a damaged value.
  if (ring.previousProblem) throw new DataKeyUnavailableError("The stored value may be sealed with the previous personal-data key, which is not loaded right now.");
  throw new SecretBoxError(`The stored value was sealed with data key version ${version}, which is not loaded.`);
}

/**
 * Opens a personal-data value. A `d1` value needs the data key (current or, during a rotation, previous version);
 * a `v1` or `v2` value is a value not yet moved to the data key and opens with the sign-in key, as before.
 */
export function openData(sealed: string, purpose: string) {
  if (dataSealedKeyring(sealed) === "sign-in") return openSecret(sealed, purpose);
  if (dataKeyMode() === "not-separate") {
    throw new DataKeyUnavailableError("The stored value needs the personal-data key, which is not set up on this server.");
  }
  const parsed = parseData(sealed);
  const key = dataKeyForVersion(parsed.version);
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveDataKey(key.ikm, purpose), Buffer.from(parsed.nonce, "base64url"));
    decipher.setAAD(dataAdditionalData(parsed.version));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretBoxError("The stored value could not be decrypted. The encryption key may have changed.");
  }
}

function dataFingerprintWith(key: DataKeyMaterial, value: string, purpose: string) {
  return createHmac("sha256", deriveDataKey(key.ikm, `fingerprint:${purpose}`)).update(value, "utf8").digest("base64url");
}

/** Like `fingerprintSecret`, for personal-data values: the data key's fingerprint, or the sign-in key's while the key is not separate. */
export function fingerprintData(value: string, purpose: string) {
  if (dataKeyMode() === "not-separate") return fingerprintSecret(value, purpose);
  return dataFingerprintWith(separateRing().current, value, purpose);
}

/**
 * The fingerprints a lookup should match. With a separate data key: the data key's, the previous data key's while a
 * rotation has it loaded, then the sign-in key's (current and previous), so a row not yet moved still matches.
 * While the key is not separate these are the sign-in key's.
 */
export function fingerprintDataCandidates(value: string, purpose: string) {
  if (dataKeyMode() === "not-separate") return fingerprintSecretCandidates(value, purpose);
  const ring = separateRing();
  const candidates = [dataFingerprintWith(ring.current, value, purpose)];
  if (ring.previous) candidates.push(dataFingerprintWith(ring.previous, value, purpose));
  try {
    candidates.push(...fingerprintSecretCandidates(value, purpose));
  } catch (error) {
    if (!(error instanceof SecretBoxError)) throw error;
  }
  return [...new Set(candidates)];
}

/** True when personal data can be sealed now: the sign-in key is set (not separate yet) or the data key is loaded. */
export function isDataEncryptionAvailable() {
  if (dataKeyMode() === "not-separate") return isSecretEncryptionConfigured();
  if (readyDataKeys()) return true;
  void ensureDataKeyLoaded();
  return false;
}

/**
 * True when a separate data key is configured but not fully loaded: still loading, its source failed, or a previous key
 * could not be loaded (the current key works, but values on the previous one are locked). Whole-list work that needs
 * every birth date readable refuses while this is true.
 */
export function isDataKeyUnavailable() {
  if (dataKeyMode() === "not-separate") return false;
  const ring = readyDataKeys();
  return !ring || Boolean(ring.previousProblem);
}

/**
 * Whether opening this stored value is blocked only because a key is not loaded, decided WITHOUT decrypting it. A sign-in
 * value is never locked here. A damaged or unknown-version value is not "locked" (opening it fails as unreadable).
 */
export function isSealedDataLocked(sealed: string): boolean {
  if (dataSealedKeyring(sealed) === "sign-in") return false;
  if (dataKeyMode() === "not-separate") return true;
  const ring = readyDataKeys();
  if (!ring) {
    void ensureDataKeyLoaded();
    return true;
  }
  let version: number;
  try {
    version = parseData(sealed).version;
  } catch {
    return false;
  }
  if (version === ring.current.version) return false;
  if (ring.previous && version === ring.previous.version) return false;
  return Boolean(ring.previousProblem);
}

/** The data key version new values are sealed with. Throws `DataKeyUnavailableError` when a separate key is not loaded. */
export function currentDataKeyVersion() {
  if (dataKeyMode() === "not-separate") return currentSecretKeyVersion();
  return separateRing().current.version;
}

/** The previous data key's version while a rotation has it loaded, otherwise null. */
export function previousDataKeyVersion() {
  if (dataKeyMode() === "not-separate") return previousSecretKeyVersion();
  return readyDataKeys()?.previous?.version ?? null;
}

export type DataKeyStatus = {
  mode: "not-separate" | "azure-key-vault" | "dev-env";
  state: "not-separate" | "loading" | "ready" | "unavailable";
  version: number | null;
  previousVersion: number | null;
  /** A reason category while unavailable, otherwise null. */
  reason: DataKeyUnavailableReason | null;
  /** A reason category when a previous key is configured but could not be loaded (the current key still works), otherwise null. */
  previousProblem: DataKeyUnavailableReason | null;
};

/** Non-secret summary for health and readiness displays: categories and numbers only. */
export function dataKeyStatus(): DataKeyStatus {
  const mode = dataKeyMode();
  const state = getDataKeyState();
  if (state.kind === "ready") {
    return { mode, state: "ready", version: state.ring.current.version, previousVersion: state.ring.previous?.version ?? null, reason: null, previousProblem: state.ring.previousProblem ?? null };
  }
  if (state.kind === "unavailable") {
    void ensureDataKeyLoaded();
    return { mode, state: "unavailable", version: null, previousVersion: null, reason: state.reason, previousProblem: null };
  }
  return { mode, state: state.kind, version: null, previousVersion: null, reason: null, previousProblem: null };
}
