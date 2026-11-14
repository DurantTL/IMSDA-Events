import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { calendarDateIn, addDays } from "@/modules/calendar/domain";
import { applyMinimumCount, buildEventFunnel, decideDimension, defaultAnalyticsPeriod, fillDailySeries, freeTextDailyCap, freeTextMetrics, isFreeTextMetric, minimumShownCount, rareFreeTextRetentionDays, type MinimumCounted, previousPeriodAvailable, previousPeriodRange, retentionDays, type AnalyticsPeriod, type DailyFunnelPoint, type DateRange, type EventFunnelRow, type FunnelCounts, type PublicMetricName } from "@/modules/public-metrics/domain";

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
    if (isFreeTextMetric(metric)) {
      // Abuse cap, in the same statement: a value already stored today still counts up; a new one is added only while
      // fewer than 200 different values exist for that day and metric. Two requests at the same instant can both pass
      // the check, so the number of values can briefly pass 200 by a few; that is acceptable.
      const written = await getPrisma().$executeRaw(Prisma.sql`
        INSERT INTO "PublicMetricDaily" ("day", "metric", "dimension", "count")
        SELECT ${day}::date, ${metric}::"PublicMetric", ${stored}::text, 1
        WHERE EXISTS (SELECT 1 FROM "PublicMetricDaily" WHERE "day" = ${day}::date AND "metric" = ${metric}::"PublicMetric" AND "dimension" = ${stored}::text)
          OR (SELECT count(*) FROM "PublicMetricDaily" WHERE "day" = ${day}::date AND "metric" = ${metric}::"PublicMetric") < ${freeTextDailyCap}
        ON CONFLICT ("day", "metric", "dimension") DO UPDATE SET "count" = "PublicMetricDaily"."count" + 1`);
      return written > 0;
    }
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

/**
 * Deletes daily rows older than the retention window (400 days), and rows of the three free-text metrics that are older
 * than 30 days and whose value, added up over every stored day, was seen fewer than 3 times. Returns how many went.
 */
export async function prunePublicMetrics(now = new Date()): Promise<number> {
  const today = calendarDateIn(now);
  const cutoff = new Date(`${addDays(today, -retentionDays)}T00:00:00Z`);
  const result = await getPrisma().publicMetricDaily.deleteMany({ where: { day: { lt: cutoff } } });
  const rareCutoff = new Date(`${addDays(today, -rareFreeTextRetentionDays)}T00:00:00Z`);
  const rare = await getPrisma().$executeRaw(Prisma.sql`
    DELETE FROM "PublicMetricDaily" AS p
    WHERE p."metric" IN (${Prisma.join(freeTextMetrics.map((metric) => Prisma.sql`${metric}::"PublicMetric"`))})
      AND p."day" < ${rareCutoff}::date
      AND (SELECT COALESCE(SUM(t."count"), 0) FROM "PublicMetricDaily" AS t WHERE t."metric" = p."metric" AND t."dimension" = p."dimension") < ${minimumShownCount}`);
  return result.count + rare;
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
  /** Referring sites and campaign tags (#1560): only values seen at least 3 times in the period; the rest are a count only. */
  referrers: MinimumCounted<MetricRow>;
  campaigns: MinimumCounted<MetricRow>;
  /** Searches on the events list that showed nothing (#1560), same rule. */
  noResultSearches: MinimumCounted<MetricRow>;
  /** The same-length period just before this one (#1961); `totals` is null when it is no longer fully stored (past the 400-day retention). */
  previous: (DateRange & { totals: FunnelCounts | null });
  /** One point per day of the period for views, starts and completions; days with no counts are 0. */
  daily: DailyFunnelPoint[];
};

/** The last 30, 90 or 365 days, counts only (system administrators' view). `today` is a conference-calendar date. */
export async function getAnalyticsSummary(today: string, days: AnalyticsPeriod = defaultAnalyticsPeriod, options: { eventNames?: boolean; /** The previous-period totals and the day-by-day series (#1961); on by default, off for callers that only read totals. */ trends?: boolean } = {}): Promise<AnalyticsSummary> {
  const from = addDays(today, -(days - 1));
  const rows = await getPrisma().publicMetricDaily.groupBy({
    by: ["metric", "dimension"],
    where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
    _sum: { count: true },
  });
  const funnelMetrics = ["EVENT_PAGE_VIEW", "REGISTRATION_START", "REGISTRATION_COMPLETE"] as const;
  const trends = options.trends !== false;
  const dayRows = trends ? await getPrisma().publicMetricDaily.groupBy({
    by: ["day", "metric"],
    where: { metric: { in: [...funnelMetrics] }, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
    _sum: { count: true },
  }) : [];
  const previousRange = previousPeriodRange(from, days);
  let previousTotals: FunnelCounts | null = null;
  if (trends && previousPeriodAvailable(today, days)) {
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
  const metricNames = ["EVENT_PAGE_VIEW", "DIRECTORY_SEARCH", "DIRECTORY_FILTER", "REGISTRATION_START", "REGISTRATION_COMPLETE", "LOGIN_SUCCESS", "LOGIN_FAILURE", "NOT_FOUND", "IMAGE_ERROR", "WEB_VITAL", "REFERRER_SITE", "CAMPAIGN_VISIT", "SEARCH_NO_RESULTS"] as const;
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
    // Below-minimum values are rolled up here, on the server: their text never leaves this function.
    referrers: applyMinimumCount(by("REFERRER_SITE")),
    campaigns: applyMinimumCount(by("CAMPAIGN_VISIT")),
    noResultSearches: applyMinimumCount(by("SEARCH_NO_RESULTS")),
    previous: { ...previousRange, totals: previousTotals },
    daily: !trends ? [] : fillDailySeries(from, today, dayRows.map((row) => ({ day: row.day.toISOString().slice(0, 10), metric: row.metric, count: row._sum.count ?? 0 }))),
  };
}
