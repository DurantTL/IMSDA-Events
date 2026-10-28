import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { calendarDateIn, addDays } from "@/modules/calendar/domain";
import { decideDimension, retentionDays, type PublicMetricName } from "@/modules/public-metrics/domain";

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
  topEventPages: MetricRow[];
  funnel: Array<{ slug: string; started: number; completed: number }>;
  logins: Array<{ surface: string; success: number; failure: number }>;
  notFound: MetricRow[];
  imageErrors: MetricRow[];
  vitals: Array<{ name: string; good: number; needsImprovement: number; poor: number }>;
  directory: MetricRow[];
};

/** The last 30 days, counts only (system administrators' view). `today` is a conference-calendar date. */
export async function getAnalyticsSummary(today: string): Promise<AnalyticsSummary> {
  const from = addDays(today, -29);
  const rows = await getPrisma().publicMetricDaily.groupBy({
    by: ["metric", "dimension"],
    where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
    _sum: { count: true },
  });
  const by = (metric: PublicMetricName): MetricRow[] =>
    rows.filter((row) => row.metric === metric).map((row) => ({ dimension: row.dimension, count: row._sum.count ?? 0 })).sort((a, b) => b.count - a.count || a.dimension.localeCompare(b.dimension));
  const total = (metric: PublicMetricName) => by(metric).reduce((sum, row) => sum + row.count, 0);
  const metricNames = ["EVENT_PAGE_VIEW", "DIRECTORY_SEARCH", "DIRECTORY_FILTER", "REGISTRATION_START", "REGISTRATION_COMPLETE", "LOGIN_SUCCESS", "LOGIN_FAILURE", "NOT_FOUND", "IMAGE_ERROR", "WEB_VITAL"] as const;
  const totals = Object.fromEntries(metricNames.map((metric) => [metric, total(metric)])) as Record<PublicMetricName, number>;
  const started = new Map(by("REGISTRATION_START").map((row) => [row.dimension, row.count]));
  const completed = new Map(by("REGISTRATION_COMPLETE").map((row) => [row.dimension, row.count]));
  const slugs = [...new Set([...started.keys(), ...completed.keys()])].sort();
  const success = new Map(by("LOGIN_SUCCESS").map((row) => [row.dimension, row.count]));
  const failure = new Map(by("LOGIN_FAILURE").map((row) => [row.dimension, row.count]));
  const surfaces = [...new Set([...success.keys(), ...failure.keys()])].sort();
  const vitalCounts = new Map(by("WEB_VITAL").map((row) => [row.dimension, row.count]));
  const vitalNames = [...new Set(by("WEB_VITAL").map((row) => row.dimension.split(":")[0]))].sort();
  return {
    from,
    to: today,
    totals,
    topEventPages: by("EVENT_PAGE_VIEW").slice(0, 10),
    funnel: slugs.map((slug) => ({ slug, started: started.get(slug) ?? 0, completed: completed.get(slug) ?? 0 })),
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
  };
}
