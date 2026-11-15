import { dataKeyMode } from "@/lib/data-key/keyring";
import {
  currentDataKeyVersion,
  currentSecretKeyVersion,
  DataKeyUnavailableError,
  dataSealedKeyring,
  fingerprintData,
  fingerprintSecret,
  isDataKeyUnavailable,
  openData,
  openSecret,
  sealData,
  sealSecret,
  sealedDataKeyVersion,
  sealedKeyVersion,
} from "@/lib/secret-box";
import { SEALED_COLUMNS, type SealedColumn, type SealedRowFields } from "@/modules/security/sealed-columns";

/**
 * Key rotation and the key health check (#1516, #1652), over the registry in
 * `sealed-columns.ts`. Each column is looked at against its own key, the sign-in
 * key or the personal-data key (`column.keyring`). While the personal-data key
 * is separate, a personal-data value still sealed with the sign-in key counts as
 * older (and in `onSignInKey`) and rotation moves it to the data key. Both walk each column in id order in batches and look at
 * every value the same way, so what `key:check` reports is what `key:rotate`
 * works on. Nothing here prints, logs or returns a value, a purpose or a key:
 * only counts.
 *
 * Running a rotation against production is a human step
 * (docs/DEPLOY-DOCKER.md, "Rotating the encryption key").
 */

export const DEFAULT_BATCH_SIZE = 200;

export type SealedRow = {
  id: string;
  /** The sealed value as stored. */
  value: string;
  /** The row's other columns the registry asked for (`id`, purpose columns, the fingerprint, `preserve` columns). */
  fields: SealedRowFields;
};

/** What the scan and the rotation need from the database. The Prisma version is `sealed-column-store.ts`. */
export interface SealedColumnStore {
  /** Up to `take` rows with a sealed value and an id greater than `afterId`, in id order. */
  readBatch(column: SealedColumn, afterId: string | null, take: number): Promise<SealedRow[]>;
  /**
   * Compare-and-set: writes `next` only if the row still holds `row.value`. Returns false when it
   * changed (or went away) in the meantime, in which case nothing was written.
   */
  replace(column: SealedColumn, row: SealedRow, next: { value: string; fingerprint?: string }): Promise<boolean>;
}

export type ColumnScan = {
  label: string;
  total: number;
  /** Readable and sealed with the current key version. */
  current: number;
  /** Readable and sealed with an older key version (for a personal-data column, including values still on the sign-in key). */
  older: number;
  /** Personal-data columns only: values still sealed with the sign-in key, not moved to the data key yet. Part of `older`. */
  onSignInKey: number;
  /** Could not be opened with the loaded keys (including a version that is not loaded). */
  unreadable: number;
};

export type ColumnRotation = {
  label: string;
  total: number;
  alreadyCurrent: number;
  /** Personal-data columns only: readable values found still sealed with the sign-in key (moved when applying). */
  onSignInKey: number;
  /** Dry run: readable older values that `--apply` would re-seal. */
  wouldRotate: number;
  rotated: number;
  unreadable: number;
  /** Changed by someone else between reading and writing; left for the next run. */
  skipped: number;
};

type Classified =
  | { kind: "current" | "older"; version: number; plaintext: string; onSignInKey: boolean }
  | { kind: "unreadable" };

/** The version new values of this column are sealed with, or null when its key is not loaded. */
function currentVersionFor(column: SealedColumn) {
  try {
    return column.keyring === "data" ? currentDataKeyVersion() : currentSecretKeyVersion();
  } catch (error) {
    if (error instanceof DataKeyUnavailableError) return null;
    throw error;
  }
}

function classify(column: SealedColumn, row: SealedRow, currentVersion: number | null): Classified {
  if (currentVersion === null) return { kind: "unreadable" };
  try {
    if (column.keyring === "data") {
      const onSignInKey = dataSealedKeyring(row.value) === "sign-in";
      const version = onSignInKey ? sealedKeyVersion(row.value) : sealedDataKeyVersion(row.value);
      const plaintext = openData(row.value, column.purpose(row.fields));
      // While the data key is separate, a value on the sign-in key is always older. Not separate: it is the key in use.
      const separate = dataKeyMode() !== "not-separate";
      const isCurrent = separate ? !onSignInKey && version === currentVersion : version === currentVersion;
      return { kind: isCurrent ? "current" : "older", version, plaintext, onSignInKey: separate && onSignInKey };
    }
    const version = sealedKeyVersion(row.value);
    const plaintext = openSecret(row.value, column.purpose(row.fields));
    return { kind: version === currentVersion ? "current" : "older", version, plaintext, onSignInKey: false };
  } catch {
    // Counted, never described: the reason would only repeat a purpose or a version.
    return { kind: "unreadable" };
  }
}

