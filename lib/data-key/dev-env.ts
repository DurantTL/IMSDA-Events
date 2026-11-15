import { getServerEnv } from "@/lib/env";
import { DataKeySourceError, type DataKeyRing, type DataKeySource } from "@/lib/data-key/types";

/**
 * DEVELOPMENT AND CI ONLY. The data key is a plain value in the environment
 * (`DATA_ENCRYPTION_KEY`), which is exactly what the vault source exists to
 * avoid. Environment validation refuses `DATA_KEY_SOURCE=dev-env` when
 * `NODE_ENV=production`. No network access.
 */

type DevEnv = {
  DATA_ENCRYPTION_KEY?: string;
  DATA_ENCRYPTION_KEY_VERSION?: number;
  DATA_ENCRYPTION_PREVIOUS_KEY?: string;
  DATA_ENCRYPTION_PREVIOUS_KEY_VERSION?: number;
};

/** Synchronous, so the keyring can unlock on first use without a promise. */
export function loadDevEnvKeys(env: DevEnv = getServerEnv()): DataKeyRing {
  if (!env.DATA_ENCRYPTION_KEY) throw new DataKeySourceError("misconfigured");
  const ring: DataKeyRing = {
    current: { version: env.DATA_ENCRYPTION_KEY_VERSION ?? 1, ikm: Buffer.from(env.DATA_ENCRYPTION_KEY, "utf8") },
  };
  if (env.DATA_ENCRYPTION_PREVIOUS_KEY && env.DATA_ENCRYPTION_PREVIOUS_KEY_VERSION !== undefined) {
    ring.previous = {
      version: env.DATA_ENCRYPTION_PREVIOUS_KEY_VERSION,
      ikm: Buffer.from(env.DATA_ENCRYPTION_PREVIOUS_KEY, "utf8"),
    };
  }
  return ring;
}

export function createDevEnvDataKeySource(env?: DevEnv): DataKeySource {
  return { load: async () => loadDevEnvKeys(env) };
}
