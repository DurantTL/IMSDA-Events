import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { listPublicCalendarItems } from "@/modules/calendar/repository";
import { firstOfMonth, lastOfMonth, monthKey, parseMonthParam, shiftMonth, type CalendarMonth } from "@/modules/calendar/domain";
import {
  CLUB_CALENDAR_FEATURE_KEY,
  REMINDER_DAYS_DEFAULT,
  buildAgenda,
  canManageClubCalendar,
  conferenceToday,
  clubCalendarKindLabels,
  type AgendaEntry,
  type ClubCalendarKind,
  type ClubItemRow,
} from "@/modules/club-calendar/domain";
import type { ClubCalendarItemInput, ClubCalendarReminderSettingInput } from "@/modules/club-calendar/schemas";
import { isClubFeatureEnabled } from "@/modules/club-features/repository";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

/**
 * The optional club calendar (#1700). The callers (the page, the route handlers) have already checked the club role;
 * every function here also needs the feature switched on, and every write needs the director or deputy capability
 * again, so a write can never go through on the strength of a page that hid a button. Every add, edit, delete and
 * reminder change is audited with ids and the kind only, never the title, place or notes.
 */

/** Who changed it: the attendee account of a director or deputy, or a staff user acting as the club's director (#442). */
export type ClubCalendarActor = { accountId: string } | { userId: string; actAsId?: string; viaClubsAdministrator?: true };

export class ClubCalendarError extends Error {
  constructor(public readonly code: "FEATURE_OFF" | "ITEM_NOT_FOUND" | "NOT_ALLOWED", message: string) {
    super(message);
    this.name = "ClubCalendarError";
  }
}

export type ReminderSettingView = { enabled: boolean; daysBefore: number };

export type ClubCalendarView = {
  month: CalendarMonth;
  monthKey: string;
  previousMonthKey: string;
  nextMonthKey: string;
  todayMonthKey: string;
  agenda: AgendaEntry[];
  canManage: boolean;
  /** Only for a viewer who can change it; other roles are not shown the setting. */
  reminder: ReminderSettingView | null;
};

/** Anyone with an active club role can see the calendar (the page's access check says who that is); it also needs the feature on. */
export async function clubCalendarAvailable(organizationId: string): Promise<boolean> {
  return isClubFeatureEnabled(organizationId, CLUB_CALENDAR_FEATURE_KEY);
}

export async function readReminderSetting(organizationId: string): Promise<ReminderSettingView> {
  const row = await getPrisma().clubCalendarReminderSetting.findUnique({ where: { organizationId }, select: { enabled: true, daysBefore: true } });
  return row ?? { enabled: false, daysBefore: REMINDER_DAYS_DEFAULT };
}

/** The month agenda for this club, or null when the club has not switched the calendar on. */
export async function loadClubCalendar(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  monthParam: string | undefined,
  now = new Date(),
): Promise<ClubCalendarView | null> {
  if (!(await clubCalendarAvailable(organizationId))) return null;
  const today = conferenceToday(now);
  const month = parseMonthParam(monthParam, today);
  const from = firstOfMonth(month);
  const to = lastOfMonth(month);
  const [rows, conferenceItems, reminder] = await Promise.all([
    getPrisma().clubCalendarItem.findMany({
      where: { organizationId, date: { gte: from, lte: to } },
      select: { id: true, kind: true, title: true, date: true, startTime: true, endTime: true, location: true, notes: true },
    }),
    listPublicCalendarItems(from, to, now),
    canManageClubCalendar(capabilities) ? readReminderSetting(organizationId) : Promise.resolve(null),
  ]);
  const clubItems: ClubItemRow[] = rows.map((row) => ({ ...row, kind: row.kind as ClubCalendarKind }));
  const [todayYear, todayMonth] = today.split("-").map(Number);
  return {
    month,
    monthKey: monthKey(month),
    previousMonthKey: monthKey(shiftMonth(month, -1)),
    nextMonthKey: monthKey(shiftMonth(month, 1)),
    todayMonthKey: monthKey({ year: todayYear!, month: todayMonth! }),
    agenda: buildAgenda({ clubItems, conferenceItems, from, to }),
    canManage: canManageClubCalendar(capabilities),
    reminder,
  };
}

