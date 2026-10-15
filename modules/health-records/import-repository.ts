import "server-only";

import { randomUUID } from "node:crypto";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { isSecretEncryptionConfigured } from "@/lib/secret-box";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { requireHealthPrivacyAcknowledgment } from "@/modules/health-records/acknowledgment";
import { sealHealthFieldRows } from "@/modules/health-records/crypto";
import { hasHealthNoteFor, healthAuditActor, type HealthViewer } from "@/modules/health-records/domain";
import { HealthRecordError } from "@/modules/health-records/errors";
import { requireHealthRecordsEnabled } from "@/modules/health-records/flag";
import { HealthImportFileError, readHealthImportFiles } from "@/modules/health-records/import-files";
import {
  MATCH_REASON_LABELS,
  clubsForText,
  countOutcomes,
  matchEntries,
  type EntryMatch,
  type ImportOutcome,
  type MatchClub,
  type MatchMember,
} from "@/modules/health-records/import-match";
import {
  HealthImportParseError,
  IMPORT_SECTION_LABELS,
  parseCognitoHealthExport,
  type ParsedHealthEntry,
} from "@/modules/health-records/import-parser";

/**
 * Importing the 2026 Pathfinder Health Record from a Cognito Forms export (#878).
 *
 * - System administrators only, and only after the privacy acknowledgment. The
 *   import never opens a stored health value, so it is not a view and needs no
 *   break-glass grant; it only writes new sealed records.
 * - The uploaded file is read in memory and never stored. The apply step reads
 *   the same file again and re-matches it, so nothing parsed is kept between
 *   the two steps.
 * - The preview carries a club, a name, an outcome and section names. Never a
 *   medical value.
 * - A member who already has a record is skipped, so running the same file
 *   again changes nothing. A record is never overwritten.
 * - Audit rows hold ids and counts only.
 */

const IMPORT_TRANSACTION_MS = 60_000;

function requireImporter(viewer: HealthViewer) {
  requireHealthRecordsEnabled();
  if (viewer.kind !== "SYSTEM_ADMIN" || viewer.actAsId) {
    throw new HealthRecordError("FORBIDDEN", "Only a system administrator can import health records.");
  }
  return viewer;
}

function readExport(files: Array<{ bytes: Uint8Array }>) {
  try {
    return parseCognitoHealthExport(readHealthImportFiles(files));
  } catch (error) {
    if (error instanceof HealthImportFileError || error instanceof HealthImportParseError) {
      throw new HealthRecordError("VALIDATION_FAILED", error.message);
    }
    throw error;
  }
}

function openBirthDateSafely(sealed: string | null) {
  if (!sealed) return null;
  try {
    return openBirthDate(sealed);
  } catch {
    return null;
  }
}

type Matched = { entries: ParsedHealthEntry[]; matches: EntryMatch[]; unreadableRows: number; duplicateIds: number; clubsConsidered: number };

/** Parses the export and matches every entry against the current club year's rosters. */
async function parseAndMatch(files: Array<{ bytes: Uint8Array }>, now: Date): Promise<Matched> {
  const parsed = readExport(files);
  const prisma = getPrisma();
  const organizations = await prisma.organization.findMany({
    where: { type: "CLUB", isActive: true },
    select: { id: true, name: true, normalizedName: true, parentOrganization: { select: { name: true } } },
  });
  const clubs: MatchClub[] = organizations.map((club) => ({
    organizationId: club.id,
    name: club.name,
    normalizedName: club.normalizedName,
    sponsorName: club.parentOrganization?.name ?? null,
  }));
  const wanted = new Set<string>();
  for (const entry of parsed.entries) {
    if (entry.incomplete) continue;
    const found = clubsForText(entry.clubText, clubs);
    if (found.length === 1) wanted.add(found[0]!.organizationId);
  }
  const clubIds = [...wanted];
  const rows = clubIds.length === 0
    ? []
    : await prisma.clubRosterMember.findMany({
        where: { organizationId: { in: clubIds }, clubYear: clubYearFor(now), status: "ACTIVE", personId: { not: null } },
        select: {
          id: true,
          organizationId: true,
          personId: true,
          sealedBirthDate: true,
          person: { select: { firstName: true, lastName: true } },
          guardians: { select: { email: true } },
        },
      });
  // Ids only: whether a record exists for this row, or for the same person's row in an earlier club year.
  const personIds = rows.flatMap((row) => (row.personId ? [row.personId] : []));
  const records = rows.length === 0
    ? []
    : await prisma.healthRecord.findMany({
        where: { organizationId: { in: clubIds }, OR: [{ rosterMemberId: { in: rows.map((row) => row.id) } }, { rosterMember: { personId: { in: personIds } } }] },
        select: { organizationId: true, rosterMemberId: true, rosterMember: { select: { personId: true } } },
      });
  const recordedMembers = new Set(records.map((record) => record.rosterMemberId));
  const recordedPeople = new Set(records.map((record) => `${record.organizationId}|${record.rosterMember.personId ?? ""}`));
  const members: MatchMember[] = rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    firstName: row.person?.firstName ?? "",
    lastName: row.person?.lastName ?? "",
    birthDate: openBirthDateSafely(row.sealedBirthDate),
    guardianEmails: row.guardians.map((guardian) => guardian.email.trim().toLowerCase()).filter(Boolean),
    hasRecord: recordedMembers.has(row.id) || (row.personId !== null && recordedPeople.has(`${row.organizationId}|${row.personId}`)),
  }));
  return {
    entries: parsed.entries,
    matches: matchEntries(parsed.entries, clubs, members),
    unreadableRows: parsed.unreadableRows,
    duplicateIds: parsed.duplicateIds,
    clubsConsidered: clubIds.length,
  };
}

