import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { countPublicCalendarEntries } from "@/modules/calendar/repository";
import { listInformationForms } from "@/modules/information-forms/repository";
import { countWaitingNewClubApplications } from "@/modules/club-applications/repository";
import { listClubFormsForHub } from "@/modules/club-forms/hub";
import { countStaffTransferQueue } from "@/modules/club-transfers/repository";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { monthlyStatusTotals } from "@/modules/club-reports/area-summary-domain";
import { chooseReportMonth } from "@/modules/club-reports/club-directory-domain";
import { loadFormsHub } from "@/modules/forms-hub/load";
import { listFormTemplateLibrary } from "@/modules/forms/form-template-library";
import { getAdminAttentionSummary } from "@/modules/system-admin/attention-repository";
import { listAreaPauses } from "@/modules/system-admin/area-pause";
import { countWaitingClubInvites, listClubLeaders } from "@/modules/system-admin/club-leaders";
import { listPendingInvitesPage } from "@/modules/system-admin/pending-invites";
import { clubsSummaryOnce } from "@/modules/system-admin/request-reads";
import { getSystemReadiness } from "@/modules/system-admin/readiness-repository";
import { neededMetrics, type HubKey, type HubViewer, type MetricKey, type MetricValues } from "@/modules/system-admin/admin-hubs-model";

/**
 * The numbers behind the Admin hub pages (#1569). Only the metrics a hub shows to this viewer are read (`neededMetrics`),
 * each read stands alone, and a read that fails is logged and becomes `null`, which the hub shows as "Unavailable". The
 * caller has already checked that the viewer may open the hub; each metric reuses the count an existing page reads.
 * Nothing here writes.
 */
type Context = { now: Date; viewer: HubViewer; clubYear?: string; shared: Map<string, Promise<unknown>> };

/** One read shared by the metrics that come from it (a failure of it makes each of them unavailable). */
function shared<T>(context: Context, key: string, read: () => Promise<T>): Promise<T> {
  let promise = context.shared.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = read();
    context.shared.set(key, promise);
  }
  return promise;
}

/** Clubs with the report month's record late, from a club-year summary a caller already read; throws when the month is not in the year. */
export function lateRecordCount(clubs: Parameters<typeof monthlyStatusTotals>[0], clubYear: string, now: Date): number {
  const month = chooseReportMonth(clubYear, now);
  const totals = monthlyStatusTotals(clubs, clubYear).find((entry) => entry.month === month);
  if (!totals) throw new Error("The report month is not in the club year.");
  return totals.late;
}

const clubsSummary = (context: Context) =>
  shared(context, "clubsSummary", async () => {
    const clubYear = context.clubYear ?? resolveAreaClubYear(undefined, context.now);
    const clubs = await clubsSummaryOnce(clubYear, context.now);
    return { clubs: clubs.length, late: lateRecordCount(clubs, clubYear, context.now) };
  });

const calendarCounts = (context: Context) => shared(context, "calendar", () => countPublicCalendarEntries(context.now));

const formsHub = (context: Context) => shared(context, "formsHub", () => loadFormsHub());

const readiness = (context: Context) => shared(context, "readiness", () => getSystemReadiness(context.now));

const attention = (context: Context) => shared(context, "attention", () => getAdminAttentionSummary(context.now.getTime()));

