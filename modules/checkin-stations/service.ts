import "server-only";

import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { checkInBlocksForAttendees } from "@/modules/background-checks/repository";
import {
  AttendeePassResolutionError,
  registrationAttendeesSelect,
  resolveAttendeePassForEvent,
  serializeAttendee,
} from "@/modules/checkin/attendee-pass-repository";
import { clubPassTokenPrefix } from "@/modules/checkin/club-pass-token";
import { CheckInOperationError, checkInAttendee, undoCheckIn } from "@/modules/checkin/repository";
import {
  GATE_MODE_OFF_MESSAGE,
  STATION_HISTORY_LIMIT,
  stationBadgeLine,
  stationBalanceReasonLabel,
  stationPaymentMethodLabel,
  stationPaymentSummary,
  stationSummarySuffix,
  type StationBalanceReason,
  type StationCheckInResult,
  type StationFamily,
  type StationPaymentHistoryEntry,
  type StationPaymentSummary,
  type StationSquareCandidate,
} from "@/modules/checkin-stations/domain";
import type { ResolvedStation } from "@/modules/checkin-stations/repository";
import { findPaymentReplay } from "@/modules/payments/payment-replay";
import { PaymentOperationError, recordManualPayment } from "@/modules/payments/repository";
import { attendeeBalanceCents } from "@/modules/registrations/finance-view";
import { formatInTimeZone } from "@/modules/calendar/conference-format";
import { moneyToCents, registrationBalanceCents } from "@/modules/payments/square-domain";
import {
  SquareMatchOperationError,
  attachSquarePaymentToRegistration,
  listUnmatchedSquarePayments,
} from "@/modules/payments/square-match-repository";
import { formatCents } from "@/modules/payments/format-cents";

export class StationServiceError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "PASS_EXPIRED"
      | "SEND_TO_DESK"
      | "BILLED_TO_GROUP"
      | "NOTHING_DUE"
      | "BALANCE_REASON_REQUIRED"
      | "PAYMENT_NOT_LISTED"
      | "PERMISSION_DENIED"
      | "NOT_THIS_STATION"
      | "NOTHING_TO_UNDO"
      | "GATE_MODE_OFF",
  ) {
    super(
      code === "NOT_FOUND"
        ? "We could not find that code for this event."
        : code === "PASS_EXPIRED"
          ? "This pass has expired. Enter the confirmation code instead."
          : code === "SEND_TO_DESK"
            ? "Send this person to the check-in desk."
            : code === "BILLED_TO_GROUP"
              ? "This registration is billed to the church or group, so nothing is collected here."
              : code === "BALANCE_REASON_REQUIRED"
                ? "This registration still has a balance due. Pick a reason before checking anyone in."
                : code === "PAYMENT_NOT_LISTED"
                  ? "That payment is not listed for this registration. Note it for finance to match later."
                  : code === "PERMISSION_DENIED"
                    ? "This station cannot check people in or undo a check-in. Use the check-in desk."
                    : code === "NOT_THIS_STATION"
                      ? "Only check-ins made at this station can be undone here. Use the check-in desk."
                      : code === "NOTHING_TO_UNDO"
                        ? "Already undone, or not checked in."
                        : code === "GATE_MODE_OFF"
                          ? GATE_MODE_OFF_MESSAGE
                        : "Nothing is due on this registration.",
    );
    this.name = "StationServiceError";
  }
}

const squareNoteAction = "CHECK_IN_STATION_SQUARE_APP_NOTED";
const balanceReasonAction = "CHECK_IN_STATION_BALANCE_REASON";

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stationLabelFrom(metadata: Record<string, unknown>) {
  const station = metadataObject(metadata.station);
  return typeof station.label === "string" && station.label.trim() ? station.label.trim() : null;
}

