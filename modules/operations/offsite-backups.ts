import type { BackupObject } from "@/integrations/backups/types";

/**
 * Whether the production backups xCloud writes to Cloudflare R2 are fresh (#1412). Pure: the reader lists the
 * bucket, this decides which objects are database dumps and which are file archives, and how old the newest is.
 *
 * What leaves this file is a time, a size and a safe label ("Database dump (.sql.gz)"). Never an object key, bucket,
 * prefix, account id or host.
 */

/** A nightly job plus two hours of slack. */
export const DATABASE_BACKUP_STALE_AFTER_MS = 26 * 60 * 60 * 1000;

export const DEFAULT_DATABASE_PATTERNS = ["*.sql", "*.sql.gz", "*.sql.zst", "*.dump", "*.dump.gz"] as const;
export const DEFAULT_FILES_PATTERNS = ["*.tar", "*.tar.gz", "*.tgz", "*.zip", "*.tar.zst"] as const;

export type OffsiteBackupEntry = {
  /** ISO time the object was last modified in R2. */
  at: string;
  bytes: number | null;
  /** Kind plus matched extension only. */
  label: string;
};

export type OffsiteBackupResult =
  | { state: "not_connected" }
  | { state: "misconfigured"; missing: string[]; invalid: string[] }
  | { state: "error"; reason: string; checkedAt: string }
  | {
      state: "checked";
      database: OffsiteBackupEntry | null;
      files: OffsiteBackupEntry | null;
      /** The listing was cut short, so a newer object may exist. */
      partial: boolean;
      checkedAt: string;
    };

export type OffsiteDatabaseStatus = "ok" | "stale" | "missing";

type CompiledPattern = { regex: RegExp; extension: string | null };

/** Comma-separated case-insensitive globs where `*` is the only wildcard. Blank falls back to the defaults. */
export function compileNamePatterns(csv: string | undefined, defaults: readonly string[]): CompiledPattern[] {
  const parts = (csv ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const globs = parts.length > 0 ? parts : [...defaults];
  return globs.map((glob) => {
    const source = glob
      .split("*")
      .map((piece) => piece.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
      .join(".*");
    // The label shows the literal tail after the last `*` only when it looks like a plain extension.
    const tail = glob.slice(glob.lastIndexOf("*") + 1).toLowerCase();
    const extension = glob.includes("*") && /^\.[a-z0-9]+(?:\.[a-z0-9]+){0,2}$/.test(tail) ? tail : null;
    return { regex: new RegExp(`^${source}$`, "i"), extension };
  });
}

function fileNameOf(key: string) {
  return key.slice(key.lastIndexOf("/") + 1);
}

function matchExtension(name: string, patterns: CompiledPattern[]): { extension: string | null } | null {
  if (!name) return null;
  const hit = patterns.find((pattern) => pattern.regex.test(name));
  return hit ? { extension: hit.extension } : null;
}

export type AssessmentInput = {
  objects: readonly BackupObject[];
  databasePatterns?: string;
  filesPatterns?: string;
  partial: boolean;
  now: Date;
};

export function assessOffsiteBackups(input: AssessmentInput): Extract<OffsiteBackupResult, { state: "checked" }> {
  const databasePatterns = compileNamePatterns(input.databasePatterns, DEFAULT_DATABASE_PATTERNS);
  const filesPatterns = compileNamePatterns(input.filesPatterns, DEFAULT_FILES_PATTERNS);

  let database: { object: BackupObject; extension: string | null } | null = null;
  let files: { object: BackupObject; extension: string | null } | null = null;
  for (const object of input.objects) {
    const name = fileNameOf(object.key);
    // Database patterns first, so a name both lists would match counts once, as a database dump.
    const asDatabase = matchExtension(name, databasePatterns);
    if (asDatabase) {
      if (!database || object.lastModified > database.object.lastModified) database = { object, extension: asDatabase.extension };
      continue;
    }
    const asFiles = matchExtension(name, filesPatterns);
    if (asFiles && (!files || object.lastModified > files.object.lastModified)) files = { object, extension: asFiles.extension };
  }

  const entry = (found: typeof database, kind: string): OffsiteBackupEntry | null =>
    found
      ? {
          at: found.object.lastModified.toISOString(),
          bytes: found.object.size,
          label: found.extension ? `${kind} (${found.extension})` : kind,
        }
      : null;

  return {
    state: "checked",
    database: entry(database, "Database dump"),
    files: entry(files, "Files archive"),
    partial: input.partial,
    checkedAt: input.now.toISOString(),
  };
}

/** `null` unless the answer is a completed listing. */
export function offsiteDatabaseStatus(result: OffsiteBackupResult, now: Date): OffsiteDatabaseStatus | null {
  if (result.state !== "checked") return null;
  if (!result.database) return "missing";
  const age = now.getTime() - Date.parse(result.database.at);
  return age > DATABASE_BACKUP_STALE_AFTER_MS ? "stale" : "ok";
}

/** B, KB, MB or GB, one decimal from MB up. */
export function formatBackupSize(bytes: number | null): string {
  if (bytes === null) return "size not reported";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** "2026-10-31 03:12 UTC". */
export function formatBackupTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
