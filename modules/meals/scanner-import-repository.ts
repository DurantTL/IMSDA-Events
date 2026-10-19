import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { mealTicketId, scannerMealTypes } from "@/modules/meals/domain";
import { MealError } from "@/modules/meals/errors";
import {
  SCANNER_IMPORT_MAX_BYTES, SCANNER_PREVIEW_ROWS_SHOWN, parseScannerFile, planScannerImport, reviewReasonLabels, sha256Hex, sheetTicketNumbers,
  type ImportTicket, type ParsedScannerFile, type PlanInput, type ReviewReason, type ReviewRow, type ScannerPlan, type ScannerSource,
} from "@/modules/meals/scanner-import";
import { buildServedReport, servedDrillDown, type ServedTicket } from "@/modules/meals/served-report";

type Db = PrismaClient | Prisma.TransactionClient;

const liveRegistration = { status: { in: ["SUBMITTED", "CONFIRMED"] as Array<"SUBMITTED" | "CONFIRMED"> } };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The tickets the café file can carry: the same set `exports/meal-tickets` writes (active, ticketed, live registration). */
async function loadActiveTickets(db: Db, eventId: string): Promise<ImportTicket[]> {
  const tickets = await db.eventMealTicket.findMany({
    where: {
      eventId, cancelledAt: null,
      selection: {
        is: {
          status: "ACTIVE", registration: liveRegistration, mealType: { in: [...scannerMealTypes] },
          OR: [{ serviceId: null }, { service: { is: { status: "ACTIVE", ticketing: "TICKETED" } } }],
        },
      },
    },
    orderBy: { number: "asc" },
    select: {
      id: true, number: true,
      selection: {
        select: {
          mealType: true, ageGroup: true, payer: true,
          registration: { select: { confirmationCode: true, contactSnapshot: true } },
          attendee: { select: { profileSnapshot: true, person: { select: { firstName: true, lastName: true } } } },
          service: { select: { serviceDate: true } },
        },
      },
    },
  });
  return tickets.map(({ id, number, selection: row }) => {
    const contact = record(row.registration?.contactSnapshot);
    const profile = record(row.attendee?.profileSnapshot);
    const first = typeof profile.firstName === "string" ? profile.firstName : row.attendee?.person.firstName ?? (typeof contact.firstName === "string" ? contact.firstName : "");
    const last = typeof profile.lastName === "string" ? profile.lastName : row.attendee?.person.lastName ?? (typeof contact.lastName === "string" ? contact.lastName : "");
    return {
      id, number, confirmationCode: row.registration?.confirmationCode ?? "", guestName: `${first} ${last}`.trim(), mealType: row.mealType,
      serviceDate: row.service?.serviceDate ?? "", payer: row.payer, ageGroup: row.ageGroup,
    } satisfies ImportTicket;
  });
}

/** Every stored redemption event of the event, folded into each ticket's current state. */
async function loadRedemptionState(db: Db, eventId: string) {
  const events = await db.eventMealRedemption.findMany({
    where: { eventId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { ticketId: true, kind: true, sourceKey: true, occurredAt: true, batch: { select: { source: true } } },
  });
  const served = new Map<string, { sourceKey: string; occurredAt: Date }>();
  const existingKeys = new Set<string>();
  const existingSources = new Set<ScannerSource>();
  for (const event of events) {
    existingKeys.add(event.sourceKey);
    if (event.kind === "REDEEMED") {
      served.set(event.ticketId, { sourceKey: event.sourceKey, occurredAt: event.occurredAt });
      existingSources.add(event.batch.source);
    } else {
      served.delete(event.ticketId);
    }
  }
  return { served, existingKeys, existingSources };
}

async function loadPlanInput(db: Db, eventId: string, file: ParsedScannerFile, fileSha256: string): Promise<PlanInput> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { timezone: true } });
  if (!event) throw new MealError("EVENT_NOT_FOUND", "That event does not exist.");
  const [tickets, state] = await Promise.all([loadActiveTickets(db, eventId), loadRedemptionState(db, eventId)]);
  const named = sheetTicketNumbers(file);
  const activeNumbers = new Set(tickets.map((ticket) => ticket.number));
  const unseen = named.filter((number) => !activeNumbers.has(number));
  const [inEvent, elsewhere] = unseen.length === 0 ? [[], []] : await Promise.all([
    db.eventMealTicket.findMany({ where: { eventId, number: { in: unseen } }, select: { number: true } }),
    db.eventMealTicket.findMany({ where: { eventId: { not: eventId }, number: { in: unseen } }, select: { number: true } }),
  ]);
  return {
    file, fileSha256, timeZone: event.timezone, tickets,
    inactiveNumbers: new Set(inEvent.map((row) => row.number)),
    otherEventNumbers: new Set(elsewhere.map((row) => row.number)),
    served: state.served, existingKeys: state.existingKeys, existingSources: state.existingSources,
  };
}

