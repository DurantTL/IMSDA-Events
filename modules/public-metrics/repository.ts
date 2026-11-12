import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { calendarDateIn, addDays } from "@/modules/calendar/domain";
import { buildEventFunnel, decideDimension, defaultAnalyticsPeriod, fillDailySeries, previousPeriodAvailable, previousPeriodRange, retentionDays, type AnalyticsPeriod, type DailyFunnelPoint, type DateRange, type EventFunnelRow, type FunnelCounts, type PublicMetricName } from "@/modules/public-metrics/domain";

/**
 * Counts one public event (#111). Aggregate only: one row per day, metric and allowlisted dimension, incremented
 * atomically. The dimension is validated here whatever the caller did. An event slug is counted only when that event
 * is published, shown on the calendar and not archived; any other slug is dropped without a trace, so private events
 * are never recorded, not even as a bucket. Never throws and never logs request details: a failure is swallowed so a
 * metric can never change a response. Returns whether a count was written, for tests.
 */
export async function recordPublicMetric(metric: PublicMetricName, dimension: unknown = "", now = new Date()): Promise<boolean> {
  try {
    const decision = decideDimension(metric, dimension);
    if (decision.kind === "drop") return false;
    let stored = "";
    if (decision.kind === "event") {
      const event = await getPrisma().event.findFirst({
        where: { slug: decision.slug, isPublished: true, archivedAt: null, showOnCalendar: true },
        select: { id: true },
      });
      if (!event) return false;
      stored = decision.slug;
    } else {
      stored = decision.dimension;
    }
    const day = new Date(`${calendarDateIn(now)}T00:00:00Z`);
    await getPrisma().$executeRaw(Prisma.sql`
      INSERT INTO "PublicMetricDaily" ("day", "metric", "dimension", "count")
      VALUES (${day}::date, ${metric}::"PublicMetric", ${stored}, 1)
      ON CONFLICT ("day", "metric", "dimension") DO UPDATE SET "count" = "PublicMetricDaily"."count" + 1`);
    return true;
  } catch (error) {
    logWarn("A public metric could not be recorded", { reason: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}

/** Deletes daily rows older than the retention window (400 days). Returns how many went. */
export async function prunePublicMetrics(now = new Date()): Promise<number> {
  const cutoff = new Date(`${addDays(calendarDateIn(now), -retentionDays)}T00:00:00Z`);
  const result = await getPrisma().publicMetricDaily.deleteMany({ where: { day: { lt: cutoff } } });
  return result.count;
}

export type MetricRow = { dimension: string; count: number };
export type AnalyticsSummary = {
  from: string;
  to: string;
  totals: Record<PublicMetricName, number>;
  days: AnalyticsPeriod;
  /** One row per event with any counted views, starts or completions; `title` falls back to the slug. */
  funnel: Array<EventFunnelRow & { title: string }>;
  logins: Array<{ surface: string; success: number; failure: number }>;
  notFound: MetricRow[];
  imageErrors: MetricRow[];
  vitals: Array<{ name: string; good: number; needsImprovement: number; poor: number }>;
  directory: MetricRow[];
  /** The same-length period just before this one (#1961); `totals` is null when it is no longer fully stored (past the 400-day retention). */
  previous: (DateRange & { totals: FunnelCounts | null });
  /** One point per day of the period for views, starts and completions; days with no counts are 0. */
  daily: DailyFunnelPoint[];
};

/** The last 30, 90 or 365 days, counts only (system administrators' view). `today` is a conference-calendar date. */
export async function getAnalyticsSummary(today: string, days: AnalyticsPeriod = defaultAnalyticsPeriod, options: { eventNames?: boolean } = {}): Promise<AnalyticsSummary> {
  const from = addDays(today, -(days - 1));
  const rows = await getPrisma().publicMetricDaily.groupBy({
    by: ["metric", "dimension"],
    where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
    _sum: { count: true },
  });
  const funnelMetrics = ["EVENT_PAGE_VIEW", "REGISTRATION_START", "REGISTRATION_COMPLETE"] as const;
  const dayRows = await getPrisma().publicMetricDaily.groupBy({
    by: ["day", "metric"],
    where: { metric: { in: [...funnelMetrics] }, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
    _sum: { count: true },
  });
  const previousRange = previousPeriodRange(from, days);
  let previousTotals: FunnelCounts | null = null;
  if (previousPeriodAvailable(today, days)) {
    const previousRows = await getPrisma().publicMetricDaily.groupBy({
      by: ["metric"],
      where: { metric: { in: [...funnelMetrics] }, day: { gte: new Date(`${previousRange.from}T00:00:00Z`), lte: new Date(`${previousRange.to}T00:00:00Z`) } },
      _sum: { count: true },
    });
    const sum = (metric: PublicMetricName) => previousRows.filter((row) => row.metric === metric).reduce((total, row) => total + (row._sum.count ?? 0), 0);
    previousTotals = { views: sum("EVENT_PAGE_VIEW"), started: sum("REGISTRATION_START"), completed: sum("REGISTRATION_COMPLETE") };
  }
  const by = (metric: PublicMetricName): MetricRow[] =>
    rows.filter((row) => row.metric === metric).map((row) => ({ dimension: row.dimension, count: row._sum.count ?? 0 })).sort((a, b) => b.count - a.count || a.dimension.localeCompare(b.dimension));
  const total = (metric: PublicMetricName) => by(metric).reduce((sum, row) => sum + row.count, 0);
  const metricNames = ["EVENT_PAGE_VIEW", "DIRECTORY_SEARCH", "DIRECTORY_FILTER", "REGISTRATION_START", "REGISTRATION_COMPLETE", "LOGIN_SUCCESS", "LOGIN_FAILURE", "NOT_FOUND", "IMAGE_ERROR", "WEB_VITAL"] as const;
  const totals = Object.fromEntries(metricNames.map((metric) => [metric, total(metric)])) as Record<PublicMetricName, number>;
  const counts = (metric: PublicMetricName) => new Map(by(metric).map((row) => [row.dimension, row.count]));
  const funnelRows = buildEventFunnel(counts("EVENT_PAGE_VIEW"), counts("REGISTRATION_START"), counts("REGISTRATION_COMPLETE"));
  // One lookup for every title (slug and name only; skipped with `eventNames: false`); an event that no longer matches shows its slug.
  const events = options.eventNames !== false && funnelRows.length > 0 ? await getPrisma().event.findMany({ where: { slug: { in: funnelRows.map((row) => row.slug) } }, select: { slug: true, name: true } }) : [];
  const titles = new Map(events.map((event) => [event.slug, event.name]));
  const success = new Map(by("LOGIN_SUCCESS").map((row) => [row.dimension, row.count]));
  const failure = new Map(by("LOGIN_FAILURE").map((row) => [row.dimension, row.count]));
  const surfaces = [...new Set([...success.keys(), ...failure.keys()])].sort();
  const vitalCounts = new Map(by("WEB_VITAL").map((row) => [row.dimension, row.count]));
  const vitalNames = [...new Set(by("WEB_VITAL").map((row) => row.dimension.split(":")[0]))].sort();
  return {
    from,
    to: today,
    totals,
    days,
    funnel: funnelRows.map((row) => ({ ...row, title: titles.get(row.slug) || row.slug })),
    logins: surfaces.map((surface) => ({ surface, success: success.get(surface) ?? 0, failure: failure.get(surface) ?? 0 })),
    notFound: by("NOT_FOUND"),
    imageErrors: by("IMAGE_ERROR"),
    vitals: vitalNames.map((name) => ({
      name,
      good: vitalCounts.get(`${name}:good`) ?? 0,
      needsImprovement: vitalCounts.get(`${name}:needs-improvement`) ?? 0,
      poor: vitalCounts.get(`${name}:poor`) ?? 0,
    })),
    directory: [...by("DIRECTORY_SEARCH"), ...by("DIRECTORY_FILTER")],
    previous: { ...previousRange, totals: previousTotals },
    daily: fillDailySeries(from, today, dayRows.map((row) => ({ day: row.day.toISOString().slice(0, 10), metric: row.metric, count: row._sum.count ?? 0 }))),
  };
}
