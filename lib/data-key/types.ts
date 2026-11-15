/**
 * The personal-data key (#1652, docs/decisions/0017-sign-in-key-and-data-key.md).
 *
 * A source hands the server the key material once; the keyring (`keyring.ts`)
 * holds it in memory. Nothing in this folder prints or returns a key, a token,
 * a client secret or a response body: a failure is a reason category only.
 */

export type DataKeyMaterial = {
  version: number;
  /** The input key material for HKDF (32 random bytes from the vault, or the utf8 bytes of the development value). */
  ikm: Buffer;
};

export type DataKeyRing = {
  current: DataKeyMaterial;
  previous?: DataKeyMaterial;
  /**
   * Set when a previous key is configured but could not be loaded. The current key still works: values sealed with the
   * previous one are unreadable until it loads, and the status shows why. A category only.
   */
  previousProblem?: DataKeyUnavailableReason;
};

/** Why the key could not be loaded, in the four categories an operator can act on. */
export type DataKeyUnavailableReason = "vault-unreachable" | "access-denied" | "unwrap-failed" | "misconfigured";

export interface DataKeySource {
  load(): Promise<DataKeyRing>;
}

export class DataKeySourceError extends Error {
  readonly reason: DataKeyUnavailableReason;

  constructor(reason: DataKeyUnavailableReason) {
    // The category only: no response text, token, address or secret.
    super(`The personal-data key could not be loaded (${reason}).`);
    this.name = "DataKeySourceError";
    this.reason = reason;
  }
}

/** Plain words for an administrator, one per reason category. */
export const DATA_KEY_REASON_TEXT: Record<DataKeyUnavailableReason, string> = {
  "vault-unreachable": "the key vault could not be reached",
  "access-denied": "the key vault refused access (check the app's client secret and its permission)",
  "unwrap-failed": "the key vault could not unwrap the data key (check the wrapped key and the vault key version)",
  misconfigured: "the key vault sign-in or the personal-data key settings are not usable (check the tenant id, client id and settings)",
};