async function forEachRow(
  store: SealedColumnStore,
  column: SealedColumn,
  batchSize: number,
  visit: (row: SealedRow) => Promise<void>,
) {
  let after: string | null = null;
  for (;;) {
    const batch = await store.readBatch(column, after, batchSize);
    if (batch.length === 0) return;
    for (const row of batch) await visit(row);
    after = batch[batch.length - 1].id;
    if (batch.length < batchSize) return;
  }
}

/** Read-only: how many values of each column are on the current key version, on an older one, or unreadable. */
export async function scanSealedColumns(
  store: SealedColumnStore,
  options: { columns?: readonly SealedColumn[]; batchSize?: number } = {},
): Promise<ColumnScan[]> {
  const results: ColumnScan[] = [];
  for (const column of options.columns ?? SEALED_COLUMNS) {
    const currentVersion = currentVersionFor(column);
    const scan: ColumnScan = { label: column.label, total: 0, current: 0, older: 0, onSignInKey: 0, unreadable: 0 };
    await forEachRow(store, column, options.batchSize ?? DEFAULT_BATCH_SIZE, async (row) => {
      scan.total += 1;
      const result = classify(column, row, currentVersion);
      if (result.kind === "current") scan.current += 1;
      else if (result.kind === "older") {
        scan.older += 1;
        if (result.onSignInKey) scan.onSignInKey += 1;
      } else scan.unreadable += 1;
    });
    results.push(scan);
  }
  return results;
}

/**
 * Re-seals every readable value that is not on its column's current key version, with
 * that column's current key and the same purpose. Values already on the current version
 * are left alone, which is what makes a run resumable and a rerun a no-op.
 * Without `apply` nothing is written.
 */
export async function rotateSealedColumns(
  store: SealedColumnStore,
  options: { apply: boolean; columns?: readonly SealedColumn[]; batchSize?: number },
): Promise<ColumnRotation[]> {
  const columns = options.columns ?? SEALED_COLUMNS;
  // Never write a personal-data value while the data key is configured but not loaded.
  if (options.apply && columns.some((column) => column.keyring === "data") && isDataKeyUnavailable()) {
    throw new DataKeyUnavailableError();
  }
  const results: ColumnRotation[] = [];
  for (const column of columns) {
    const currentVersion = currentVersionFor(column);
    const outcome: ColumnRotation = {
      label: column.label,
      total: 0,
      alreadyCurrent: 0,
      onSignInKey: 0,
      wouldRotate: 0,
      rotated: 0,
      unreadable: 0,
      skipped: 0,
    };
    await forEachRow(store, column, options.batchSize ?? DEFAULT_BATCH_SIZE, async (row) => {
      outcome.total += 1;
      const result = classify(column, row, currentVersion);
      if (result.kind === "unreadable") {
        outcome.unreadable += 1;
        return;
      }
      if (result.kind === "current") {
        outcome.alreadyCurrent += 1;
        return;
      }
      if (result.onSignInKey) outcome.onSignInKey += 1;
      if (!options.apply) {
        outcome.wouldRotate += 1;
        return;
      }
      const next: { value: string; fingerprint?: string } = column.keyring === "data"
        ? { value: sealData(result.plaintext, column.purpose(row.fields)) }
        : { value: sealSecret(result.plaintext, column.purpose(row.fields)) };
      if (column.fingerprint) {
        next.fingerprint = column.keyring === "data"
          ? fingerprintData(result.plaintext, column.fingerprint.purpose)
          : fingerprintSecret(result.plaintext, column.fingerprint.purpose);
      }
      try {
        if (await store.replace(column, row, next)) outcome.rotated += 1;
        else outcome.skipped += 1;
      } catch {
        // A failed write must not stop the run or print anything; the next run retries it.
        outcome.skipped += 1;
      }
    });
    results.push(outcome);
  }
  return results;
}
