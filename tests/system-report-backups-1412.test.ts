import { describe, expect, it } from "vitest";
import { offsiteBackupFields, OFFSITE_NOT_CONNECTED_TEXT } from "@/modules/system-admin/system-report/backup-signals";
import type { OffsiteBackupResult } from "@/modules/operations/offsite-backups";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const checked = (over: Partial<Extract<OffsiteBackupResult, { state: "checked" }>> = {}): OffsiteBackupResult => ({
  state: "checked",
  database: { at: "2026-10-31T03:12:00.000Z", bytes: 4 * 1024 ** 2, label: "Database dump (.sql.gz)" },
  files: { at: "2026-10-31T03:20:00.000Z", bytes: 2 * 1024 ** 3, label: "Files archive (.tar.gz)" },
  partial: false,
  scanned: 10,
  checkedAt: NOW.toISOString(),
  ...over,
});

describe("System report R2 backup rows (#1412)", () => {
  it("says exactly the not-connected text with a neutral state", () => {
    const [database, files] = offsiteBackupFields({ state: "not_connected" }, NOW);
    expect(OFFSITE_NOT_CONNECTED_TEXT).toBe("Backups are managed outside the app; connect read-only R2 to check them.");
    for (const row of [database, files]) {
      expect(row.state).toBe("info");
      expect(row.resultText).toBe(OFFSITE_NOT_CONNECTED_TEXT);
    }
    expect([database.key, files.key]).toEqual(["backup-r2-database", "backup-r2-files"]);
  });

  it("shows a fresh database backup as ok with time and size, and files as info", () => {
    const [database, files] = offsiteBackupFields(checked(), NOW);
    expect(database).toMatchObject({ state: "ok", checkedAt: "2026-10-31T03:12:00.000Z" });
    expect(database.resultText).toContain("2026-10-31 03:12 UTC, 4.0 MB");
    expect(files.state).toBe("info");
    expect(files.resultText).toContain("2.0 GB");
  });

  it("needs attention for a stale or missing database, never for files", () => {
    const stale = offsiteBackupFields(checked({ database: { at: "2026-10-29T03:00:00.000Z", bytes: 1, label: "Database dump (.sql)" } }), NOW);
    expect(stale[0].state).toBe("attention");
    expect(stale[0].resultText).toContain("more than 26 hours old");
    const none = offsiteBackupFields(checked({ database: null, files: null }), NOW);
    expect(none[0]).toMatchObject({ state: "attention" });
    expect(none[0].resultText).toContain("No database backup was found");
    expect(none[1]).toMatchObject({ state: "info" });
    expect(none[1].resultText).toContain("None found");
  });

  it("is watch, not attention, when the listing was cut short and nothing fresh was seen", () => {
    for (const database of [null, { at: "2026-10-29T03:00:00.000Z", bytes: 1, label: "Database dump (.sql)" }]) {
      const [row] = offsiteBackupFields(checked({ database, partial: true, scanned: 10000 }), NOW);
      expect(row.state).toBe("watch");
      expect(row.resultText).toContain("cut short after 10000 objects");
      expect(row.resultText).toContain("BACKUP_R2_READ_PREFIX");
    }
    expect(offsiteBackupFields(checked({ partial: true }), NOW)[0].state).toBe("ok");
  });

  it("is unavailable on an error or incomplete settings, naming variables only", () => {
    const error = offsiteBackupFields({ state: "error", reason: "timed out", checkedAt: NOW.toISOString() }, NOW);
    expect(error[0].state).toBe("unavailable");
    expect(error[0].resultText).toContain("timed out");
    const bad = offsiteBackupFields({ state: "misconfigured", missing: ["BACKUP_R2_READ_BUCKET"], invalid: ["BACKUP_R2_READ_ACCOUNT_ID"] }, NOW);
    expect(bad[0].state).toBe("unavailable");
    expect(bad[0].resultText).toContain("BACKUP_R2_READ_BUCKET is missing");
    expect(bad[0].resultText).toContain("BACKUP_R2_READ_ACCOUNT_ID is not valid");
    expect(offsiteBackupFields(null, NOW)[0].state).toBe("unavailable");
  });

  it("never shows a key, bucket or prefix", () => {
    const text = JSON.stringify(offsiteBackupFields(checked(), NOW));
    expect(text).not.toMatch(/r2\.cloudflarestorage|s3:\/\//);
  });
});
