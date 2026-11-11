import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { HOME_MODULES, type HomeModuleKey } from "@/modules/system-admin/home-layout-domain";
import {
  TREND_DAYS,
  buildEventsFillingUp,
  buildMonthlyRecords,
  buildSeasonNumbers,
  dailyCounts,
  type EventsFillingUpView,
  type MonthlyRecordsView,
  type SeasonNumbersView,
} from "@/modules/system-admin/home-modules-model";
import { findDashboardEvents, toDashboardEventSource } from "@/modules/system-admin/repository";

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

/** The club year's first day (inclusive) and the next year's first day (exclusive), in UTC. */
function clubYearRange(clubYear: string) {
  const start = Number(clubYear.slice(0, 4));
  return { from: new Date(Date.UTC(start, 8, 1)), to: new Date(Date.UTC(start + 1, 8, 1)) };
}

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
  const clubYear = clubYearFor(now);

  // One club summary read serves Active clubs and Monthly Records.
  let clubsSummary: ReturnType<typeof getAreaClubsSummary> | null = null;
  const summary = () => (clubsSummary ??= getAreaClubsSummary(resolveAreaClubYear(undefined, now), now, { backgroundChecks: false }));

  const data: HomeModuleData = {};
  await Promise.all([
    allowed("events-filling-up")
      ? attempt("events filling up", async () => {
        const rows = await findDashboardEvents(prisma, { eventIds, endsOnOrAfter: now });
        return buildEventsFillingUp(rows.map(toDashboardEventSource), now, roles.systemAdmin);
      }).then((view) => { data["events-filling-up"] = view; })
      : null,
    allowed("season-numbers")
      ? (async () => {
        const eventScope = seesEvents ? { archivedAt: null, ...(eventIds ? { id: { in: eventIds } } : {}) } : null;
        const { from, to } = clubYearRange(clubYear);
        const since = new Date(now.getTime() - TREND_DAYS * 86_400_000);
        const [registrations, people, trend, clubs] = await Promise.all([
          eventScope ? attempt("season registrations", () => prisma.registration.count({ where: { status: { in: [...ACTIVE_STATUSES] }, event: { ...eventScope, startsAt: { gte: from, lt: to } } } })) : null,
          eventScope ? attempt("season people", () => prisma.registrationAttendee.count({ where: { registration: { status: { in: [...ACTIVE_STATUSES] } }, event: { ...eventScope, startsAt: { gte: from, lt: to } } } })) : null,
          eventScope
            ? attempt("season trend", async () => dailyCounts((await prisma.registration.findMany({ where: { status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: since }, event: eventScope }, select: { createdAt: true } })).map((row) => row.createdAt), now))
            : null,
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
