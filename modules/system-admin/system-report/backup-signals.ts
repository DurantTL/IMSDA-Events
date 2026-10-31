import {
  formatBackupSize,
  formatBackupTime,
  offsiteDatabaseStatus,
  type OffsiteBackupEntry,
  type OffsiteBackupResult,
} from "@/modules/operations/offsite-backups";
import type { SignalState } from "./model";

/**
 * The two System report rows for the production backups in Cloudflare R2 (#1412). Pure: a time, a size, a state and
 * words. No key, bucket, prefix, account id or host reaches a row; only the environment variable NAMES that are
 * missing when the settings are incomplete.
 */

export const OFFSITE_NOT_CONNECTED_TEXT = "Backups are managed outside the app; connect read-only R2 to check them.";

type Fields = {
  key: string;
  state: SignalState;
  resultText: string;
  checkedAt: string;
  whenLabel: string;
};

const CUT_SHORT = " The listing was cut short, so a newer file may exist.";

function describe(entry: OffsiteBackupEntry) {
  return `${formatBackupTime(entry.at)}, ${formatBackupSize(entry.bytes)}`;
}

export function offsiteBackupFields(result: OffsiteBackupResult | null, now: Date): [Fields, Fields] {
  const databaseKey = "backup-r2-database";
  const filesKey = "backup-r2-files";
  const readAt = now.toISOString();

  if (result === null) {
    const unread = (key: string): Fields => ({
      key,
      state: "unavailable",
      resultText: "This could not be read just now. It is not shown as healthy or as zero.",
      checkedAt: readAt,
      whenLabel: "Tried",
    });
    return [unread(databaseKey), unread(filesKey)];
  }

  if (result.state === "not_connected") {
    const neutral = (key: string): Fields => ({ key, state: "info", resultText: OFFSITE_NOT_CONNECTED_TEXT, checkedAt: readAt, whenLabel: "Checked" });
    return [neutral(databaseKey), neutral(filesKey)];
  }

  if (result.state === "misconfigured") {
    const names = [...result.missing.map((name) => `${name} is missing`), ...result.invalid.map((name) => `${name} is not valid`)];
    const text = `The read-only R2 settings are incomplete: ${names.join("; ")}.`;
    const row = (key: string): Fields => ({ key, state: "unavailable", resultText: text, checkedAt: readAt, whenLabel: "Tried" });
    return [row(databaseKey), row(filesKey)];
  }

  if (result.state === "error") {
    const text = `R2 could not be read just now (${result.reason}). The backups are not shown as healthy or as missing.`;
    const row = (key: string): Fields => ({ key, state: "unavailable", resultText: text, checkedAt: result.checkedAt, whenLabel: "Tried" });
    return [row(databaseKey), row(filesKey)];
  }

  const cut = result.partial ? CUT_SHORT : "";
  const status = offsiteDatabaseStatus(result, now);
  const database: Fields = result.database
    ? {
        key: databaseKey,
        state: status === "ok" ? "ok" : "attention",
        resultText: status === "ok"
          ? `${describe(result.database)}. ${result.database.label}.${cut}`
          : `${describe(result.database)}. ${result.database.label}. That is more than 26 hours old.${cut}`,
        checkedAt: result.database.at,
        whenLabel: "Backup made",
      }
    : {
        key: databaseKey,
        state: "attention",
        resultText: `No database backup was found in R2.${cut}`,
        checkedAt: result.checkedAt,
        whenLabel: "Checked",
      };
  // The files archive is informational: no staleness warning.
  const files: Fields = result.files
    ? { key: filesKey, state: "info", resultText: `${describe(result.files)}. ${result.files.label}.${cut}`, checkedAt: result.files.at, whenLabel: "Backup made" }
    : { key: filesKey, state: "info", resultText: `None found.${cut}`, checkedAt: result.checkedAt, whenLabel: "Checked" };
  return [database, files];
}
