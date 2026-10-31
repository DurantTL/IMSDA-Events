import type { SweepHeartbeat } from "@/modules/operations/sweep-heartbeat";
import type { BackupEvidence } from "./readiness-backup";
import { backupHelperHasReported } from "@/modules/operations/backup-status";
import { BACKUP_ITEM_KEYS } from "./readiness-items";

/**
 * The automatic half of the System readiness page (#870). Pure: the repository gathers the facts, this turns them
 * into rows. A fact is only ever a count, a yes/no, a date or a name of a staff account. Nothing here receives a key,
 * a token, an address or a connection string, so there is nothing to leak.
 */

export type AutomaticStatus = "ok" | "attention" | "info" | "unknown";

export type AutomaticReadinessRow = {
  key: string;
  title: string;
  status: AutomaticStatus;
  summary: string;
  /** Staff names to act on, such as administrators without MFA. */
  people: string[];
};

export type ReadinessFacts = {
  admins: Array<{ displayName: string; hasMfaOrPasskey: boolean }> | null;
  /** Migration folders on disk that the database has not finished applying; `null` when it could not be read. */
  pendingMigrations: string[] | null;
  sweep: SweepHeartbeat | null;
  encryptionKeyConfigured: boolean;
  email: {
    deliveryConfigured: boolean;
    senderConfigured: boolean;
    /** False when the platform settings could not be read, so the sender is unknown rather than missing. */
    senderReadable: boolean;
    /** False for a placeholder such as example.org, which cannot send or receive real mail. */
    senderDeliverable: boolean;
  };
  square: { environment: "sandbox" | "production"; productionUnlocked: boolean };
  backup: BackupEvidence;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function age(from: Date, now: Date) {
  const days = Math.floor((now.getTime() - from.getTime()) / DAY_MS);
  if (days < 1) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function sweepRow(sweep: SweepHeartbeat | null): AutomaticReadinessRow {
  const base = { key: "outbox-sweeper", title: "Email queue sweeper is running", people: [] as string[] };
  if (!sweep) return { ...base, status: "unknown", summary: "The sweeper status could not be read." };
  if (sweep.status === "ok") return { ...base, status: "ok", summary: "The sweeper ran successfully in the last 15 minutes." };
  if (sweep.status === "never") return { ...base, status: "attention", summary: "The sweeper has never reported. Check that the scheduled job is calling it." };
  if (sweep.status === "failing") return { ...base, status: "attention", summary: "The latest sweeper run failed." };
  return { ...base, status: "attention", summary: "The sweeper has not succeeded in over 15 minutes." };
}

export type MigrationRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };

/**
 * A shipped migration is applied only if some row for it finished and was not rolled back. A failed row
 * (`finished_at` null) or a rolled-back one leaves it pending; a rolled-back row followed by a fresh finished row
 * (re-applied) counts as applied.
 */
export function pendingMigrationNames(shipped: readonly string[], rows: readonly MigrationRow[]): string[] {
  const done = new Set(rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null).map((row) => row.migration_name));
  return shipped.filter((name) => !done.has(name)).sort();
}

/**
 * The two backup rows, from the same assessment `/api/health` uses (`assessBackupStatus`), so the two never
 * disagree. Dates and yes/no only. A backup that has never run is attention, not ok. When the backup log could not
 * be read the rows say so ("unknown") and the manual ticks stay visible (unreadable is not evidence).
 */
export function evaluateBackupItems(backup: BackupEvidence, now: Date): AutomaticReadinessRow[] {
  if (!backup.readable) {
    return [
      { key: "backup-offsite", title: "Last successful backup", status: "unknown", summary: "The backup log could not be read.", people: [] },
      { key: "restore-rehearsal", title: "Last restore test", status: "unknown", summary: "The backup log could not be read.", people: [] },
    ];
  }
  const s = backup.status;
  // Production backups are made by xCloud outside the app (#1412). A helper that never wrote a run or a restore test
  // is not in use; that is neither stale nor failing. One that has reported keeps the logic below.
  if (!backupHelperHasReported(s)) {
    const notInUse = "The app's own backup helper has not reported, so it is not in use. Production backups are made outside the app.";
    return [
      { key: "backup-offsite", title: "Last successful backup", status: "info", summary: notInUse, people: [] },
      { key: "restore-rehearsal", title: "Last restore test", status: "info", summary: notInUse, people: [] },
    ];
  }
  const day = (iso: string) => iso.slice(0, 10);
  const when = (iso: string) => `${day(iso)} (${age(new Date(iso), now)})`;

  let backupSummary: string;
  if (!s.lastSuccessAt) {
    backupSummary = s.status === "never" ? "No backup has run yet." : "No successful backup is recorded.";
  } else {
    backupSummary = `Last successful backup ${when(s.lastSuccessAt)}.`;
    if (s.stale) backupSummary += " That is overdue.";
  }
  if (s.lastRunOk === false) backupSummary += " The latest run failed.";
  let neverOffsite = false;
  if (s.lastSuccessAt) {
    const offsite = s.offsiteOk === true ? "yes" : s.offsiteOk === false ? "no" : "not recorded";
    backupSummary += ` Latest run reached the offsite copy: ${offsite}.`;
    if (s.offsiteStopped && s.lastOffsiteSuccessAt) {
      backupSummary += ` Offsite copies have stopped (last ${day(s.lastOffsiteSuccessAt)}).`;
    }
    if (s.offsiteOk === null && !s.lastOffsiteSuccessAt) {
      neverOffsite = true;
      backupSummary += " No offsite copy has been recorded.";
    }
  }
  const backupAttention = s.status !== "ok" || s.stale || s.lastRunOk === false || s.offsiteOk === false || s.offsiteStopped || neverOffsite;

  let restoreSummary: string;
  if (!s.lastRehearsalSuccessAt) {
    restoreSummary = s.lastRehearsalAt ? "No successful restore test is recorded." : "No restore test has run yet.";
  } else {
    restoreSummary = `Last successful restore test ${when(s.lastRehearsalSuccessAt)}.`;
    if (s.rehearsalOverdue) restoreSummary += " That is overdue.";
  }
  if (s.lastRehearsalOk === false) restoreSummary += " The latest restore test failed.";
  const restoreAttention = !s.lastRehearsalSuccessAt || s.rehearsalOverdue || s.lastRehearsalOk === false;

  return [
    { key: "backup-offsite", title: "Last successful backup", status: backupAttention ? "attention" : "ok", summary: backupSummary, people: [] },
    { key: "restore-rehearsal", title: "Last restore test", status: restoreAttention ? "attention" : "ok", summary: restoreSummary, people: [] },
  ];
}