function actorFields(actor: ClubCalendarActor) {
  return "accountId" in actor ? { accountId: actor.accountId, userId: null } : { accountId: null, userId: actor.userId };
}

function auditActor(actor: ClubCalendarActor) {
  return "accountId" in actor
    ? { metadata: { actorAttendeeAccountId: actor.accountId } }
    : {
      actorUserId: actor.userId,
      metadata: { ...(actor.actAsId ? { actAsId: actor.actAsId } : {}), ...(actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}) },
    };
}

type Tx = Parameters<Parameters<ReturnType<typeof getPrisma>["$transaction"]>[0]>[0];

/** Inside a write: the club is an active club, the feature is on and the actor's capability still includes writes. */
async function guardWrite(tx: Tx, organizationId: string, capabilities: Pick<ClubCapabilities, "editProfile">) {
  if (!canManageClubCalendar(capabilities)) throw new ClubCalendarError("NOT_ALLOWED", "Your club role doesn't include this. Ask your club director.");
  const club = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, isActive: true } });
  if (!club || club.type !== "CLUB" || !club.isActive) throw new ClubCalendarError("FEATURE_OFF", "That page could not be found.");
  const feature = await tx.clubOptionalFeature.findUnique({
    where: { organizationId_featureKey: { organizationId, featureKey: CLUB_CALENDAR_FEATURE_KEY } },
    select: { id: true },
  });
  if (!feature) throw new ClubCalendarError("FEATURE_OFF", "That page could not be found.");
}

export async function addClubCalendarItem(
  organizationId: string,
  input: ClubCalendarItemInput,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  actor: ClubCalendarActor,
) {
  return getPrisma().$transaction(async (tx) => {
    await guardWrite(tx, organizationId, capabilities);
    const who = actorFields(actor);
    const created = await tx.clubCalendarItem.create({
      data: {
        organizationId,
        kind: input.kind,
        title: input.title,
        date: input.date,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        createdByAccountId: who.accountId,
        createdByUserId: who.userId,
        updatedByAccountId: who.accountId,
        updatedByUserId: who.userId,
      },
      select: { id: true, kind: true },
    });
    const audit = auditActor(actor);
    await writeAuditLog({
      ...("actorUserId" in audit ? { actorUserId: audit.actorUserId } : {}),
      action: "CLUB_CALENDAR_ITEM_ADDED",
      entityType: "ClubCalendarItem",
      entityId: created.id,
      summary: `Added a ${clubCalendarKindLabels[created.kind as ClubCalendarKind].toLowerCase()} to the club calendar.`,
      metadata: { organizationId, itemId: created.id, kind: created.kind, ...audit.metadata },
    }, tx);
    return { id: created.id };
  });
}

export async function updateClubCalendarItem(
  organizationId: string,
  itemId: string,
  input: ClubCalendarItemInput,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  actor: ClubCalendarActor,
) {
  return getPrisma().$transaction(async (tx) => {
    await guardWrite(tx, organizationId, capabilities);
    const who = actorFields(actor);
    // Scoped to the club in the write itself, so an id from another club changes nothing.
    const updated = await tx.clubCalendarItem.updateMany({
      where: { id: itemId, organizationId },
      data: {
        kind: input.kind,
        title: input.title,
        date: input.date,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        updatedByAccountId: who.accountId,
        updatedByUserId: who.userId,
      },
    });
    if (updated.count === 0) throw new ClubCalendarError("ITEM_NOT_FOUND", "That item could not be found.");
    const audit = auditActor(actor);
    await writeAuditLog({
      ...("actorUserId" in audit ? { actorUserId: audit.actorUserId } : {}),
      action: "CLUB_CALENDAR_ITEM_UPDATED",
      entityType: "ClubCalendarItem",
      entityId: itemId,
      summary: `Changed a ${clubCalendarKindLabels[input.kind].toLowerCase()} on the club calendar.`,
      metadata: { organizationId, itemId, kind: input.kind, ...audit.metadata },
    }, tx);
    return { id: itemId };
  });
}

