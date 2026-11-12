import { z } from "zod";

/**
 * Campsite and uniform inspection scoring (#1896), pure rules and no database. The optional Inspections tool keeps two
 * scored events (one score for each club, in points, highest wins) inside Camporee scoring (#1676), so inspection scores
 * rank and earn ribbons with every other scored event. Safe to import in a browser: nothing here needs the server.
 */

export const inspectionKeys = ["campsite", "uniform"] as const;
export type InspectionKey = (typeof inspectionKeys)[number];

export const inspectionNames: Record<InspectionKey, string> = { campsite: "Campsite inspection", uniform: "Uniform inspection" };

export function isInspectionKey(value: unknown): value is InspectionKey {
  return typeof value === "string" && (inspectionKeys as readonly string[]).includes(value);
}

/**
 * The inspection a CSV cell or a typed word names: "campsite", "Uniform", "campsite inspection". Null when it is neither,
 * so the row is shown as a problem and never guessed at.
 */
export function readInspectionKey(text: string): InspectionKey | null {
  const word = text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/ inspection$/, "");
  return isInspectionKey(word) ? word : null;
}

/** A club name as it is compared: letters, digits and single spaces, no case, accents or punctuation. */
export function normalizeClubName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** One score typed on the phone: the inspection, the club, and the score as typed (null removes the score). */
export const inspectionScoreSchema = z.object({
  inspection: z.enum(inspectionKeys),
  subjectId: z.string().trim().min(1).max(64),
  value: z.string().trim().max(12).nullable(),
}).strict();

/** One request shape for the Inspections route: the switch, or one club's score. The server decides who may do which. */
export const inspectionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("saveScore"), entry: inspectionScoreSchema }).strict(),
]);
export type InspectionAction = z.infer<typeof inspectionActionSchema>;

export const maxImportBytes = 200_000;
export const maxImportRows = 1000;

/** The CSV import request: preview a file's text, or apply it with the digest the preview returned. */
export const inspectionImportSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), csv: z.string().max(maxImportBytes) }).strict(),
  z.object({ action: z.literal("apply"), csv: z.string().max(maxImportBytes), digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
]);
export type InspectionImportRequest = z.infer<typeof inspectionImportSchema>;

export const importStatuses = ["matched", "unknown_club", "ambiguous_club", "bad_inspection", "bad_score", "duplicate"] as const;
export type ImportStatus = (typeof importStatuses)[number];

export const importStatusLabels: Record<ImportStatus, string> = {
  matched: "Matched",
  unknown_club: "Unknown club",
  ambiguous_club: "More than one club has this name",
  bad_inspection: "Inspection must be campsite or uniform",
  bad_score: "Bad score",
  duplicate: "Duplicate row",
};

export type ImportPreviewRow = {
  /** The row's line in the file, counting the header as line 1. */
  line: number;
  status: ImportStatus;
  /** What the file said, shown back so a person can find the row. */
  clubText: string;
  inspectionText: string;
  scoreText: string;
  /** Set only on a matched row. */
  organizationId: string | null;
  clubName: string | null;
  inspection: InspectionKey | null;
  hundredths: number | null;
  /** Matched rows only: the score the club has now (null when none), and whether this row adds one, changes it or repeats it. */
  existingText: string | null;
  change: "new" | "changed" | "same" | null;
  /** The plain-words problem for a row that cannot be applied. */
  message: string | null;
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
  counts: Record<ImportStatus, number>;
  /** Changes with the file and with the registered clubs. The apply step must send the digest the preview showed. */
  digest: string;
};

/** What staff and Area Coordinators can do with the tool: the same people who enter Camporee scores, with the same switch. */
export type InspectionCapabilities = { canSwitch: boolean; canEnter: boolean; canCorrectAfterPublish: boolean };

/** A file to start from. The club names are made up. */
export const inspectionCsvTemplate = "club,inspection,score\r\nSample Pathfinder Club,campsite,85\r\nSample Pathfinder Club,uniform,92.5\r\n";