export function evaluateAutomaticChecks(facts: ReadinessFacts, now: Date): AutomaticReadinessRow[] {
  const rows: AutomaticReadinessRow[] = [];

  if (!facts.admins) {
    rows.push({ key: "admins-mfa", title: "Every system administrator has MFA or a passkey", status: "unknown", summary: "The administrator list could not be read.", people: [] });
  } else {
    const without = facts.admins.filter((admin) => !admin.hasMfaOrPasskey).map((admin) => admin.displayName).sort();
    const total = facts.admins.length;
    rows.push({
      key: "admins-mfa",
      title: "Every system administrator has MFA or a passkey",
      status: total === 0 ? "attention" : without.length === 0 ? "ok" : "attention",
      summary: total === 0
        ? "No active system administrators were found."
        : without.length === 0
          ? `All ${total} active system ${total === 1 ? "administrator has" : "administrators have"} MFA or a passkey.`
          : `${total - without.length} of ${total} active system administrators have MFA or a passkey.`,
      people: without,
    });
  }

  if (facts.pendingMigrations === null) {
    rows.push({ key: "migrations", title: "No database migrations are pending", status: "unknown", summary: "Migration status could not be read.", people: [] });
  } else {
    const count = facts.pendingMigrations.length;
    rows.push({
      key: "migrations",
      title: "No database migrations are pending",
      status: count === 0 ? "ok" : "attention",
      summary: count === 0 ? "The database has every migration this release ships." : `${count} migration${count === 1 ? " is" : "s are"} not applied yet.`,
      people: [],
    });
  }

  rows.push(sweepRow(facts.sweep));

  rows.push({
    key: "encryption-key",
    title: "Encryption key is configured",
    status: facts.encryptionKeyConfigured ? "ok" : "attention",
    summary: facts.encryptionKeyConfigured ? "Yes. The value is never shown." : "No. Set it on the server before anyone enrols in MFA or birth dates are stored.",
    people: [],
  });

  const { email } = facts;
  rows.push({
    key: "email-provider",
    title: "Email provider is configured",
    status: email.deliveryConfigured ? "ok" : "attention",
    summary: email.deliveryConfigured ? "Yes." : "No. Event email is captured locally and nothing is sent.",
    people: [],
  });
  rows.push({
    key: "email-sender",
    title: "Sender address is a real, deliverable address",
    status: !email.senderReadable && !email.senderConfigured
      ? "unknown"
      : email.senderConfigured && email.senderDeliverable ? "ok" : "attention",
    summary: !email.senderReadable && !email.senderConfigured
      ? "The sender settings could not be read."
      : !email.senderConfigured
        ? "No sender address is set."
        : email.senderDeliverable
          ? "A sender address is set and is not a placeholder. The app cannot check the provider's domain verification itself, so confirm that with the provider."
          : "The sender address is a placeholder domain that cannot send real mail.",
    people: [],
  });

  const unlock = `Production unlock: ${facts.square.productionUnlocked ? "on" : "off"}.`;
  rows.push({
    key: "square-environment",
    title: "Square environment",
    status: "info",
    summary: facts.square.environment === "production"
      ? facts.square.productionUnlocked
        ? `Production. ${unlock}`
        : `Production is selected but not unlocked, so card payments stay blocked. ${unlock}`
      : `Sandbox. ${unlock}`,
    people: [],
  });

  rows.push(...evaluateBackupItems(facts.backup, now));
  return rows;
}

/** Manual items that an automatic row has taken over, so they are not listed twice. */
/** Manual backup items are hidden only when the log was actually read. */
export function automaticBackupKeys(backup: BackupEvidence): ReadonlySet<string> {
  return new Set<string>(backup.readable ? BACKUP_ITEM_KEYS : []);
}