export type ScannerPreview = {
  source: ScannerSource;
  fileName: string;
  rowCount: number;
  counts: ScannerPlan["counts"];
  /** Rows that matched a ticket (new, unchanged, un-redeem or not redeemed). */
  matched: number;
  reviewReasons: Array<{ reason: ReviewReason; label: string; count: number }>;
  review: ReviewRow[];
  reviewShown: number;
  conflicts: Array<{ ticketNumber: number; ticketId: string; line: number; servedAt: string }>;
  otherSourceHasRedemptions: boolean;
  digest: string;
};

function toPreview(plan: ScannerPlan, fileName: string): ScannerPreview {
  const matched = plan.counts.newRedemptions + plan.counts.unchanged + plan.counts.conflicts + plan.counts.notRedeemed;
  return {
    source: plan.source,
    fileName,
    rowCount: plan.rowCount,
    counts: plan.counts,
    matched,
    reviewReasons: (Object.entries(plan.byReason) as Array<[ReviewReason, number]>)
      .map(([reason, count]) => ({ reason, label: reviewReasonLabels[reason], count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    review: plan.review.slice(0, SCANNER_PREVIEW_ROWS_SHOWN),
    reviewShown: Math.min(plan.review.length, SCANNER_PREVIEW_ROWS_SHOWN),
    conflicts: plan.conflicts.map((row) => ({ ticketNumber: row.ticketNumber, ticketId: mealTicketId(row.ticketNumber), line: row.line, servedAt: row.servedAt })),
    otherSourceHasRedemptions: plan.otherSourceHasRedemptions,
    digest: plan.digest,
  };
}

function cleanFileName(name: string) {
  return name.split(/[\\/]/).pop()!.replace(/[^\w .()-]/g, "_").slice(0, 120) || "scanner-results.csv";
}

function readFile(text: string) {
  if (Buffer.byteLength(text, "utf8") > SCANNER_IMPORT_MAX_BYTES) {
    throw new MealError("INVALID", "The file is larger than 2 MB. Export a shorter period and try again.");
  }
  return { file: parseScannerFile(text), fileSha256: sha256Hex(text) };
}

/** Reads and plans the file against the event. Writes nothing. */
export async function previewScannerImport(eventId: string, fileName: string, text: string): Promise<ScannerPreview> {
  const { file, fileSha256 } = readFile(text);
  const plan = planScannerImport(await loadPlanInput(getPrisma(), eventId, file, fileSha256));
  return toPreview(plan, cleanFileName(fileName));
}

export type ScannerImportResult = {
  batchId: string | null;
  redeemed: number;
  unredeemed: number;
  unchanged: number;
  review: number;
  conflictsIgnored: number;
};

/**
 * Records what the preview showed. The file is sent again and planned again, inside the transaction, against the data as
 * it is now: the plan's digest must equal the preview's, or nothing is saved. Redemptions are appended (never updated),
 * un-redeems only for the conflicts staff accepted. Importing the same rows again plans nothing and writes nothing.
 */
export async function confirmScannerImport(input: {
  eventId: string;
  userId: string;
  fileName: string;
  text: string;
  digest: string;
  acceptUnredeem: readonly number[];
  acknowledgeOtherSource: boolean;
}): Promise<ScannerImportResult> {
  const { file, fileSha256 } = readFile(input.text);
  return getPrisma().$transaction(async (tx) => {
    const plan = planScannerImport(await loadPlanInput(tx, input.eventId, file, fileSha256));
    if (plan.digest !== input.digest) {
      throw new MealError("CONFLICT", "The file or the meal records changed since the preview. Nothing was saved. Preview the file again.");
    }
    if (plan.otherSourceHasRedemptions && !input.acknowledgeOtherSource) {
      throw new MealError("CONFLICT", "This event already holds results from the other kind of file. Confirm that you understand a meal could be counted twice.");
    }
    const accepted = new Set(input.acceptUnredeem);
    const conflictNumbers = new Set(plan.conflicts.map((row) => row.ticketNumber));
    if ([...accepted].some((number) => !conflictNumbers.has(number))) {
      throw new MealError("INVALID", "You accepted an un-redeem that is not in the preview.");
    }
    const unredeems = plan.conflicts.filter((row) => accepted.has(row.ticketNumber));
    const result: ScannerImportResult = {
      batchId: null, redeemed: plan.redemptions.length, unredeemed: unredeems.length, unchanged: plan.counts.unchanged,
      review: plan.counts.review, conflictsIgnored: plan.conflicts.length - unredeems.length,
    };
    if (plan.redemptions.length === 0 && unredeems.length === 0) return result;

    const batch = await tx.eventMealImportBatch.create({
      data: {
        eventId: input.eventId, uploadedByUserId: input.userId, source: plan.source, fileName: cleanFileName(input.fileName), fileSha256,
        rowCount: plan.rowCount, redeemedCount: plan.redemptions.length, unredeemedCount: unredeems.length, reviewCount: plan.counts.review,
      },
      select: { id: true },
    });
    const correctedAt = new Date();
    await tx.eventMealRedemption.createMany({
      data: [
        ...plan.redemptions.map((row) => ({
          eventId: input.eventId, ticketId: row.ticketId, batchId: batch.id, kind: "REDEEMED" as const,
          occurredAt: new Date(row.occurredAt), redeemedByText: row.redeemedByText, sourceKey: row.sourceKey,
        })),
        ...unredeems.map((row) => ({
          eventId: input.eventId, ticketId: row.ticketId, batchId: batch.id, kind: "UNREDEEMED" as const,
          occurredAt: correctedAt, redeemedByText: null, sourceKey: row.sourceKey,
        })),
      ],
    });
    // Ids and counts only: no ticket holder, guest name, registration code or row content.
    await writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.userId,
      action: "meals.scanner_import",
      entityType: "EventMealImportBatch",
      entityId: batch.id,
      summary: `Imported café scanner results: ${plan.redemptions.length} served, ${unredeems.length} corrected, ${plan.counts.review} for review.`,
      metadata: {
        source: plan.source, rows: plan.rowCount, redeemed: plan.redemptions.length, unredeemed: unredeems.length,
        unchanged: plan.counts.unchanged, review: plan.counts.review, conflictsIgnored: result.conflictsIgnored,
      },
    }, tx);
    return { ...result, batchId: batch.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 });
}

async function loadServedInputs(eventId: string) {
  const prisma = getPrisma();
  const [event, tickets, state] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { timezone: true } }),
    loadActiveTickets(prisma, eventId),
    loadRedemptionState(prisma, eventId),
  ]);
  const served = new Map([...state.served].map(([id, value]) => [id, value.occurredAt]));
  const sold: ServedTicket[] = tickets.map((ticket) => ({
    id: ticket.id, number: ticket.number, mealType: ticket.mealType, serviceDate: ticket.serviceDate, payer: ticket.payer,
  }));
  return { timeZone: event?.timezone ?? "America/Chicago", sold, served, anyImport: state.existingKeys.size > 0 };
}

/** Meals served against tickets sold, by service and payer. Counts only. */
export async function loadServedReport(eventId: string) {
  const { sold, served, anyImport } = await loadServedInputs(eventId);
  return { ...buildServedReport(sold, served), anyImport };
}

/** One service's tickets by id, for the drill-down. No names. Capped so a page stays small. */
export async function loadServedDrillDown(eventId: string, key: string) {
  const { sold, served, timeZone } = await loadServedInputs(eventId);
  const rows = servedDrillDown(sold, served, key, timeZone);
  return { rows: rows.slice(0, 500), total: rows.length };
}
