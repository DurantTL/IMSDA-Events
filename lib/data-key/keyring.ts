import { createAzureKeyVaultDataKeySource } from "@/lib/data-key/azure-key-vault";
import { loadDevEnvKeys } from "@/lib/data-key/dev-env";
import {
  DataKeySourceError,
  type DataKeyRing,
  type DataKeySource,
  type DataKeyUnavailableReason,
} from "@/lib/data-key/types";
import { getServerEnv } from "@/lib/env";
import { logInfo, logWarn } from "@/lib/logger";

/**
 * The data keyring (#1652): where the server keeps the personal-data key once
 * a source has loaded it.
 *
 * The state lives on `globalThis` under a registered symbol because Next can
 * load this module in more than one bundle in the same process; they must
 * share one answer. States:
 *
 *  - `not-separate`: `DATA_KEY_SOURCE` is not set. Personal data uses the
 *    sign-in key, as before.
 *  - `loading`: a source is configured and has not answered yet.
 *  - `ready`: the key is in memory.
 *  - `unavailable`: the source failed. Only a reason category is kept. A new
 *    attempt is made when something asks and the last one was at least 30
 *    seconds ago, and by a background timer every 60 seconds.
 *
 * Nothing here throws, and nothing logs or returns a key.
 */

export type DataKeyMode = "not-separate" | "azure-key-vault" | "dev-env";

export type DataKeyState =
  | { kind: "not-separate" }
  | { kind: "loading" }
  | { kind: "ready"; ring: DataKeyRing }
  | { kind: "unavailable"; reason: DataKeyUnavailableReason; since: number };

type LiveState = Exclude<DataKeyState, { kind: "not-separate" }>;

type Holder = {
  state: LiveState | null;
  inflight: Promise<void> | null;
  lastAttempt: number;
  retryTimer: ReturnType<typeof setInterval> | null;
  testSource: DataKeySource | null;
  forcedNotSeparate: boolean;
};

const HOLDER_KEY = Symbol.for("imsda.dataKeyring");
/** An attempt is repeated on demand only when the last one is at least this old. */
const RETRY_AFTER_MS = 30_000;
/** The background retry while the key is unavailable. */
const RETRY_INTERVAL_MS = 60_000;

function holder(): Holder {
  const store = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (store[HOLDER_KEY] ??= {
    state: null,
    inflight: null,
    lastAttempt: 0,
    retryTimer: null,
    testSource: null,
    forcedNotSeparate: false,
  });
}

/** What `DATA_KEY_SOURCE` says. */
export function dataKeyMode(): DataKeyMode {
  const h = holder();
  if (h.forcedNotSeparate) return "not-separate";
  if (h.testSource) return "azure-key-vault";
  return getServerEnv().DATA_KEY_SOURCE ?? "not-separate";
}

function sourceFor(mode: DataKeyMode): DataKeySource {
  const h = holder();
  if (h.testSource) return h.testSource;
  if (mode === "azure-key-vault") return createAzureKeyVaultDataKeySource();
  return { load: async () => loadDevEnvKeys() };
}

export function getDataKeyState(): DataKeyState {
  const mode = dataKeyMode();
  if (mode === "not-separate") return { kind: "not-separate" };
  const h = holder();
  if (h.state) return h.state;
  if (mode === "dev-env" && !h.testSource) {
    // No network involved: unlock on first use, so a development process and CI never wait.
    try {
      h.state = { kind: "ready", ring: loadDevEnvKeys() };
    } catch {
      h.state = { kind: "unavailable", reason: "misconfigured", since: Date.now() };
    }
    return h.state;
  }
  h.state = { kind: "loading" };
  return h.state;
}

/** The loaded keys, or undefined while the key is not separate, loading or unavailable. */
export function readyDataKeys(): DataKeyRing | undefined {
  const state = getDataKeyState();
  return state.kind === "ready" ? state.ring : undefined;
}

function reasonOf(error: unknown): DataKeyUnavailableReason {
  return error instanceof DataKeySourceError ? error.reason : "unwrap-failed";
}

