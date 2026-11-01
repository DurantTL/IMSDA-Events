import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrisma } from "@/lib/prisma";
import { AccessDeniedError } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { mealTicketId, scannerMealTypes } from "@/modules/meals/domain";
import { MealError } from "@/modules/meals/errors";
import {
  SCANNER_IMPORT_MAX_BYTES, SCANNER_PREVIEW_ROWS_SHOWN, eventLocalDateTime, parseScannerFile, planScannerImport, reviewReasonLabels, sha256Hex, sheetTicketNumbers,
  type ImportTicket, type ParsedScannerFile, type PlanInput, type ReviewReason, type ReviewRow, type ScannerPlan, type ScannerSource,
} from "@/modules/meals/scanner-import";
import { buildServedReport, servedDrillDown, type ServedTicket } from "@/modules/meals/served-report";
import { formatPersonName } from "@/lib/person-name";

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
      id, number, confirmationCode: row.registration?.confirmationCode ?? "", guestName: formatPersonName({ firstName: first, lastName: last }), mealType: row.mealType,
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
  const unredeemed = new Map<string, string>();
  const existingKeys = new Set<string>();
  const existingSources = new Set<ScannerSource>();
  for (const event of events) {
    existingKeys.add(event.sourceKey);
    if (event.kind === "REDEEMED") {
      served.set(event.ticketId, { sourceKey: event.sourceKey, occurredAt: event.occurredAt });
      unredeemed.delete(event.ticketId);
      existingSources.add(event.batch.source);
    } else {
      served.delete(event.ticketId);
      unredeemed.set(event.ticketId, event.sourceKey);
    }
  }
  return { served, unredeemed, existingKeys, existingSources };
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
    served: state.served, unredeemed: state.unredeemed, existingKeys: state.existingKeys, existingSources: state.existingSources,
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
  conflicts: Array<{ kind: "UNREDEEM" | "REREDEEM"; ticketNumber: number; ticketId: string; line: number; servedAt: string; servedAtLabel: string }>;
  /** Accepting an un-redeem lowers the served counts, so it needs finance access; the screen disables those boxes without it. */
  canAcceptUnredeem: boolean;
  otherSourceHasRedemptions: boolean;
  digest: string;
};

function toPreview(plan: ScannerPlan, fileName: string, timeZone: string, canAcceptUnredeem: boolean): ScannerPreview {
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
    conflicts: plan.conflicts.map((row) => ({
      kind: row.kind, ticketNumber: row.ticketNumber, ticketId: mealTicketId(row.ticketNumber), line: row.line, servedAt: row.servedAt,
      servedAtLabel: eventLocalDateTime(new Date(row.servedAt), timeZone),
    })),
    canAcceptUnredeem,
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
export async function previewScannerImport(eventId: string, fileName: string, text: string, canAcceptUnredeem = false): Promise<ScannerPreview> {
  const { file, fileSha256 } = readFile(text);
  const input = await loadPlanInput(getPrisma(), eventId, file, fileSha256);
  return toPreview(planScannerImport(input), cleanFileName(fileName), input.timeZone, canAcceptUnredeem);
}

export type ScannerImportResult = {
  batchId: string | null;
  redeemed: number;
  unredeemed: number;
  reredeemed: number;
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
  /** The caller also holds MANAGE_FINANCE. Recording new redemptions needs only report access; accepting an un-redeem needs this. */
  canAcceptUnredeem: boolean;
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
    const corrections = plan.conflicts.filter((row) => accepted.has(row.ticketNumber));
    const unredeems = corrections.filter((row) => row.kind === "UNREDEEM");
    const reredeems = corrections.filter((row) => row.kind === "REREDEEM");
    if (unredeems.length > 0 && !input.canAcceptUnredeem) {
      throw new AccessDeniedError("Accepting an un-redeem lowers the served counts and needs finance access.", 403, "PERMISSION_DENIED");
    }
    const result: ScannerImportResult = {
      batchId: null, redeemed: plan.redemptions.length + reredeems.length, unredeemed: unredeems.length, reredeemed: reredeems.length,
      unchanged: plan.counts.unchanged, review: plan.counts.review, conflictsIgnored: plan.conflicts.length - corrections.length,
    };
    if (result.redeemed === 0 && unredeems.length === 0) return result;

    const batch = await tx.eventMealImportBatch.create({
      data: {
        eventId: input.eventId, uploadedByUserId: input.userId, source: plan.source, fileName: cleanFileName(input.fileName), fileSha256,
        rowCount: plan.rowCount, redeemedCount: result.redeemed, unredeemedCount: unredeems.length, reviewCount: plan.counts.review,
      },
      select: { id: true },
    });
    const correctedAt = new Date();
    try {
      await tx.eventMealRedemption.createMany({
        data: [
          ...plan.redemptions.map((row) => ({
            eventId: input.eventId, ticketId: row.ticketId, batchId: batch.id, kind: "REDEEMED" as const,
            occurredAt: new Date(row.occurredAt), redeemedByText: row.redeemedByText, sourceKey: row.sourceKey,
          })),
          ...reredeems.map((row) => ({
            eventId: input.eventId, ticketId: row.ticketId, batchId: batch.id, kind: "REDEEMED" as const,
            occurredAt: new Date(row.servedAt), redeemedByText: row.redeemedByText, sourceKey: row.sourceKey,
          })),
          ...unredeems.map((row) => ({
            eventId: input.eventId, ticketId: row.ticketId, batchId: batch.id, kind: "UNREDEEMED" as const,
            occurredAt: correctedAt, redeemedByText: null, sourceKey: row.sourceKey,
          })),
        ],
      });
    } catch (error) {
      // A unique violation means another upload recorded one of these rows first. Say so without passing the database's
      // message (which names the key) on to a log or a response.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new MealError("CONFLICT", "Another import recorded some of these rows first. Nothing was saved. Preview the file again.");
      }
      throw error;
    }
    // Ids and counts only: no ticket holder, guest name, registration code or row content.
    await writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.userId,
      action: "meals.scanner_import",
      entityType: "EventMealImportBatch",
      entityId: batch.id,
      summary: `Imported café scanner results: ${result.redeemed} served, ${unredeems.length} corrected, ${plan.counts.review} for review.`,
      metadata: {
        source: plan.source, rows: plan.rowCount, redeemed: result.redeemed, unredeemed: unredeems.length, reredeemed: reredeems.length,
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
  // A meal that was served stays served when its ticket is cancelled afterwards: it counts as served (not as sold).
  const activeIds = new Set(tickets.map((ticket) => ticket.id));
  const goneIds = [...served.keys()].filter((id) => !activeIds.has(id));
  if (goneIds.length > 0) {
    const gone = await prisma.eventMealTicket.findMany({
      where: { eventId, id: { in: goneIds } },
      select: { id: true, number: true, selection: { select: { mealType: true, payer: true, service: { select: { serviceDate: true } } } } },
    });
    for (const ticket of gone) {
      sold.push({
        id: ticket.id, number: ticket.number, mealType: ticket.selection.mealType, serviceDate: ticket.selection.service?.serviceDate ?? "",
        payer: ticket.selection.payer, cancelled: true,
      });
    }
  }
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