/** Date and time in the event's own zone, with the zone named. */
function formatWhen(at: Date, timeZone: string) {
  try {
    return formatInTimeZone(at, timeZone, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return formatInTimeZone(at, "UTC", { dateStyle: "medium", timeStyle: "short" });
  }
}

/** The history for a response that follows a write: a failed read is logged and left out, never failing the write. */
export async function stationPaymentHistoryAfterWrite(
  eventId: string,
  registrationId: string,
): Promise<{ paymentHistory?: StationPaymentHistoryEntry[] }> {
  try {
    return { paymentHistory: await stationPaymentHistory(eventId, registrationId) };
  } catch (error) {
    logError("Station payment history read failed", error);
    return {};
  }
}

/**
 * The registration's money lines for the station, newest first: payments, "card payment noted" notes and balance
 * reasons. Only amounts, plain method words, times and the station's own label leave here; no staff names, no
 * Square notes or ids.
 */
export async function stationPaymentHistory(eventId: string, registrationId: string): Promise<StationPaymentHistoryEntry[]> {
  const prisma = getPrisma();
  const registration = await prisma.registration.findFirst({
    where: { id: registrationId, eventId },
    select: { event: { select: { timezone: true } } },
  });
  if (!registration) throw new StationServiceError("NOT_FOUND");
  const timeZone = registration.event?.timezone || "UTC";
  const payments = await prisma.payment.findMany({
    where: { eventId, registrationId, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    take: STATION_HISTORY_LIMIT,
    select: {
      id: true,
      amount: true,
      method: true,
      externalReference: true,
      receivedAt: true,
      createdAt: true,
      refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } },
    },
  });
  const paymentIds = payments.map((payment) => payment.id);
  const logs = await prisma.auditLog.findMany({
    where: {
      eventId,
      OR: [
        { entityType: "Registration", entityId: registrationId, action: { in: [squareNoteAction, balanceReasonAction] } },
        ...(paymentIds.length > 0
          ? [{ entityType: "Payment", entityId: { in: paymentIds }, action: { in: ["MANUAL_PAYMENT_RECORDED", "SQUARE_PAYMENT_MANUALLY_MATCHED"] } }]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: STATION_HISTORY_LIMIT * 3,
    select: { id: true, action: true, entityId: true, createdAt: true, metadata: true },
  });
  const stationByPayment = new Map<string, string | null>();
  for (const log of logs) {
    if ((log.action === "MANUAL_PAYMENT_RECORDED" || log.action === "SQUARE_PAYMENT_MANUALLY_MATCHED") && log.entityId) {
      stationByPayment.set(log.entityId, stationLabelFrom(metadataObject(log.metadata)));
    }
  }

  const entries: StationPaymentHistoryEntry[] = [];
  for (const payment of payments) {
    const at = payment.receivedAt ?? payment.createdAt;
    const refundedCents = payment.refunds.reduce((total, refund) => total + moneyToCents(refund.amount), 0);
    const method = stationPaymentMethodLabel(payment.method, payment.externalReference);
    entries.push({
      id: `payment:${payment.id}`,
      kind: "PAYMENT",
      at: at.toISOString(),
      whenLabel: formatWhen(at, timeZone),
      text: `${method} - ${formatCents(moneyToCents(payment.amount))}${refundedCents > 0 ? ` (refunded ${formatCents(refundedCents)})` : ""}`,
      stationLabel: stationByPayment.get(payment.id) ?? null,
    });
  }
  for (const log of logs) {
    const metadata = metadataObject(log.metadata);
    if (log.action === squareNoteAction && typeof metadata.amountCents === "number") {
      entries.push({
        id: `note:${log.id}`,
        kind: "CARD_NOTE",
        at: log.createdAt.toISOString(),
        whenLabel: formatWhen(log.createdAt, timeZone),
        text: `Card payment noted for finance - ${formatCents(metadata.amountCents)}`,
        stationLabel: stationLabelFrom(metadata),
      });
    } else if (log.action === balanceReasonAction && typeof metadata.reasonCode === "string") {
      const note = typeof metadata.note === "string" ? metadata.note.trim() : "";
      const label = stationBalanceReasonLabel(metadata.reasonCode as StationBalanceReason["code"]);
      entries.push({
        id: `reason:${log.id}`,
        kind: "BALANCE_REASON",
        at: log.createdAt.toISOString(),
        whenLabel: formatWhen(log.createdAt, timeZone),
        text: `Checked in with balance due: ${label}${note ? ` - ${note}` : ""}`,
        stationLabel: stationLabelFrom(metadata),
      });
    }
  }
  return entries
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, STATION_HISTORY_LIMIT);
}

async function paymentSummaryFor(eventId: string, registrationId: string): Promise<StationPaymentSummary> {
  const registration = await getPrisma().registration.findFirst({
    where: { id: registrationId, eventId },
    select: {
      totalAmount: true,
      event: { select: { billingMode: true } },
      payments: {
        where: { status: "SUCCEEDED" },
        select: { amount: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } },
      },
    },
  });
  if (!registration) throw new StationServiceError("NOT_FOUND");
  const note = await getPrisma().auditLog.findFirst({
    where: { eventId, action: squareNoteAction, entityType: "Registration", entityId: registrationId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, metadata: true },
  });
  const metadata = note?.metadata && typeof note.metadata === "object" && !Array.isArray(note.metadata)
    ? note.metadata as Record<string, unknown>
    : {};
  const noted = note && typeof metadata.amountCents === "number"
    ? { amountCents: metadata.amountCents, notedAt: note.createdAt.toISOString() }
    : null;
  const isDeferred = registration.event.billingMode === "DEFERRED_ORGANIZATION_INVOICE";
  return stationPaymentSummary({
    balanceCents: attendeeBalanceCents({
      balanceCents: registrationBalanceCents(registration),
      isDeferredOrganizationBilling: isDeferred,
    }),
    isDeferredOrganizationBilling: isDeferred,
    squareAppNote: noted,
  });
}

/**
 * The scanned registration's family for this station's event only. Both the signed pass and the confirmation code
 * resolve inside the event, so another event's code is simply not found. Club registrations and anything not
 * eligible go to the desk; the station never opens a club roster.
 */
export async function lookupStationFamily(
  station: ResolvedStation,
  lookup: { kind: "pass" | "confirmation"; value: string },
): Promise<StationFamily> {
  const eventId = station.station.eventId;
  if (lookup.kind === "pass" && lookup.value.trim().startsWith(`${clubPassTokenPrefix}.`)) {
    throw new StationServiceError("SEND_TO_DESK");
  }
  let confirmationCode: string;
  try {
    confirmationCode = (await resolveAttendeePassForEvent(eventId, lookup)).confirmationCode;
  } catch (error) {
    if (error instanceof AttendeePassResolutionError) {
      throw new StationServiceError(
        error.code === "PASS_EXPIRED"
          ? "PASS_EXPIRED"
          : error.code === "REGISTRATION_NOT_ELIGIBLE"
            ? "SEND_TO_DESK"
            : "NOT_FOUND",
      );
    }
    throw error;
  }

  const registration = await getPrisma().registration.findUnique({
    where: { eventId_confirmationCode: { eventId, confirmationCode } },
    select: {
      id: true,
      confirmationCode: true,
      clubRegistration: { select: { id: true } },
      attendees: registrationAttendeesSelect,
    },
  });
  if (!registration) throw new StationServiceError("NOT_FOUND");
  if (registration.clubRegistration) throw new StationServiceError("SEND_TO_DESK");

  const attendees = registration.attendees.map(serializeAttendee);
  const blocks = await checkInBlocksForAttendees(eventId, attendees.map((attendee) => attendee.id));
  return {
    registrationId: registration.id,
    confirmationCode: registration.confirmationCode,
    attendees: attendees.map((attendee) => ({
      id: attendee.id,
      firstName: attendee.firstName,
      lastName: attendee.lastName,
      attendeeType: attendee.attendeeType,
      checkedIn: attendee.checkedIn,
      needsDeskReview: !attendee.checkedIn && blocks.has(attendee.id),
    })),
    payment: await paymentSummaryFor(eventId, registration.id),
    paymentHistory: await stationPaymentHistory(eventId, registration.id),
  };
}

/**
 * Checks in the ticked people of one registration, one at a time, each through the same `checkInAttendee` the desk
 * uses (screening gate, duplicate safety, audit). The station passes no override, so a held person is reported as
 * needing the desk instead of being checked in.
 */
/** A club registration is worked at the desk, wherever the request came from. */
async function refuseClubRegistration(eventId: string, registrationId: string) {
  const registration = await getPrisma().registration.findFirst({
    where: { id: registrationId, eventId },
    select: { clubRegistration: { select: { id: true } } },
  });
  if (!registration) throw new StationServiceError("NOT_FOUND");
  if (registration.clubRegistration) throw new StationServiceError("SEND_TO_DESK");
}

export async function checkInStationFamily(
  station: ResolvedStation,
  input: {
    registrationId: string;
    items: Array<{ attendeeId: string; idempotencyKey: string }>;
    balanceReason?: StationBalanceReason;
  },
): Promise<StationCheckInResult[]> {
  const eventId = station.station.eventId;
  await refuseClubRegistration(eventId, input.registrationId);
  const ids = [...new Set(input.items.map((item) => item.attendeeId))];
  const found = await getPrisma().registrationAttendee.findMany({
    where: { id: { in: ids }, eventId, registrationId: input.registrationId },
    select: { id: true },
  });
  if (found.length !== ids.length) throw new StationServiceError("NOT_FOUND");

  // A balance still due needs a reason first, decided before anyone is checked in. Paid and church-billed
  // registrations need none.
  const summary = await paymentSummaryFor(eventId, input.registrationId);
  const reason = input.balanceReason;
  const reasonUsable = reason !== undefined && (reason.code !== "OTHER" || reason.note.trim().length > 0);
  if (summary.state === "DUE" && !reasonUsable) throw new StationServiceError("BALANCE_REASON_REQUIRED");

  const results: StationCheckInResult[] = [];
  let newlyCheckedIn = false;
  for (const item of input.items) {
    try {
      const operation = await checkInAttendee(
        eventId,
        item.attendeeId,
        station.starter.id,
        item.idempotencyKey,
        { auditContext: { station: { id: station.station.id, label: station.station.label } } },
      );
      if (operation.checkedIn && operation.disposition === "CREATED") newlyCheckedIn = true;
      results.push({
        attendeeId: item.attendeeId,
        status: !operation.checkedIn
          ? "SEND_TO_DESK"
          : operation.disposition === "ALREADY_CHECKED_IN"
            ? "ALREADY_CHECKED_IN"
            : "CHECKED_IN",
      });
    } catch (error) {
      if (error instanceof CheckInOperationError) {
        results.push({
          attendeeId: item.attendeeId,
          status: error.code === "STERLING_CHECK_NEEDED"
            ? "NEEDS_DESK_REVIEW"
            : error.code === "REGISTRATION_NOT_ELIGIBLE" || error.code === "ATTENDEE_NOT_FOUND"
              ? "SEND_TO_DESK"
              : "FAILED",
        });
      } else {
        results.push({ attendeeId: item.attendeeId, status: "FAILED" });
      }
    }
  }
  // One entry per check-in action, written only when someone was newly checked in, so a replay or a repeat scan
  // does not record the reason twice.
  if (newlyCheckedIn && summary.state === "DUE" && reason) {
    try {
      const registration = await getPrisma().registration.findFirst({
        where: { id: input.registrationId, eventId },
        select: { confirmationCode: true },
      });
      await writeAuditLog({
        eventId,
        actorUserId: station.starter.id,
        action: balanceReasonAction,
        entityType: "Registration",
        entityId: input.registrationId,
        summary: `Checked in with a balance due on registration ${registration?.confirmationCode ?? input.registrationId}: ${stationBalanceReasonLabel(reason.code)}${stationSummarySuffix(station.station.label)}.`,
        metadata: {
          reasonCode: reason.code,
          note: reason.note.trim(),
          balanceCents: summary.balanceCents,
          channel: "CHECK_IN_STATION",
          station: { id: station.station.id, label: station.station.label },
        },
      });
    } catch (error) {
      logError("Station balance reason audit failed", error);
    }
  }
  return results;
}

function unitDisplayName(unit: { name: string; building: { name: string } }) {
  return `${unit.name}${unit.building.name && unit.building.name !== unit.name ? `, ${unit.building.name}` : ""}`;
}

/**
 * What to put in the family's hands after a check-in: one name badge each, and a room key line for every
 * room-linked item type of the event, per room the newly checked-in people are housed in. Event-scoped and only about
 * the people given (the ones newly checked in by this request); it returns no names and no other data.
 */
export type StationHandOut = {
  /** The finished lines: "Name badge × 2", "Cabin key K-204". */
  lines: string[];
  /** The room-linked item type names, and each person's room label, so the screen can adjust after an undo. */
  keyTypes: string[];
  rooms: Array<{ attendeeId: string; label: string }>;
};

export async function stationHandOutList(station: ResolvedStation, newlyCheckedInIds: string[]): Promise<StationHandOut> {
  const ids = [...new Set(newlyCheckedInIds)];
  if (ids.length === 0) return { lines: [], keyTypes: [], rooms: [] };
  const eventId = station.station.eventId;
  const prisma = getPrisma();
  const badge = [stationBadgeLine(ids.length)];
  const types = await prisma.issuedAssetType.findMany({
    where: { eventId, active: true, roomLinked: true },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  if (types.length === 0) return { lines: badge, keyTypes: [], rooms: [] };
  const assignments = await prisma.eventLodgingAssignment.findMany({
    where: { eventId, attendeeId: { in: ids }, cancelledAt: null, eventLodgingUnitId: { not: null } },
    select: { attendeeId: true, eventLodgingUnitId: true },
  });
  const keyTypes = types.map((type) => type.name);
  const unitIds = [...new Set(assignments.map((row) => row.eventLodgingUnitId).filter((id): id is string => Boolean(id)))];
  if (unitIds.length === 0) return { lines: badge, keyTypes, rooms: [] };
  const units = await prisma.eventLodgingUnit.findMany({
    where: { eventId, id: { in: unitIds } },
    select: { id: true, unit: { select: { name: true, building: { select: { name: true } } } } },
  });
  const labelByUnit = new Map(units.map((row) => [row.id, unitDisplayName(row.unit)]));
  const rooms = assignments.flatMap((row) => {
    const label = row.eventLodgingUnitId ? labelByUnit.get(row.eventLodgingUnitId) : undefined;
    return row.attendeeId && label ? [{ attendeeId: row.attendeeId, label }] : [];
  });
  const labels = [...new Set(rooms.map((room) => room.label))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const lines = [...badge];
  for (const type of keyTypes) {
    for (const label of labels) lines.push(`${type} ${label}`);
  }
  return { lines, keyTypes, rooms };
}

/**
 * Undo at the station: only a check-in made by this same station, so the desk's and other stations' work is never
 * undone from a tablet. The check-in's own audit entry says which station made it.
 */
export async function undoStationCheckIn(station: ResolvedStation, attendeeId: string) {
  if (!station.capabilities.canCheckIn) throw new StationServiceError("PERMISSION_DENIED");
  const eventId = station.station.eventId;
  const prisma = getPrisma();
  const attendee = await prisma.registrationAttendee.findFirst({
    where: { id: attendeeId, eventId },
    select: { id: true },
  });
  if (!attendee) throw new StationServiceError("NOT_FOUND");
  const active = await prisma.checkIn.findFirst({
    where: { eventId, registrationAttendeeId: attendeeId, undoneAt: null },
    orderBy: { checkedInAt: "desc" },
    select: { id: true, checkedInAt: true },
  });
  if (!active) throw new StationServiceError("NOTHING_TO_UNDO");
  const entry = await prisma.auditLog.findFirst({
    where: {
      eventId,
      action: "ATTENDEE_CHECKED_IN",
      entityType: "RegistrationAttendee",
      entityId: attendeeId,
      createdAt: { gte: active.checkedInAt },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  const metadata = entry?.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
    ? entry.metadata as { station?: { id?: unknown } }
    : {};
  if (metadata.station?.id !== station.station.id) throw new StationServiceError("NOT_THIS_STATION");
  const undone = await undoCheckIn(eventId, attendeeId, station.starter.id, {
    auditContext: { station: { id: station.station.id, label: station.station.label } },
    expectedCheckInId: active.id,
  });
  if (!undone) throw new StationServiceError("NOTHING_TO_UNDO");
  return { undone: true as const, attendeeId };
}

async function requirePayableRegistration(station: ResolvedStation, registrationId: string) {
  await refuseClubRegistration(station.station.eventId, registrationId);
  const summary = await paymentSummaryFor(station.station.eventId, registrationId);
  if (summary.state === "BILLED_TO_GROUP") throw new StationServiceError("BILLED_TO_GROUP");
  if (summary.state === "PAID") throw new StationServiceError("NOTHING_DUE");
  return summary;
}

/** Cash or check received at the station, recorded by the existing audited service under the starter's account. */
export async function recordStationPayment(
  station: ResolvedStation,
  input: { registrationId: string; method: "CASH" | "CHECK"; amountCents: number; checkNumber: string; idempotencyKey: string },
): Promise<StationPaymentSummary> {
  const eventId = station.station.eventId;
  // A retry after a lost response must get the saved payment back, whatever the balance is now: decided first,
  // before the paid, club and amount checks that a retry would otherwise fail.
  const reference = input.method === "CHECK" ? input.checkNumber : "";
  if (await findPaymentReplay(getPrisma(), eventId, input.registrationId, { ...input, reference })) {
    return paymentSummaryFor(eventId, input.registrationId);
  }
  const summary = await requirePayableRegistration(station, input.registrationId);
  if (summary.state === "DUE" && input.amountCents > summary.balanceCents) {
    throw new PaymentOperationError("PAYMENT_EXCEEDS_BALANCE");
  }
  await recordManualPayment(
    eventId,
    input.registrationId,
    station.starter.id,
    {
      amountCents: input.amountCents,
      method: input.method,
      reference,
      idempotencyKey: input.idempotencyKey,
    },
    { station: { id: station.station.id, label: station.station.label } },
  );
  return paymentSummaryFor(eventId, input.registrationId);
}

/**
 * "Paid by card in Square app": an audit note only. No Payment row is created, so finance attaching the real
 * Square payment under Unmatched Square payments cannot double count it.
 */
export async function noteStationSquareAppPayment(
  station: ResolvedStation,
  input: { registrationId: string; amountCents: number; receiptNumber: string },
): Promise<StationPaymentSummary> {
  const eventId = station.station.eventId;
  const summary = await requirePayableRegistration(station, input.registrationId);
  if (summary.state === "DUE" && input.amountCents > summary.balanceCents) {
    throw new PaymentOperationError("PAYMENT_EXCEEDS_BALANCE");
  }
  const registration = await getPrisma().registration.findFirst({
    where: { id: input.registrationId, eventId },
    select: { confirmationCode: true },
  });
  if (!registration) throw new StationServiceError("NOT_FOUND");
  await writeAuditLog({
    eventId,
    actorUserId: station.starter.id,
    action: squareNoteAction,
    entityType: "Registration",
    entityId: input.registrationId,
    summary: `Noted a card payment taken in the Square app on registration ${registration.confirmationCode}${stationSummarySuffix(station.station.label)}; finance still needs to match it.`,
    metadata: {
      amountCents: input.amountCents,
      ...(input.receiptNumber ? { receiptNumber: input.receiptNumber } : {}),
      needsReconciliation: true,
      channel: "CHECK_IN_STATION",
      station: { id: station.station.id, label: station.station.label },
    },
  });
  return paymentSummaryFor(eventId, input.registrationId);
}

/** Today's unmatched Square findings that Square ties to this one registration, and nothing else. */
async function unmatchedForRegistration(eventId: string, registrationId: string) {
  const report = await listUnmatchedSquarePayments({ eventId, days: 1 });
  if (report.unreachableSquare) return null;
  return report.findings.filter((finding) => finding.registrationId === registrationId);
}

async function registrationHasPayment(eventId: string, registrationId: string) {
  const count = await getPrisma().payment.count({ where: { eventId, registrationId, status: "SUCCEEDED" } });
  return count > 0;
}

/**
 * Today's unmatched Square payments that Square ties to this one registration, and nothing else: no note, no
 * reference, no order, no unattributed payment. `unavailable` is true when Square is not set up or not reachable,
 * so the screen can fall back to "note it for finance". `alreadyHasPayment` is true when the registration already
 * shows money; those are matched by finance, so no candidates are offered.
 */
export async function listStationSquareCandidates(
  station: ResolvedStation,
  registrationId: string,
): Promise<{ candidates: StationSquareCandidate[]; unavailable: boolean; alreadyHasPayment: boolean }> {
  const eventId = station.station.eventId;
  const summary = await requirePayableRegistration(station, registrationId);
  if (summary.state !== "DUE") return { candidates: [], unavailable: false, alreadyHasPayment: false };
  if (await registrationHasPayment(eventId, registrationId)) {
    return { candidates: [], unavailable: false, alreadyHasPayment: true };
  }
  try {
    const findings = await unmatchedForRegistration(eventId, registrationId);
    if (!findings) return { candidates: [], unavailable: true, alreadyHasPayment: false };
    const registration = await getPrisma().registration.findFirst({
      where: { id: registrationId, eventId },
      select: { event: { select: { timezone: true } } },
    });
    const timeZone = registration?.event?.timezone || "UTC";
    return {
      unavailable: false,
      alreadyHasPayment: false,
      candidates: findings.map((finding) => ({
        providerPaymentId: finding.providerPaymentId,
        amountCents: finding.amountCents,
        whenLabel: finding.createdAt
          ? formatInTimeZone(finding.createdAt, timeZone, { hour: "numeric", minute: "2-digit" })
          : "",
        overBalance: finding.amountCents > summary.balanceCents,
      })),
    };
  } catch (error) {
    if (error instanceof SquareMatchOperationError) return { candidates: [], unavailable: true, alreadyHasPayment: false };
    throw error;
  }
}

/**
 * Attaches one listed Square payment to the registration. The payment must be in today's list for this very
 * registration, so a posted id cannot attach someone else's payment. The duplicate acknowledgement is never sent:
 * a registration that already shows money goes to finance instead.
 */
export async function matchStationSquarePayment(
  station: ResolvedStation,
  input: { registrationId: string; providerPaymentId: string },
): Promise<StationPaymentSummary> {
  const eventId = station.station.eventId;
  await requirePayableRegistration(station, input.registrationId);
  const findings = await unmatchedForRegistration(eventId, input.registrationId);
  if (!findings) throw new SquareMatchOperationError("SQUARE_UNREACHABLE", "Square could not be reached.");
  if (!findings.some((finding) => finding.providerPaymentId === input.providerPaymentId)) {
    throw new StationServiceError("PAYMENT_NOT_LISTED");
  }
  await attachSquarePaymentToRegistration(
    eventId,
    input.registrationId,
    station.starter.id,
    {
      providerPaymentId: input.providerPaymentId,
      note: `Matched at check-in station ${station.station.label.trim() || "(unnamed)"}`,
    },
    { auditContext: { station: { id: station.station.id, label: station.station.label } } },
  );
  return paymentSummaryFor(eventId, input.registrationId);
}
