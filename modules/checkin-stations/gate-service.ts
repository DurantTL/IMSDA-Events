import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { formatPersonName } from "@/lib/person-name";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { gateSterlingStatusForAttendees } from "@/modules/background-checks/repository";
import { AttendeePassResolutionError } from "@/modules/checkin/attendee-pass-repository";
import { resolvePassLookupForEvent } from "@/modules/checkin/pass-lookup";
import { formatInTimeZone } from "@/modules/calendar/conference-format";
import {
  GATE_RESULT_LIMIT,
  gateStateFor,
  stationSummarySuffix,
  type GateArrivalResponse,
  type GateLookupResponse,
  type GateResult,
} from "@/modules/checkin-stations/domain";
import { CheckInStationError, type ResolvedStation } from "@/modules/checkin-stations/repository";
import { StationServiceError } from "@/modules/checkin-stations/service";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";

const CLUB_PASS_MESSAGE = "This club pass does not name one person. Search the person's name instead.";

/** "3:42 PM CDT": the time of day in the event's own zone, zone named. */
function gateTimeLabel(at: Date, timeZone: string) {
  try {
    return formatInTimeZone(at, timeZone, { hour: "numeric", minute: "2-digit" });
  } catch {
    return formatInTimeZone(at, "UTC", { hour: "numeric", minute: "2-digit" });
  }
}

/** Whether staff have gate mode on for this event. Read on every request; nothing is cached. */
export async function isGateModeEnabled(eventId: string) {
  const event = await getPrisma().event.findUnique({
    where: { id: eventId },
    select: { checkInGateModeEnabled: true },
  });
  return event?.checkInGateModeEnabled === true;
}

async function requireGateMode(eventId: string) {
  const event = await getPrisma().event.findUnique({
    where: { id: eventId },
    select: { checkInGateModeEnabled: true, timezone: true },
  });
  if (!event?.checkInGateModeEnabled) throw new StationServiceError("GATE_MODE_OFF");
  return { timeZone: event.timezone || "UTC" };
}

/**
 * Staff switch gate mode on or off for one event (the caller has already proven MANAGE_CHECK_IN). Setting what it
 * already is changes nothing and writes no audit entry. Turning it off hides gate mode; arrivals already logged stay.
 */
export async function setGateMode(eventId: string, actorUserId: string, enabled: boolean) {
  const prisma = getPrisma();
  const changed = await prisma.event.updateMany({
    where: { id: eventId, checkInGateModeEnabled: !enabled },
    data: { checkInGateModeEnabled: enabled },
  });
  if (changed.count === 0) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new CheckInStationError("EVENT_NOT_FOUND");
    return { enabled, changed: false };
  }
  await writeAuditLog({
    eventId,
    actorUserId,
    action: enabled ? "CHECK_IN_GATE_MODE_ENABLED" : "CHECK_IN_GATE_MODE_DISABLED",
    entityType: "Event",
    entityId: eventId,
    summary: enabled ? "Turned on gate mode for check-in stations." : "Turned off gate mode for check-in stations.",
    metadata: { enabled },
  });
  return { enabled, changed: true };
}

