"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { firstPathSegment, vitalNames, type BeaconMetric } from "@/modules/public-metrics/domain";

/**
 * The one first-party analytics beacon for public pages (#111). It sends a metric name and an allowlisted dimension to
 * `/api/public-metrics` with `navigator.sendBeacon`: no cookie, no identifier, no third-party script, and no address,
 * search text or referrer. It does nothing at all when the browser signals Global Privacy Control or Do Not Track.
 * The server re-checks everything it is sent.
 */
export type BeaconHit = { metric: BeaconMetric; dimension?: string };

function measuringAllowed() {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl !== true && navigator.doNotTrack !== "1";
}

function send(hit: BeaconHit) {
  if (!measuringAllowed()) return;
  try {
    const body = JSON.stringify(hit.dimension === undefined ? { metric: hit.metric } : { metric: hit.metric, dimension: hit.dimension });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/public-metrics", blob)) {
      void fetch("/api/public-metrics", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit" }).catch(() => undefined);
    }
  } catch {
    // Measuring must never get in the way of the page.
  }
}

export function PublicMetricsBeacon({ hits = [], notFound = false, vitals = true }: { hits?: BeaconHit[]; notFound?: boolean; vitals?: boolean }) {
  const hitKey = JSON.stringify(hits);

  useEffect(() => {
    for (const hit of JSON.parse(hitKey) as BeaconHit[]) send(hit);
  }, [hitKey]);

  useEffect(() => {
    if (notFound) send({ metric: "NOT_FOUND", dimension: firstPathSegment(window.location.pathname) });
  }, [notFound]);

  useEffect(() => {
    // A failed image: only whether it was ours or someone else's, never its address.
    function onError(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      let external = true;
      try {
        external = new URL(target.currentSrc || target.src, window.location.href).origin !== window.location.origin;
      } catch {
        external = true;
      }
      send({ metric: "IMAGE_ERROR", dimension: external ? "external" : "same-origin" });
    }
    window.addEventListener("error", onError, true);
    return () => window.removeEventListener("error", onError, true);
  }, []);

  return vitals ? <WebVitals /> : null;
}

function WebVitals() {
  useReportWebVitals((metric) => {
    if (!(vitalNames as readonly string[]).includes(metric.name)) return;
    const rating = (metric as { rating?: string }).rating;
    if (rating === "good" || rating === "needs-improvement" || rating === "poor") send({ metric: "WEB_VITAL", dimension: `${metric.name}:${rating}` });
  });
  return null;
}
