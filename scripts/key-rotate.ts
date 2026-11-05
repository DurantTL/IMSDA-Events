/**
 * Re-seals every sealed value with the current encryption key (#1516).
 *
 * Needs both keys loaded: the current one (SECRET_ENCRYPTION_KEY or _FILE, at
 * SECRET_ENCRYPTION_KEY_VERSION) and the previous one (SECRET_ENCRYPTION_PREVIOUS_KEY
 * or _FILE, at SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION), with the current
 * version higher. Without --apply it is a dry run and writes nothing. With
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
import { environmentProblems, type KeyLog } from "./key-check";

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
  if (!status.previousKeyLoaded || status.previousVersion === null || status.version === null) {
    return fail(
      "both keys must be loaded. Set SECRET_ENCRYPTION_PREVIOUS_KEY_FILE (the old key) with SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION, and SECRET_ENCRYPTION_KEY_FILE (the new key) with SECRET_ENCRYPTION_KEY_VERSION. See docs/DEPLOY-DOCKER.md.",
    );
  }
  if (status.version <= status.previousVersion) {
    return fail("SECRET_ENCRYPTION_KEY_VERSION must be higher than SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION.");
  }

  const { rotateSealedColumns } = await import("../modules/security/key-rotation");
  const { createPrismaSealedColumnStore } = await import("../modules/security/sealed-column-store");
  options.log(
    `[key-rotate] ${options.apply ? "APPLY" : "DRY RUN (nothing is written)"}: key version ${status.previousVersion} to ${status.version}`,
  );
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
        : `[key-rotate] ${result.label}: ${result.wouldRotate} to rotate, ${result.alreadyCurrent} already current, ${result.unreadable} unreadable`,
    );
  }
  if (unreadable > 0) options.error(`[key-rotate] ${unreadable} value(s) could not be opened and were left as they are.`);
  if (skipped > 0) options.error(`[key-rotate] ${skipped} value(s) changed while rotating or could not be written. Run it again.`);
  if (!options.apply) {
    options.log(`[key-rotate] ${remaining} value(s) would be re-sealed. Run with --apply to do it.`);
    return unreadable > 0 ? 1 : 0;
  }
  if (unreadable > 0 || skipped > 0) return 1;
  options.log("[key-rotate] DONE: nothing is left on an older key version.");
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
    .catch(() => {
      console.error("[key-rotate] FAILED: unexpected error (details withheld)");
      return 1;
    })
    .then((code) => process.exit(code));
}