const readers: Record<MetricKey, (context: Context) => Promise<number>> = {
  upcomingEvents: () => getPrisma().event.count({ where: { archivedAt: null, isPublished: true, endsAt: { gte: new Date() } } }),
  unpublishedEvents: () => getPrisma().event.count({ where: { archivedAt: null, isPublished: false, endsAt: { gte: new Date() } } }),
  // The Copy from a past event page lists every event, archived ones included, so the count is every event.
  copyableEvents: () => getPrisma().event.count(),
  archivedEvents: () => getPrisma().event.count({ where: { archivedAt: { not: null } } }),
  // The Entries list's upcoming rule with the public calendar's guards (no deadlines, hidden or feed-removed items); one shared read.
  calendarPublished: async (context) => (await calendarCounts(context)).published,
  calendarUnpublished: async (context) => (await calendarCounts(context)).unpublished,
  moduleRequests: () => getPrisma().moduleRequest.count({ where: { status: "PENDING" } }),
  eventTemplates: () => getPrisma().eventTemplate.count({ where: { status: { not: "ARCHIVED" } } }),
  clubs: async (context) => (await clubsSummary(context)).clubs,
  lateRecords: async (context) => (await clubsSummary(context)).late,
  applicationsWaiting: ({ viewer }) => countWaitingNewClubApplications(viewer.isSystemAdmin ? "SYSTEM_ADMIN" : "CLUBS_ADMIN"),
  openTransfers: ({ now }) => countStaffTransferQueue("open", now),
  clubLeaders: async ({ now }) => (await listClubLeaders({ clubId: null, role: null }, 1, now)).total,
  clubInvitesWaiting: ({ now }) => countWaitingClubInvites(now),
  staffLogins: () => getPrisma().user.count({ where: { accountStatus: "ACTIVE" } }),
  invitesWaiting: async () => (await listPendingInvitesPage({ query: "", scope: "full" }, 1)).total,
  formsTotal: async (context) => (await formsHub(context)).length,
  clubFormsOn: async () => (await listClubFormsForHub()).filter((row) => row.status === "OPEN").length,
  // The Information forms page lists the GENERAL forms only (event forms belong to their events).
  informationFormsOpen: async () => (await listInformationForms({ scope: "GENERAL" })).filter((form) => form.status === "OPEN").length,
  draftForms: () => getPrisma().registrationForm.count({ where: { status: "DRAFT", event: { archivedAt: null } } }),
  formTemplates: async () => (await listFormTemplateLibrary()).length,
  savedQuestions: () => getPrisma().questionLibraryItem.count(),
  readinessAttention: async (context) => (await readiness(context)).summary.automaticAttention,
  readinessToConfirm: async (context) => {
    const result = await readiness(context);
    // Without the tick table the manual items are unknown, never "all confirmed".
    if (!result.ticksAvailable) throw new Error("Readiness confirmations could not be read.");
    return result.summary.manualTotal - result.summary.manualDone;
  },
  // Checks whose answer could not be read (an unreadable backup log or migration status): never "ready".
  readinessUnknown: async (context) => (await readiness(context)).summary.automaticUnknown,
  emailProblems: async (context) => {
    const summary = await attention(context);
    if (summary.unreadable.includes("email-failed")) throw new Error("The failed email check could not be read.");
    return summary.groups.flatMap((group) => group.items).find((item) => item.key === "email-failed")?.count ?? 0;
  },
  pausedAreas: async () => (await listAreaPauses()).filter((area) => area.paused).length,
  honors: () => getPrisma().honor.count(),
};

/**
 * The values of the named metrics for a viewer, each read on its own: one that failed is logged under `label` and becomes
 * `null` ("Unavailable"). The caller names only metrics the viewer may see.
 */
export async function loadMetrics(
  keys: readonly MetricKey[],
  viewer: HubViewer,
  label: string,
  now = new Date(),
  /** `clubYear`: the club year the page picked (default the current one). `known`: numbers the page already read, so they are not read twice. */
  options: { clubYear?: string; known?: MetricValues } = {},
): Promise<MetricValues> {
  const context: Context = { now, viewer, clubYear: options.clubYear, shared: new Map() };
  const entries = await Promise.all(
    keys.map(async (key): Promise<[MetricKey, number | null]> => {
      const known = options.known?.[key];
      if (known !== undefined) return [key, known];
      try {
        const value = await readers[key](context);
        return [key, Number.isFinite(value) ? value : null];
      } catch (error) {
        logError(`Admin hub number could not load: ${label}/${key}`, error);
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** The values for one hub and viewer. A metric that failed is `null`; a metric the hub does not show is not read. */
export async function loadHubMetrics(hub: HubKey, viewer: HubViewer, now = new Date(), options: { clubYear?: string; known?: MetricValues } = {}): Promise<MetricValues> {
  return loadMetrics(neededMetrics(hub, viewer), viewer, hub, now, options);
}