export type ImportPreviewRow = {
  sourceId: string;
  name: string;
  /** The church and club as typed on the form, then the club it matched, if any. */
  clubText: string;
  clubName: string | null;
  outcome: ImportOutcome;
  /** Why a row was not matched. A fixed sentence, never a value. */
  reason: string | null;
  /** Section names present, for example "allergies". Never what they say. */
  sections: string[];
  /** How many fields will be flagged "needs correcting". A count only. */
  needsCorrectionCount: number;
  contactsOmitted: number;
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
  counts: Record<ImportOutcome, number>;
  total: number;
  unreadableRows: number;
  duplicateIds: number;
};

function previewRows({ entries, matches }: Matched): ImportPreviewRow[] {
  return entries.map((entry, index) => {
    const match = matches[index]!;
    return {
      sourceId: entry.sourceId,
      name: `${entry.firstName} ${entry.lastName}`.trim(),
      clubText: entry.clubText,
      clubName: match.clubName,
      outcome: match.outcome,
      reason: match.reason ? MATCH_REASON_LABELS[match.reason] : null,
      sections: entry.sections.map((section) => IMPORT_SECTION_LABELS[section]),
      needsCorrectionCount: entry.needsCorrection.length,
      contactsOmitted: entry.contactsOmitted,
    };
  });
}

/**
 * Step one: read the file, match it, and say what an import would do. Writes
 * nothing but one audit row (counts only).
 */
export async function previewHealthImport(viewer: HealthViewer, files: Array<{ bytes: Uint8Array }>, now = new Date()): Promise<ImportPreview> {
  const admin = requireImporter(viewer);
  await requireHealthPrivacyAcknowledgment(admin);
  const matched = await parseAndMatch(files, now);
  const counts = countOutcomes(matched.matches);
  const who = healthAuditActor(admin);
  await writeAuditLog({
    actorUserId: who.actorUserId,
    action: "HEALTH_IMPORT_PREVIEWED",
    entityType: "HealthImport",
    summary: "Previewed a health record import.",
    metadata: { ...who.metadata, entryCount: matched.entries.length, unreadableRows: matched.unreadableRows, clubCount: matched.clubsConsidered, counts },
  });
  return { rows: previewRows(matched), counts, total: matched.entries.length, unreadableRows: matched.unreadableRows, duplicateIds: matched.duplicateIds };
}

export type ImportApplyOutcome = ImportOutcome | "IMPORTED" | "NOT_SELECTED" | "FAILED";

export type ImportApplyRow = Omit<ImportPreviewRow, "outcome"> & { outcome: ImportApplyOutcome };

export type ImportApplyResult = {
  runId: string;
  rows: ImportApplyRow[];
  counts: Record<ImportApplyOutcome, number>;
  imported: number;
};

function emptyApplyCounts(): Record<ImportApplyOutcome, number> {
  return { MATCHED: 0, NEEDS_CHECK: 0, UNMATCHED: 0, ALREADY_HAS_RECORD: 0, SUPERSEDED: 0, INCOMPLETE: 0, IMPORTED: 0, NOT_SELECTED: 0, FAILED: 0 };
}

/**
 * Step two: read the same file again, match it again, and write a sealed record
 * for each MATCHED row (all of them, or only the `include`d entry ids). Each club
 * is its own transaction, so one failure never blocks the others. The records are
 * marked as imported for a director to review and count as needing confirmation.
 */