/** Attendee ids of this event's active registrations that a name matches, ordered by name, one more than the limit. */
async function attendeeIdsMatchingName(eventId: string, name: string) {
  const tokens = name.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const haystack = Prisma.sql`lower(concat_ws(' ', p."firstName", p."lastName", a."profileSnapshot"->>'firstName', a."profileSnapshot"->>'lastName'))`;
  const conditions = tokens.map((token) => Prisma.sql`position(${token} in ${haystack}) > 0`);
  const rows = await getPrisma().$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT a."id"
    FROM "RegistrationAttendee" a
    JOIN "Person" p ON p."id" = a."personId"
    JOIN "Registration" r ON r."id" = a."registrationId"
    WHERE a."eventId" = ${eventId}
      AND r."status"::text IN (${Prisma.join([...activeRegistrationStatuses])})
      AND ${Prisma.join(conditions, " AND ")}
    ORDER BY lower(coalesce(nullif(a."profileSnapshot"->>'lastName', ''), p."lastName")),
             lower(coalesce(nullif(a."profileSnapshot"->>'firstName', ''), p."firstName")),
             a."id"
    LIMIT ${GATE_RESULT_LIMIT + 1}
  `);
  return rows.map((row) => row.id);
}

function snapshotName(value: unknown, fallback: string, key: "firstName" | "lastName") {
  const snapshot = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = snapshot[key];
  return typeof text === "string" && text.trim() ? text.trim() : fallback;
}

/** Builds the minimal result rows for these attendee ids, all inside this event's active registrations. */
async function gateResultsFor(eventId: string, timeZone: string, ids: string[]): Promise<GateResult[]> {
  if (ids.length === 0) return [];
  const attendees = await getPrisma().registrationAttendee.findMany({
    where: { id: { in: ids }, eventId, registration: { status: { in: [...activeRegistrationStatuses] } } },
    select: {
      id: true,
      profileSnapshot: true,
      person: { select: { firstName: true, lastName: true } },
      registration: { select: { clubRegistration: { select: { organization: { select: { name: true } } } } } },
      gateArrivals: { where: { eventId }, orderBy: { arrivedAt: "desc" }, take: 1, select: { arrivedAt: true } },
    },
  });
  const sterling = await gateSterlingStatusForAttendees(eventId, attendees.map((attendee) => attendee.id));
  const rows = attendees.map((attendee) => {
    const firstName = snapshotName(attendee.profileSnapshot, attendee.person.firstName, "firstName");
    const lastName = snapshotName(attendee.profileSnapshot, attendee.person.lastName, "lastName");
    const sterlingCurrent = sterling.has(attendee.id) ? sterling.get(attendee.id) ?? null : null;
    const arrival = attendee.gateArrivals[0];
    return {
      sortKey: `${lastName}\u0000${firstName}`.toLowerCase(),
      result: {
        attendeeId: attendee.id,
        displayName: formatPersonName({ firstName, lastName }),
        clubName: attendee.registration.clubRegistration?.organization.name ?? null,
        sterlingCurrent,
        state: gateStateFor(sterlingCurrent),
        arrivedAtLabel: arrival ? gateTimeLabel(arrival.arrivedAt, timeZone) : null,
      } satisfies GateResult,
    };
  });
  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((row) => row.result);
}

async function auditGateLookup(
  station: ResolvedStation,
  method: "PASS" | "NAME",
  attendeeIds: string[],
) {
  await writeAuditLog({
    eventId: station.station.eventId,
    actorUserId: station.starter.id,
    action: "CHECK_IN_GATE_LOOKUP",
    entityType: "Event",
    entityId: station.station.eventId,
    summary: `Looked up a person at the gate by ${method === "PASS" ? "pass" : "name"}${stationSummarySuffix(station.station.label)}: ${attendeeIds.length} found.`,
    // Never the typed text and never a name: only who the station matched, by id.
    metadata: {
      channel: "CHECK_IN_STATION",
      station: { id: station.station.id, label: station.station.label },
      method,
      resultCount: attendeeIds.length,
      attendeeIds,
    },
  });
}

/**
 * One gate lookup for this station's event: a scanned pass or a typed name. Gate mode is re-checked here on every
 * call. The response carries only name, club, Sterling status for adults at an event that checks, and the latest
 * gate arrival time, never anything else about the person.
 */
export async function gateLookup(
  station: ResolvedStation,
  lookup: { kind: "pass" | "name"; value: string },
): Promise<GateLookupResponse> {
  const eventId = station.station.eventId;
  const { timeZone } = await requireGateMode(eventId);
  const method = lookup.kind === "pass" ? "PASS" : "NAME";

  let ids: string[];
  let moreAvailable = false;
  if (lookup.kind === "pass") {
    let scanned: string | null;
    try {
      const resolved = await resolvePassLookupForEvent(eventId, { kind: "pass", value: lookup.value });
      scanned = ("scannedAttendeeId" in resolved ? resolved.scannedAttendeeId : undefined) ?? (resolved.attendees.length === 1 ? resolved.attendees[0].id : null);
    } catch (error) {
      if (error instanceof AttendeePassResolutionError) {
        if (error.code === "REGISTRATION_NOT_ELIGIBLE") {
          await auditGateLookup(station, method, []);
          return { outcome: "NOT_REGISTERED", results: [], moreAvailable: false, message: null };
        }
        throw new StationServiceError(error.code === "PASS_EXPIRED" ? "PASS_EXPIRED" : "NOT_FOUND");
      }
      throw error;
    }
    if (!scanned) {
      await auditGateLookup(station, method, []);
      return { outcome: "SEARCH_BY_NAME", results: [], moreAvailable: false, message: CLUB_PASS_MESSAGE };
    }
    ids = [scanned];
  } else {
    const found = await attendeeIdsMatchingName(eventId, lookup.value);
    moreAvailable = found.length > GATE_RESULT_LIMIT;
    ids = found.slice(0, GATE_RESULT_LIMIT);
  }

  const results = await gateResultsFor(eventId, timeZone, ids);
  await auditGateLookup(station, method, results.map((result) => result.attendeeId));
  return {
    outcome: results.length > 0 ? "MATCHES" : "NOT_REGISTERED",
    results,
    moreAvailable,
    message: null,
  };
}

/**
 * Notes "arrived at gate" for one person of this event, separate from check-in: it never creates a check-in. A retry
 * with the same key gets the saved time back and writes no second row or audit entry.
 */
export async function recordGateArrival(
  station: ResolvedStation,
  input: { attendeeId: string; idempotencyKey: string },
): Promise<GateArrivalResponse> {
  const eventId = station.station.eventId;
  const { timeZone } = await requireGateMode(eventId);
  const prisma = getPrisma();

  const existing = await prisma.checkInGateArrival.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { eventId: true, attendeeId: true, arrivedAt: true },
  });
  if (existing) {
    if (existing.eventId !== eventId || existing.attendeeId !== input.attendeeId) throw new StationServiceError("NOT_FOUND");
    return { attendeeId: input.attendeeId, arrivedAtLabel: gateTimeLabel(existing.arrivedAt, timeZone) };
  }

  const attendee = await prisma.registrationAttendee.findFirst({
    where: { id: input.attendeeId, eventId, registration: { status: { in: [...activeRegistrationStatuses] } } },
    select: { id: true },
  });
  if (!attendee) throw new StationServiceError("NOT_FOUND");

  let arrival: { id: string; arrivedAt: Date };
  try {
    arrival = await prisma.checkInGateArrival.create({
      data: {
        eventId,
        attendeeId: attendee.id,
        stationId: station.station.id,
        recordedByUserId: station.starter.id,
        idempotencyKey: input.idempotencyKey,
      },
      select: { id: true, arrivedAt: true },
    });
  } catch (error) {
    // Two taps at once: the other one won the unique key, so hand back its row.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.checkInGateArrival.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { eventId: true, attendeeId: true, arrivedAt: true },
      });
      if (winner && winner.eventId === eventId && winner.attendeeId === attendee.id) {
        return { attendeeId: attendee.id, arrivedAtLabel: gateTimeLabel(winner.arrivedAt, timeZone) };
      }
    }
    throw error;
  }
  await writeAuditLog({
    eventId,
    actorUserId: station.starter.id,
    action: "CHECK_IN_GATE_ARRIVAL_RECORDED",
    entityType: "RegistrationAttendee",
    entityId: attendee.id,
    summary: `Logged an arrival at the gate${stationSummarySuffix(station.station.label)}.`,
    metadata: {
      channel: "CHECK_IN_STATION",
      station: { id: station.station.id, label: station.station.label },
      arrivalId: arrival.id,
    },
  });
  return { attendeeId: attendee.id, arrivedAtLabel: gateTimeLabel(arrival.arrivedAt, timeZone) };
}
