import "server-only";

import { cookies } from "next/headers";
import { getPrisma } from "@/lib/prisma";
import {
  AccessDeniedError,
  effectivePermissions,
  requireEventMembership,
  type AuthenticatedUser,
} from "@/modules/access/authorization";
import type { EventPermission } from "@/modules/access/permissions";
import { createOpaqueToken, hashOpaqueToken } from "@/modules/access/tokens";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  CHECK_IN_STATION_COOKIE_NAME,
  STATION_START_LEAD_MS,
  shouldTouchStation,
  stationCapabilities,
  stationInvalidReason,
  stationEndsAt,
  stationStartProblem,
  type StationCapabilities,
  type StationInvalidReason,
  type StationStartProblem,
} from "@/modules/checkin-stations/domain";
import { hasEventEnded } from "@/modules/events/lifecycle";
import { findActiveMembership } from "@/modules/events/repository";

export class CheckInStationError extends Error {
  constructor(
    public readonly code: StationStartProblem | "EVENT_NOT_FOUND" | "STATION_NOT_FOUND",
  ) {
    super(
      code === "TOO_EARLY"
        ? "A check-in station can be started up to two days before the event begins."
        : code === "EVENT_ENDED"
          ? "This event has ended, so a check-in station cannot be started."
          : code === "STATION_NOT_FOUND"
            ? "That check-in station was not found or is already stopped."
            : "The event was not found.",
    );
    this.name = "CheckInStationError";
  }
}

export type ResolvedStation = {
  station: { id: string; eventId: string; label: string; expiresAt: Date };
  eventName: string;
  starter: { id: string; displayName: string };
  permissions: EventPermission[];
  capabilities: StationCapabilities;
};

/**
 * Starts a station for one event on the calling device. The caller has already proven an ordinary staff session
 * with MANAGE_CHECK_IN on this event; nothing from that session is copied, the station gets its own random token
 * and only the token's hash is stored.
 */
export async function startStation(
  eventId: string,
  starter: AuthenticatedUser,
  label: string,
  now = new Date(),
) {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, startsAt: true, endsAt: true, timezone: true },
  });
  if (!event) throw new CheckInStationError("EVENT_NOT_FOUND");
  const problem = stationStartProblem(event, now);
  if (problem) throw new CheckInStationError(problem);

  const token = createOpaqueToken();
  const station = await prisma.checkInStation.create({
    data: {
      eventId,
      startedByUserId: starter.id,
      label,
      tokenHash: hashOpaqueToken(token),
      expiresAt: stationEndsAt(event),
      lastSeenAt: now,
    },
    select: { id: true, label: true, expiresAt: true },
  });
  await writeAuditLog({
    eventId,
    actorUserId: starter.id,
    action: "CHECK_IN_STATION_STARTED",
    entityType: "CheckInStation",
    entityId: station.id,
    summary: "Started a check-in station.",
    metadata: { channel: "CHECK_IN_STATION", station: { id: station.id, label: station.label } },
  });
  return { token, station };
}

/** The starter's permissions on the event right now, or null when they no longer belong to it. */
async function currentPermissions(
  user: AuthenticatedUser,
  eventId: string,
): Promise<EventPermission[] | null> {
  try {
    const { membership } = await requireEventMembership({ user }, eventId, findActiveMembership);
    return effectivePermissions(user, membership);
  } catch (error) {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  }
}

export type StationResolution =
  | { ok: true; resolved: ResolvedStation }
  | { ok: false; reason: StationInvalidReason | "UNKNOWN" };

/**
 * Resolves a station token. Every call re-evaluates the starter, so a disabled account, a lost membership or a
 * removed MANAGE_CHECK_IN permission ends the station at once. There is no idle timeout.
 */