export async function deleteClubCalendarItem(
  organizationId: string,
  itemId: string,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  actor: ClubCalendarActor,
) {
  return getPrisma().$transaction(async (tx) => {
    await guardWrite(tx, organizationId, capabilities);
    const item = await tx.clubCalendarItem.findFirst({ where: { id: itemId, organizationId }, select: { id: true, kind: true } });
    if (!item) throw new ClubCalendarError("ITEM_NOT_FOUND", "That item could not be found.");
    const removed = await tx.clubCalendarItem.deleteMany({ where: { id: item.id, organizationId } });
    if (removed.count === 0) throw new ClubCalendarError("ITEM_NOT_FOUND", "That item could not be found.");
    const audit = auditActor(actor);
    await writeAuditLog({
      ...("actorUserId" in audit ? { actorUserId: audit.actorUserId } : {}),
      action: "CLUB_CALENDAR_ITEM_DELETED",
      entityType: "ClubCalendarItem",
      entityId: item.id,
      summary: `Deleted a ${clubCalendarKindLabels[item.kind as ClubCalendarKind].toLowerCase()} from the club calendar.`,
      metadata: { organizationId, itemId: item.id, kind: item.kind, ...audit.metadata },
    }, tx);
  });
}

/** Turns reminders on or off and sets how many days before. Audited only when something changed. */
export async function setClubCalendarReminders(
  organizationId: string,
  input: ClubCalendarReminderSettingInput,
  capabilities: Pick<ClubCapabilities, "editProfile">,
  actor: ClubCalendarActor,
): Promise<ReminderSettingView> {
  return getPrisma().$transaction(async (tx) => {
    await guardWrite(tx, organizationId, capabilities);
    const current = await tx.clubCalendarReminderSetting.findUnique({ where: { organizationId }, select: { enabled: true, daysBefore: true } });
    const before = current ?? { enabled: false, daysBefore: REMINDER_DAYS_DEFAULT };
    if (current && before.enabled === input.enabled && before.daysBefore === input.daysBefore) return before;
    if (!current && !input.enabled && input.daysBefore === REMINDER_DAYS_DEFAULT) return before;
    const who = actorFields(actor);
    await tx.clubCalendarReminderSetting.upsert({
      where: { organizationId },
      update: { enabled: input.enabled, daysBefore: input.daysBefore, updatedByAccountId: who.accountId, updatedByUserId: who.userId },
      create: { organizationId, enabled: input.enabled, daysBefore: input.daysBefore, updatedByAccountId: who.accountId, updatedByUserId: who.userId },
    });
    const audit = auditActor(actor);
    const action = before.enabled !== input.enabled
      ? (input.enabled ? "CLUB_CALENDAR_REMINDERS_TURNED_ON" : "CLUB_CALENDAR_REMINDERS_TURNED_OFF")
      : "CLUB_CALENDAR_REMINDER_DAYS_CHANGED";
    await writeAuditLog({
      ...("actorUserId" in audit ? { actorUserId: audit.actorUserId } : {}),
      action,
      entityType: "ClubCalendarReminderSetting",
      entityId: organizationId,
      summary: action === "CLUB_CALENDAR_REMINDERS_TURNED_ON"
        ? "Turned on club calendar reminder emails."
        : action === "CLUB_CALENDAR_REMINDERS_TURNED_OFF"
          ? "Turned off club calendar reminder emails."
          : "Changed how many days before club calendar reminder emails go out.",
      metadata: { organizationId, enabled: input.enabled, daysBefore: input.daysBefore, previousEnabled: before.enabled, previousDaysBefore: before.daysBefore, ...audit.metadata },
    }, tx);
    return { enabled: input.enabled, daysBefore: input.daysBefore };
  });
}
