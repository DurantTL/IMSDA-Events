/**
 * Key health check (#1516): read-only. Reports whether the encryption key is
 * configured and valid, and for every sealed column how many values are sealed
 * with the current key version, with an older one, or cannot be opened at all.
 * It opens each value to prove it, and prints counts only: never a value, a
 * purpose, an id or a key.
 *
 * Exits 1 when the key is missing or invalid, any value is unreadable, or any
 * value is still on an older key version. Exit 0 means every value opens with
 * the current key.
 *
 *   npm run key:check
 */
import { loadEnvConfig } from "@next/env";
import { getEncryptionKeyStatus, validateServerEnv } from "../lib/env";

/** The error class (and a Prisma error code) only: never message text, which could include a value. */
export function describeError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const name = error instanceof Error ? error.name : "unknown error";
  return typeof code === "string" ? `${name} ${code}` : name;
}

export type KeyLog = { log: (line: string) => void; error: (line: string) => void };

/**
 * The key-related reasons the environment can't be used, plus every other
 * environment issue (they name a variable and a rule, never a value). Empty
 * when the server environment loads.
 */
export function environmentProblems(env: Record<string, string | undefined>) {
  const status = getEncryptionKeyStatus(env);
  const result = validateServerEnv(env);
  const issues = result.ok ? [] : result.issues;
  if (!status.configured && !issues.some((issue) => issue.startsWith("SECRET_ENCRYPTION_KEY"))) {
    issues.unshift("SECRET_ENCRYPTION_KEY (or SECRET_ENCRYPTION_KEY_FILE) is not set");
  }
  return issues;
}

export async function runKeyCheck(options: KeyLog & { env: Record<string, string | undefined> }): Promise<number> {
  const problems = environmentProblems(options.env);
  if (problems.length > 0) {
    for (const problem of problems) options.error(`[key-check] ${problem}`);
    options.error("[key-check] FAILED: the encryption key configuration is not usable.");
    return 1;
  }
  const { scanSealedColumns } = await import("../modules/security/key-rotation");
  const { createPrismaSealedColumnStore, countDetachedCalendarFingerprints } = await import("../modules/security/sealed-column-store");
  const { currentSecretKeyVersion, previousSecretKeyVersion } = await import("../lib/secret-box");

  const previous = previousSecretKeyVersion();
  options.log(
    `[key-check] current key version ${currentSecretKeyVersion()}; previous key ${previous === null ? "not loaded" : `loaded (version ${previous})`}`,
  );
  const scans = await scanSealedColumns(createPrismaSealedColumnStore());
  let unreadable = 0;
  let older = 0;
  for (const scan of scans) {
    unreadable += scan.unreadable;
    older += scan.older;
    options.log(
      `[key-check] ${scan.label}: ${scan.total} total, ${scan.current} current, ${scan.older} older, ${scan.unreadable} unreadable`,
    );
  }
  const detached = await countDetachedCalendarFingerprints();
  if (detached > 0) {
    options.log(
      `[key-check] note: ${detached} calendar item(s) left by deleted feeds carry a fingerprint no current feed has. They can't be re-fingerprinted; they will not relink to an identical re-added feed once the previous key is removed. Not a failure.`,
    );
  }
  if (unreadable > 0) options.error(`[key-check] FAILED: ${unreadable} value(s) cannot be opened with the loaded keys.`);
  if (older > 0) options.error(`[key-check] FAILED: ${older} value(s) are still sealed with an older key version. Run npm run key:rotate.`);
  if (unreadable > 0 || older > 0) return 1;
  options.log("[key-check] PASSED: every sealed value opens with the current key.");
  return 0;
}

if (process.argv[1]?.endsWith("key-check.ts")) {
  loadEnvConfig(process.cwd());
  runKeyCheck({
    env: process.env,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  })
    .catch((error: unknown) => {
      console.error(`[key-check] FAILED: unexpected error (${describeError(error)}; details withheld)`);
      return 1;
    })
    .then((code) => process.exit(code));
}