export async function resolveStationToken(
  token: string | undefined,
  now = new Date(),
): Promise<StationResolution> {
  if (!token) return { ok: false, reason: "UNKNOWN" };
  const tokenHash = hashOpaqueToken(token);
  const row = await getPrisma().checkInStation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      eventId: true,
      label: true,
      expiresAt: true,
      lastSeenAt: true,
      revokedAt: true,
      stoppedAt: true,
      event: { select: { name: true, startsAt: true, endsAt: true, timezone: true } },
      startedBy: {
        select: {
          id: true,
          email: true,
          displayName: true,
          globalRole: true,
          accountStatus: true,
          credential: { select: { disabledAt: true } },
        },
      },
    },
  });
  if (!row) return { ok: false, reason: "UNKNOWN" };

  const user: AuthenticatedUser = {
    id: row.startedBy.id,
    email: row.startedBy.email,
    displayName: row.startedBy.displayName,
    globalRole: row.startedBy.globalRole,
  };
  const record = {
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    stoppedAt: row.stoppedAt,
    // The event's current dates decide too, so editing them after the station started moves its end.
    eventEnded: hasEventEnded({ endsAt: row.event.endsAt, timezone: row.event.timezone }, now),
    eventNotOpen: now.getTime() < row.event.startsAt.getTime() - STATION_START_LEAD_MS,
    starter: {
      accountStatus: row.startedBy.accountStatus,
      hasCredential: Boolean(row.startedBy.credential),
      credentialDisabledAt: row.startedBy.credential?.disabledAt ?? null,
    },
  };
  // The cheap checks first; the membership read only happens for a station that is otherwise usable.
  const early = stationInvalidReason(record, ["MANAGE_CHECK_IN"], now);
  if (early && early !== "PERMISSION_LOST") return { ok: false, reason: early };
  const permissions = await currentPermissions(user, row.eventId);
  const reason = stationInvalidReason(record, permissions, now);
  if (reason || !permissions) return { ok: false, reason: reason ?? "PERMISSION_LOST" };

  if (shouldTouchStation(row.lastSeenAt, now)) {
    await getPrisma().checkInStation.updateMany({
      where: { id: row.id, revokedAt: null, stoppedAt: null, lastSeenAt: row.lastSeenAt },
      data: { lastSeenAt: now },
    });
  }
  return {
    ok: true,
    resolved: {
      station: { id: row.id, eventId: row.eventId, label: row.label, expiresAt: row.expiresAt },
      eventName: row.event.name,
      starter: { id: user.id, displayName: user.displayName },
      permissions,
      capabilities: stationCapabilities(permissions),
    },
  };
}

/** The station for this request's cookie, or null. */
export async function resolveStation(now = new Date()): Promise<ResolvedStation | null> {
  const token = (await cookies()).get(CHECK_IN_STATION_COOKIE_NAME)?.value;
  const result = await resolveStationToken(token, now);
  return result.ok ? result.resolved : null;
}

/** Stops the station on this device. Idempotent: a second stop changes nothing and writes no second entry. */
export async function stopStation(resolved: ResolvedStation, now = new Date()) {
  const stopped = await getPrisma().checkInStation.updateMany({
    where: { id: resolved.station.id, stoppedAt: null, revokedAt: null },
    data: { stoppedAt: now },
  });
  if (stopped.count !== 1) return false;
  await writeAuditLog({
    eventId: resolved.station.eventId,
    actorUserId: resolved.starter.id,
    action: "CHECK_IN_STATION_STOPPED",
    entityType: "CheckInStation",
    entityId: resolved.station.id,
    summary: "Stopped a check-in station from its device.",
    metadata: { channel: "CHECK_IN_STATION", station: { id: resolved.station.id, label: resolved.station.label } },
  });
  return true;
}

/** Stops whatever station a device already holds, so starting a new one does not leave the old one active. */
export async function stopStationByToken(token: string | undefined, now = new Date()) {
  if (!token) return;
  const row = await getPrisma().checkInStation.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: { id: true, eventId: true, label: true, startedByUserId: true },
  });
  if (!row) return;
  const stopped = await getPrisma().checkInStation.updateMany({
    where: { id: row.id, stoppedAt: null, revokedAt: null },
    data: { stoppedAt: now },
  });
  if (stopped.count !== 1) return;
  await writeAuditLog({
    eventId: row.eventId,
    actorUserId: row.startedByUserId,
    action: "CHECK_IN_STATION_STOPPED",
    entityType: "CheckInStation",
    entityId: row.id,
    summary: "Stopped a check-in station because a new one was started on the same device.",
    metadata: { channel: "CHECK_IN_STATION", station: { id: row.id, label: row.label } },
  });
}

/** Revokes a station from the staff workspace. The caller has proven MANAGE_CHECK_IN on `eventId`. */
export async function revokeStation(
  eventId: string,
  stationId: string,
  actorUserId: string,
  now = new Date(),
) {
  const station = await getPrisma().checkInStation.findFirst({
    where: { id: stationId, eventId },
    select: { id: true, label: true },
  });
  if (!station) throw new CheckInStationError("STATION_NOT_FOUND");
  const revoked = await getPrisma().checkInStation.updateMany({
    where: { id: station.id, eventId, revokedAt: null, stoppedAt: null },
    data: { revokedAt: now, revokedByUserId: actorUserId },
  });
  if (revoked.count !== 1) throw new CheckInStationError("STATION_NOT_FOUND");
  await writeAuditLog({
    eventId,
    actorUserId,
    action: "CHECK_IN_STATION_REVOKED",
    entityType: "CheckInStation",
    entityId: station.id,
    summary: "Revoked a check-in station.",
    metadata: { station: { id: station.id, label: station.label } },
  });
}

export type ActiveStationRow = {
  id: string;
  label: string;
  startedByName: string;
  startedAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

/** Stations that are not stopped, revoked or expired for one event, newest first. */
export async function listActiveStations(eventId: string, now = new Date()): Promise<ActiveStationRow[]> {
  const rows = await getPrisma().checkInStation.findMany({
    where: { eventId, revokedAt: null, stoppedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      startedBy: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    startedByName: row.startedBy.displayName,
    startedAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}
