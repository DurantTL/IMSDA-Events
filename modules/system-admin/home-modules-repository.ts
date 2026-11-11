import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { Prisma } from "@prisma/client";
import { calendarDateIn } from "@/modules/calendar/domain";
import { CONFERENCE_TIME_ZONE } from "@/modules/calendar/conference-format";
import { HOME_MODULES, type HomeModuleKey } from "@/modules/system-admin/home-layout-domain";
import {
  TREND_DAYS,
  clubYearInstants,
  conferenceClubYear,
  dateBefore,
  dailyCountsFromRows,
  buildEventsFillingUp,
  buildMonthlyRecords,
  buildSeasonNumbers,
  type EventsFillingUpView,
  type MonthlyRecordsView,
  type SeasonNumbersView,
} from "@/modules/system-admin/home-modules-model";
import { clubsSummaryOnce, dashboardEventsOnce } from "@/modules/system-admin/request-reads";
import { toDashboardEventSource } from "@/modules/system-admin/repository";

/** What each data module reads. A value of `null` means the read failed (shown as "Unavailable"); an absent key was not read. */
export type HomeModuleData = {
  "events-filling-up"?: EventsFillingUpView | null;
  "season-numbers"?: SeasonNumbersView | null;
  "monthly-records"?: MonthlyRecordsView | null;
};

/** Runs one read; a failure is logged and becomes `null`, which the module shows as "Unavailable" and never as zero. */
async function attempt<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logError(`Home module read could not load: ${label}`, error);
    return null;
  }
}

/** Registrations count as active in these statuses: the dashboards' rule (`dashboardEventSelect` in modules/system-admin/repository.ts). */
const ACTIVE_STATUSES = ["SUBMITTED", "CONFIRMED"] as const;

/**
 * Reads the Home modules a person has turned on (#1705 part 2). `roles` comes from `resolveAdminRoles` on the server; a
 * module is read only when it is in `shown` and the person may use it, and event data is only ever read for the person's
 * own events (a system administrator: all; an Events administrator: their `eventAdminEventIds`). Read-only.
 */
export async function loadHomeModules(roles: AdminRoles, shown: ReadonlySet<HomeModuleKey>, now = new Date()): Promise<HomeModuleData> {
  const allowed = (key: HomeModuleKey) => shown.has(key) && HOME_MODULES.find((module) => module.key === key)?.mayUse(roles) === true;
  const prisma = getPrisma();
  const seesEvents = roles.systemAdmin || roles.eventAdminEventIds.length > 0;
  const seesClubs = roles.systemAdmin || roles.clubsAdministrator;
  // Undefined reads every event (system administrator only); otherwise only the person's own.
  const eventIds = roles.systemAdmin ? undefined : [...roles.eventAdminEventIds];
  const clubYear = conferenceClubYear(now);

  // One club summary read serves Active clubs and Monthly Records.
  const summary = () => clubsSummaryOnce(resolveAreaClubYear(undefined, now), now);

  const data: HomeModuleData = {};
  await Promise.all([
    allowed("events-filling-up")
      ? attempt("events filling up", async () => {
        const rows = await dashboardEventsOnce(eventIds, now);
        return buildEventsFillingUp(rows.map(toDashboardEventSource), now, roles.systemAdmin);
      }).then((view) => { data["events-filling-up"] = view; })
      : null,
    allowed("season-numbers")
      ? (async () => {
        const eventScope = seesEvents ? { archivedAt: null, ...(eventIds ? { id: { in: eventIds } } : {}) } : null;
        const { from, to } = clubYearInstants(clubYear);
        const today = calendarDateIn(now);
        const [registrations, people, trend, clubs] = await Promise.all([
          eventScope ? attempt("season registrations", () => prisma.registration.count({ where: { status: { in: [...ACTIVE_STATUSES] }, event: { ...eventScope, startsAt: { gte: from, lt: to } } } })) : null,
          eventScope ? attempt("season people", () => prisma.registrationAttendee.count({ where: { registration: { status: { in: [...ACTIVE_STATUSES] } }, event: { ...eventScope, startsAt: { gte: from, lt: to } } } })) : null,
          eventScope ? attempt("season trend", () => newRegistrationsByDay(prisma, eventIds, today)) : null,
          seesClubs ? attempt("season clubs", async () => (await summary()).length) : null,
        ]);
        data["season-numbers"] = buildSeasonNumbers({
          clubYear,
          events: seesEvents ? { registrations, people, trend, href: roles.systemAdmin ? "/admin" : "/events-admin" } : null,
          clubs: seesClubs ? { count: clubs } : null,
        });
      })()
      : null,
    allowed("monthly-records")
      ? attempt("monthly records", async () => buildMonthlyRecords(await summary(), resolveAreaClubYear(undefined, now), now)).then((view) => { data["monthly-records"] = view; })
      : null,
  ]);
  return data;
}

/**
 * New active registrations per conference-calendar day for the 30 days ending `today`, on the person's events (all of them
 * when `eventIds` is undefined): one grouped count of at most 30 rows. Same status rule and event scope as the totals.
 */
async function newRegistrationsByDay(prisma: ReturnType<typeof getPrisma>, eventIds: string[] | undefined, today: string): Promise<number[]> {
  const first = dateBefore(today, TREND_DAYS - 1);
  const scope = eventIds ? Prisma.sql`AND e."id" IN (${Prisma.join(eventIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
    SELECT to_char((r."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${CONFERENCE_TIME_ZONE}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
    FROM "Registration" r
    JOIN "Event" e ON e."id" = r."eventId"
    WHERE r."status"::text IN ('SUBMITTED', 'CONFIRMED')
      AND e."archivedAt" IS NULL
      ${scope}
      AND ((r."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${CONFERENCE_TIME_ZONE})::date >= ${first}::date
      AND ((r."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${CONFERENCE_TIME_ZONE})::date <= ${today}::date
    GROUP BY 1`);
  return dailyCountsFromRows(rows, today);
}