export async function applyHealthImport(
  viewer: HealthViewer,
  files: Array<{ bytes: Uint8Array }>,
  options: { include?: readonly string[] | null } = {},
  now = new Date(),
): Promise<ImportApplyResult> {
  const admin = requireImporter(viewer);
  await requireHealthPrivacyAcknowledgment(admin);
  if (!isSecretEncryptionConfigured()) {
    throw new HealthRecordError("ENCRYPTION_NOT_CONFIGURED", "Health records can't be saved right now. Please try again later.");
  }
  const matched = await parseAndMatch(files, now);
  const include = options.include ? new Set(options.include) : null;
  const runId = randomUUID();
  const who = healthAuditActor(admin);
  const prisma = getPrisma();
  const outcomes = new Map<string, ImportApplyOutcome>();
  const importable = new Map<string, Array<{ entry: ParsedHealthEntry; match: EntryMatch }>>();
  matched.entries.forEach((entry, index) => {
    const match = matched.matches[index]!;
    if (match.outcome !== "MATCHED" || !match.organizationId || !match.memberId) {
      outcomes.set(entry.sourceId, match.outcome);
    } else if (include && !include.has(entry.sourceId)) {
      outcomes.set(entry.sourceId, "NOT_SELECTED");
    } else {
      importable.set(match.organizationId, [...(importable.get(match.organizationId) ?? []), { entry, match }]);
    }
  });

  const clubYear = clubYearFor(now);
  for (const [organizationId, items] of importable) {
    const results = new Map<string, ImportApplyOutcome>();
    try {
      await prisma.$transaction(async (tx) => {
        let imported = 0;
        let alreadyHadRecord = 0;
        for (const { entry, match } of items) {
          const memberId = match.memberId!;
          // The member's row is locked so two imports (or an import and a director's save) for one member run in turn.
          await tx.$queryRaw`SELECT "id" FROM "ClubRosterMember" WHERE "id" = ${memberId} FOR UPDATE`;
          const member = await tx.clubRosterMember.findFirst({
            where: { id: memberId, organizationId, clubYear, status: "ACTIVE", organization: { type: "CLUB", isActive: true } },
            select: { id: true, personId: true },
          });
          if (!member) {
            results.set(entry.sourceId, "FAILED");
            continue;
          }
          const existing = await tx.healthRecord.findFirst({
            where: { organizationId, OR: [{ rosterMemberId: member.id }, ...(member.personId ? [{ rosterMember: { personId: member.personId } }] : [])] },
            select: { id: true },
          });
          if (existing) {
            results.set(entry.sourceId, "ALREADY_HAS_RECORD");
            alreadyHadRecord += 1;
            continue;
          }
          const recordId = randomUUID();
          const rows = sealHealthFieldRows(recordId, entry.values);
          await tx.healthRecord.create({
            data: {
              id: recordId,
              organizationId,
              rosterMemberId: member.id,
              // Not confirmed for any club year: it reads "Needs update" until a director saves or confirms it.
              confirmedClubYear: null,
              lastConfirmedAt: null,
              hasHealthNote: hasHealthNoteFor(entry.values),
              lastEnteredVia: null,
              importedAt: now,
              lastSavedByActor: admin.userId,
              fields: { create: rows },
            },
          });
          await writeAuditLog({
            actorUserId: who.actorUserId,
            action: "HEALTH_RECORD_IMPORTED",
            entityType: "HealthRecord",
            entityId: recordId,
            summary: "Imported a member's health record from the 2026 online form.",
            metadata: { ...who.metadata, runId, organizationId, rosterMemberId: member.id, fieldCount: rows.length, clubYear },
          }, tx);
          results.set(entry.sourceId, "IMPORTED");
          imported += 1;
        }
        if (imported > 0 || alreadyHadRecord > 0) {
          await writeAuditLog({
            actorUserId: who.actorUserId,
            action: "HEALTH_IMPORT_CLUB_APPLIED",
            entityType: "Organization",
            entityId: organizationId,
            summary: "Imported health records for a club from the 2026 online form.",
            metadata: { ...who.metadata, runId, organizationId, clubYear, imported, alreadyHadRecord, selected: items.length },
          }, tx);
        }
      }, { timeout: IMPORT_TRANSACTION_MS });
      for (const [sourceId, outcome] of results) outcomes.set(sourceId, outcome);
    } catch (failure) {
      // The club's transaction rolled back: none of its rows were written. Only the error's code is logged, never its
      // message: a database error can echo the query it ran.
      const code = typeof failure === "object" && failure !== null && typeof (failure as { code?: unknown }).code === "string" ? (failure as { code: string }).code : "unknown";
      const action = "Importing a club's health records failed";
      const error = new Error(`${action} (${code})`);
      logError(action, error);
      for (const { entry } of items) outcomes.set(entry.sourceId, "FAILED");
    }
  }

  const base = previewRows(matched);
  const rows: ImportApplyRow[] = base.map((row) => ({ ...row, outcome: outcomes.get(row.sourceId) ?? row.outcome }));
  const counts = emptyApplyCounts();
  for (const row of rows) counts[row.outcome] += 1;
  await writeAuditLog({
    actorUserId: who.actorUserId,
    action: "HEALTH_IMPORT_APPLIED",
    entityType: "HealthImport",
    entityId: runId,
    summary: "Ran a health record import.",
    metadata: { ...who.metadata, runId, clubYear, entryCount: matched.entries.length, unreadableRows: matched.unreadableRows, clubCount: importable.size, counts },
  });
  return { runId, rows, counts, imported: counts.IMPORTED };
}
