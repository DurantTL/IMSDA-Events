import "server-only";

import { openSecret, sealSecret } from "@/lib/secret-box";
import { HealthRecordError } from "@/modules/health-records/errors";

/**
 * The only place a health field is sealed or opened (#611). Each field is its
 * own ciphertext under its own key purpose, which names the record and the
 * field, so a sealed value copied to another record or another field cannot
 * be opened there (the same idea as `club-forms/sealed-answers.ts`).
 */
function purposeFor(recordId: string, fieldKey: string) {
  return `health-record:${recordId}:${fieldKey}`;
}

export function sealHealthField(recordId: string, fieldKey: string, value: unknown) {
  return sealSecret(JSON.stringify(value), purposeFor(recordId, fieldKey));
}

/**
 * Seals every value of a new record in one go, as the rows `HealthRecordField` stores (#878). The import builds a
 * record id and its rows here, so nothing outside this file and the repository handles a sealed column by name.
 */
export function sealHealthFieldRows(recordId: string, values: Record<string, unknown>) {
  return Object.entries(values).map(([fieldKey, value]) => ({ fieldKey, sealedValue: sealHealthField(recordId, fieldKey, value) }));
}

/** An unreadable value is an error with a fixed message, never the ciphertext or a partial value. */
export function openHealthField(recordId: string, fieldKey: string, sealed: string): unknown {
  try {
    return JSON.parse(openSecret(sealed, purposeFor(recordId, fieldKey))) as unknown;
  } catch {
    throw new HealthRecordError("UNREADABLE", "A health record could not be read. Ask a system administrator to check the encryption key.");
  }
}

/**
 * Sealed per-event copies (#924) use their own purpose, which names the
 * snapshot and the field, so a copy's value cannot be opened as a live record's
 * (or the other way round) and cannot be moved to another snapshot.
 */
function snapshotPurposeFor(snapshotId: string, fieldKey: string) {
  return `health-snapshot:${snapshotId}:${fieldKey}`;
}

export function sealSnapshotField(snapshotId: string, fieldKey: string, value: unknown) {
  return sealSecret(JSON.stringify(value), snapshotPurposeFor(snapshotId, fieldKey));
}

export function openSnapshotField(snapshotId: string, fieldKey: string, sealed: string): unknown {
  try {
    return JSON.parse(openSecret(sealed, snapshotPurposeFor(snapshotId, fieldKey))) as unknown;
  } catch {
    throw new HealthRecordError("UNREADABLE", "A sealed health copy could not be read. Ask a system administrator to check the encryption key.");
  }
}
