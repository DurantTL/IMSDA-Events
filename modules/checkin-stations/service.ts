import "server-only";

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
import { CheckInOperationError, checkInAttendee } from "@/modules/checkin/repository";
import {
  stationPaymentSummary,
  stationSummarySuffix,
  type StationCheckInResult,
  type StationFamily,
  type StationPaymentSummary,
} from "@/modules/checkin-stations/domain";
import type { ResolvedStation } from "@/modules/checkin-stations/repository";
import { sealHealthSnapshotAfterCheckIn } from "@/modules/health-records/snapshot-hooks";
import { PaymentOperationError, recordManualPayment } from "@/modules/payments/repository";
import { attendeeBalanceCents } from "@/modules/registrations/finance-view";
import { registrationBalanceCents } from "@/modules/payments/square-domain";

export class StationServiceError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "PASS_EXPIRED"
      | "SEND_TO_DESK"
      | "BILLED_TO_GROUP"
      | "NOTHING_DUE",
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
              : "Nothing is due on this registration.",
    );
    this.name = "StationServiceError";
  }
}

const squareNoteAction = "CHECK_IN_STATION_SQUARE_APP_NOTED";

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
  input: { registrationId: string; items: Array<{ attendeeId: string; idempotencyKey: string }> },
): Promise<StationCheckInResult[]> {
  const eventId = station.station.eventId;
  await refuseClubRegistration(eventId, input.registrationId);
  const ids = [...new Set(input.items.map((item) => item.attendeeId))];
  const found = await getPrisma().registrationAttendee.findMany({
    where: { id: { in: ids }, eventId, registrationId: input.registrationId },
    select: { id: true },
  });
  if (found.length !== ids.length) throw new StationServiceError("NOT_FOUND");

  const results: StationCheckInResult[] = [];
  for (const item of input.items) {
    try {
      const operation = await checkInAttendee(
        eventId,
        item.attendeeId,
        station.starter.id,
        item.idempotencyKey,
        { auditContext: { station: { id: station.station.id, label: station.station.label } } },
      );
      if (operation.checkedIn) await sealHealthSnapshotAfterCheckIn(eventId, item.attendeeId);
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
  return results;
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
      reference: input.method === "CHECK" ? input.checkNumber : "",
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