async function attempt(mode: DataKeyMode) {
  const h = holder();
  h.lastAttempt = Date.now();
  const before = h.state;
  try {
    const ring = await sourceFor(mode).load();
    h.state = { kind: "ready", ring };
    logInfo("The personal-data key is loaded.", { version: ring.current.version });
    if (ring.previousProblem) {
      logWarn("The previous personal-data key could not be loaded; values sealed with it are locked until it loads.", { reason: ring.previousProblem });
    }
  } catch (error) {
    const reason = reasonOf(error);
    const since = before?.kind === "unavailable" ? before.since : Date.now();
    h.state = { kind: "unavailable", reason, since };
    // One line when it becomes unavailable, not one per retry.
    if (before?.kind !== "unavailable") {
      logWarn("The personal-data key is unavailable; protected fields are locked until it loads.", { reason });
    }
  }
}

/**
 * Makes sure a load has been tried. Idempotent, shares one in-flight attempt,
 * never throws. Once the key is unavailable it tries again when the last
 * attempt was at least 30 seconds ago.
 */
export function ensureDataKeyLoaded(): Promise<void> {
  try {
    return ensure();
  } catch {
    // An unusable environment is reported by environment validation; this never throws.
    return Promise.resolve();
  }
}

function ensure(): Promise<void> {
  const mode = dataKeyMode();
  if (mode === "not-separate") return Promise.resolve();
  const state = getDataKeyState();
  if (state.kind === "ready") return Promise.resolve();
  const h = holder();
  if (h.inflight) return h.inflight;
  if (state.kind === "unavailable" && Date.now() - h.lastAttempt < RETRY_AFTER_MS) return Promise.resolve();
  const promise = attempt(mode).finally(() => {
    h.inflight = null;
  });
  h.inflight = promise;
  return promise;
}

/**
 * For server startup: begins loading and keeps retrying in the background
 * while the key is unavailable. The timer does not keep the process alive.
 */
export function startDataKeyLoading(): Promise<void> {
  const loading = ensureDataKeyLoaded();
  const h = holder();
  if (dataKeyMode() !== "not-separate" && !h.retryTimer) {
    h.retryTimer = setInterval(() => {
      const state = getDataKeyState();
      if (state.kind === "ready") {
        if (h.retryTimer) clearInterval(h.retryTimer);
        h.retryTimer = null;
        return;
      }
      void ensureDataKeyLoaded();
    }, RETRY_INTERVAL_MS);
    h.retryTimer.unref();
  }
  return loading;
}

/** Test hook: clears the keyring and any injected source. */
export function resetDataKeyringForTests() {
  const h = holder();
  if (h.retryTimer) clearInterval(h.retryTimer);
  h.state = null;
  h.inflight = null;
  h.lastAttempt = 0;
  h.retryTimer = null;
  h.testSource = null;
  h.forcedNotSeparate = false;
}

/** Test hook: use this source instead of the configured one (the keyring then starts as `loading`). */
export function setDataKeySourceForTests(source: DataKeySource) {
  resetDataKeyringForTests();
  holder().testSource = source;
}

/** Test hook: put the keyring directly in a state, as a separate key (or, for "not-separate", as not separate). */
export function setDataKeyStateForTests(
  state:
    | "not-separate"
    | { kind: "ready"; ring: DataKeyRing }
    | { kind: "unavailable"; reason?: DataKeyUnavailableReason }
    | { kind: "loading" },
) {
  resetDataKeyringForTests();
  const h = holder();
  if (state === "not-separate") {
    h.forcedNotSeparate = true;
    return;
  }
  if (state.kind === "ready") {
    h.testSource = { load: async () => state.ring };
    h.state = state;
  } else if (state.kind === "unavailable") {
    const reason = state.reason ?? "vault-unreachable";
    // A retry fails the same way, so the forced state holds.
    h.testSource = { load: async () => { throw new DataKeySourceError(reason); } };
    h.lastAttempt = Date.now();
    h.state = { kind: "unavailable", reason, since: Date.now() };
  } else {
    h.testSource = { load: () => new Promise<never>(() => {}) };
    h.state = state;
  }
}
