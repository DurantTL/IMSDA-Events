"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { campaignDimension, firstPathSegment, isStaffWorkspacePath, vitalNames, type BeaconMetric } from "@/modules/public-metrics/domain";

/**
 * The one first-party analytics beacon for public pages (#111). It sends a metric name and an allowlisted dimension to
 * `/api/public-metrics` with `navigator.sendBeacon`: no cookie, no identifier, no third-party script, and no address,
 * page address or query string. Three hits carry short normalized text (#1560): the referring site's host, the utm
 * campaign tags, and a search that found nothing. It does nothing at all when the browser signals Global Privacy Control or Do Not Track.
 * The server re-checks everything it is sent.
 */
export type BeaconHit = { metric: BeaconMetric; dimension?: string };

export function measuringAllowed() {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl !== true && navigator.doNotTrack !== "1";
}

/** Sends one hit. A `text/plain` body keeps it a simple request; the server reads it as JSON. */
export function sendHit(hit: BeaconHit) {
  if (!measuringAllowed()) return;
  try {
    const body = JSON.stringify(hit.dimension === undefined ? { metric: hit.metric } : { metric: hit.metric, dimension: hit.dimension });
    if (!navigator.sendBeacon?.("/api/public-metrics", new Blob([body], { type: "text/plain" }))) {
      void fetch("/api/public-metrics", { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true, credentials: "omit" }).catch(() => undefined);
    }
  } catch {
    // Measuring must never get in the way of the page.
  }
}

export function PublicMetricsBeacon({ hits = [], notFound = false }: { hits?: BeaconHit[]; notFound?: boolean }) {
  const hitKey = JSON.stringify(hits);

  useEffect(() => {
    for (const hit of JSON.parse(hitKey) as BeaconHit[]) sendHit(hit);
  }, [hitKey]);

  useEffect(() => {
    // The staff workspace is never measured, not even its missing pages.
    if (notFound && !isStaffWorkspacePath(window.location.pathname)) sendHit({ metric: "NOT_FOUND", dimension: firstPathSegment(window.location.pathname) });
  }, [notFound]);

  useEffect(() => {
    // A failed image: only whether it was ours or someone else's, never its address.
    function onError(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (isStaffWorkspacePath(window.location.pathname)) return;
      let external = true;
      try {
        external = new URL(target.currentSrc || target.src, window.location.href).origin !== window.location.origin;
      } catch {
        external = true;
      }
      sendHit({ metric: "IMAGE_ERROR", dimension: external ? "external" : "same-origin" });
    }
    window.addEventListener("error", onError, true);
    return () => window.removeEventListener("error", onError, true);
  }, []);

  return null;
}

const reportedVitals = new Set<string>();
/** The page the visit began on. Web vitals describe that page load, so this, not wherever the visitor has since navigated, decides whether they count. */
let landingPath: string | null = null;

/**
 * The web-vitals callback, at module scope so its identity never changes: Next registers the listeners again whenever
 * the callback changes and never removes them. Each measure is reported once per page load, and never from the staff workspace.
 */
export function reportVital(metric: { name: string; rating?: string }) {
  if (!(vitalNames as readonly string[]).includes(metric.name)) return;
  if (typeof window === "undefined" || isStaffWorkspacePath(landingPath ?? window.location.pathname)) return;
  const { rating } = metric;
  if (rating !== "good" && rating !== "needs-improvement" && rating !== "poor") return;
  if (reportedVitals.has(metric.name)) return;
  reportedVitals.add(metric.name);
  sendHit({ metric: "WEB_VITAL", dimension: `${metric.name}:${rating}` });
}

/** Test hook: forget the landing page and the measures already sent. */
export function resetVitalsForTests() {
  sourcesSent = false;
  landingPath = null;
  reportedVitals.clear();
}

let sourcesSent = false;

/**
 * Where this visit came from (#1560), sent once per page load, from the landing page only: the referring site's host,
 * and the utm_source, utm_medium and utm_campaign tags (nothing else from the address). Skipped when the visitor opted
 * out, on the staff workspace, for a reload or back/forward, and for a referrer on this same site. Nothing is stored in
 * the browser. The server cleans and checks both values again.
 */
export function sendLandingSources() {
  if (sourcesSent || typeof window === "undefined" || !measuringAllowed()) return;
  sourcesSent = true;
  if (isStaffWorkspacePath(window.location.pathname)) return;
  const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type === "reload" || navigation?.type === "back_forward") return;
  try {
    const referrer = document.referrer ? new URL(document.referrer) : null;
    if (referrer && (referrer.protocol === "http:" || referrer.protocol === "https:") && referrer.origin !== window.location.origin) {
      sendHit({ metric: "REFERRER_SITE", dimension: referrer.hostname });
    }
  } catch {
    // An unreadable referrer is simply not counted.
  }
  const query = new URLSearchParams(window.location.search);
  const dimension = campaignDimension(query.get("utm_source"), query.get("utm_medium"), query.get("utm_campaign"));
  if (dimension) sendHit({ metric: "CAMPAIGN_VISIT", dimension });
}

/** Mounted once, in the root layout, so the listeners are registered once for the whole visit. */
export function PublicWebVitals() {
  // Remembered once, at the first render of the visit (the layout never remounts on client navigation).
  useEffect(() => { landingPath ??= window.location.pathname; sendLandingSources(); }, []);
  useReportWebVitals(reportVital);
  return null;
}
