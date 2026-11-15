/**
 * Re-seals every sealed value with the current key of its own column (#1516,
 * #1652). Three jobs, each needing its keys loaded:
 *
 *  - Rotating the sign-in key: the current one (SECRET_ENCRYPTION_KEY or _FILE,
 *    at SECRET_ENCRYPTION_KEY_VERSION) and the previous one
 *    (SECRET_ENCRYPTION_PREVIOUS_KEY or _FILE, at
 *    SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION), with the current version higher.
 *  - The one-time move of personal data to the data key: DATA_KEY_SOURCE set and
 *    the data key loaded. Personal-data values still on the sign-in key are
 *    re-sealed with the data key (and their fingerprints recomputed).
 *  - Rotating the data key: the current and the previous data key loaded.
 *
 * Refuses --apply when the data key is configured but not loaded. Without --apply it is a dry run and writes nothing. With
 * --apply, values already on the current version are skipped, so a run that
 * stopped part way is finished by running it again, and a rerun after
 * completion changes nothing. A value that changed between being read and
 * being written is left for the next run. A value that cannot be opened is
 * counted, never printed, and does not stop the run.
 *
 * Output is counts per column. Exit 1 if the configuration is wrong, or any
 * value was unreadable or left behind.
 *
 * Running this against production is a human step (docs/DEPLOY-DOCKER.md).
 *
 *   npm run key:rotate              # dry run
 *   npm run key:rotate -- --apply
 */
import { loadEnvConfig } from "@next/env";
import { getEncryptionKeyStatus } from "../lib/env";
import { dataKeyLine, describeError, environmentProblems, type KeyLog } from "./key-check";

export async function runKeyRotate(
  options: KeyLog & { env: Record<string, string | undefined>; apply: boolean },
): Promise<number> {
  const fail = (message: string) => {
    options.error(`[key-rotate] FAILED: ${message}`);
    return 1;
  };
  const problems = environmentProblems(options.env);
  if (problems.length > 0) {
    for (const problem of problems) options.error(`[key-rotate] ${problem}`);
    return fail("the encryption key configuration is not usable.");
  }
  const status = getEncryptionKeyStatus(options.env);
  const { dataKeyStatus } = await import("../lib/secret-box");
  const { ensureDataKeyLoaded } = await import("../lib/data-key/keyring");
  await ensureDataKeyLoaded();
  const data = dataKeyStatus();
  const dataKeySeparate = data.mode !== "not-separate";
  const signInRotation = status.previousKeyLoaded && status.previousVersion !== null && status.version !== null;
  if (!signInRotation && !dataKeySeparate) {
    return fail(
      "both keys must be loaded. Set SECRET_ENCRYPTION_PREVIOUS_KEY_FILE (the old key) with SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION, and SECRET_ENCRYPTION_KEY_FILE (the new key) with SECRET_ENCRYPTION_KEY_VERSION. To move personal data to the separate data key instead, set DATA_KEY_SOURCE. See docs/DEPLOY-DOCKER.md and docs/DATA-KEY-AZURE-KEY-VAULT.md.",
    );
  }
  if (signInRotation && status.version !== null && status.previousVersion !== null && status.version <= status.previousVersion) {
    return fail("SECRET_ENCRYPTION_KEY_VERSION must be higher than SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION.");
  }
  if (options.apply && dataKeySeparate && data.state === "ready" && data.previousProblem) {
    return fail("the previous personal-data key is configured but could not be loaded, so values on it can't be read or rotated. Fix the key vault access or the previous wrapped key first (docs/DATA-KEY-AZURE-KEY-VAULT.md).");
  }
  if (options.apply && dataKeySeparate && data.state !== "ready") {
    return fail("the personal-data key is configured but could not be loaded, so personal data can't be moved or rotated. Fix the key vault access first (docs/DATA-KEY-AZURE-KEY-VAULT.md).");
  }

  const { rotateSealedColumns } = await import("../modules/security/key-rotation");
  const { createPrismaSealedColumnStore } = await import("../modules/security/sealed-column-store");
  options.log(`[key-rotate] ${options.apply ? "APPLY" : "DRY RUN (nothing is written)"}`);
  options.log(
    `[key-rotate] sign-in key: ${signInRotation ? `version ${status.previousVersion} to ${status.version}` : `version ${status.version ?? "unknown"}, no rotation`}`,
  );
  options.log(`[key-rotate] data key: ${dataKeyLine(data)}`);
  const results = await rotateSealedColumns(createPrismaSealedColumnStore(), { apply: options.apply });
  let unreadable = 0;
  let skipped = 0;
  let remaining = 0;
  for (const result of results) {
    unreadable += result.unreadable;
    skipped += result.skipped;
    remaining += result.wouldRotate;
    options.log(
      options.apply
        ? `[key-rotate] ${result.label}: ${result.rotated} rotated, ${result.alreadyCurrent} already current, ${result.unreadable} unreadable, ${result.skipped} skipped`
        : `[key-rotate] ${result.label}: ${result.wouldRotate} to rotate, ${result.alreadyCurrent} already current, ${result.unreadable} unreadable`
          + (result.onSignInKey > 0 ? `, ${result.onSignInKey} not moved to the data key yet` : ""),
    );
  }
  if (unreadable > 0) options.error(`[key-rotate] ${unreadable} value(s) could not be opened and were left as they are.`);
  if (skipped > 0) options.error(`[key-rotate] ${skipped} value(s) changed while rotating or could not be written. Run it again.`);
  if (!options.apply) {
    options.log(`[key-rotate] ${remaining} value(s) would be re-sealed. Run with --apply to do it.`);
    return unreadable > 0 ? 1 : 0;
  }
  if (unreadable > 0 || skipped > 0) return 1;
  options.log("[key-rotate] DONE: nothing is left on an older key version. Run npm run key:check.");
  return 0;
}

if (process.argv[1]?.endsWith("key-rotate.ts")) {
  loadEnvConfig(process.cwd());
  runKeyRotate({
    env: process.env,
    apply: process.argv.includes("--apply"),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  })
    .catch((error: unknown) => {
      console.error(`[key-rotate] FAILED: unexpected error (${describeError(error)}; details withheld)`);
      return 1;
    })
    .then((code) => process.exit(code));
}
