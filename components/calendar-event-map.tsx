"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  buildPopupContent,
  dropDelayMs,
  markerLabel,
  type CalendarMapGroup,
} from "@/components/calendar-map-content";
import { nextTileStatus, type TileStatus } from "@/components/public-club-finder-logic";
import styles from "./calendar-event-map.module.css";

export type CalendarMapStatus = "loading" | "ready" | "tiles-failed" | "unavailable";

const defaultCenter: [number, number] = [40.2, -93.0];
const defaultZoom = 6;

/**
 * The calendar's map of upcoming events (#1212): one pin per host site, listing
 * that site's events in a popup. Loaded client-side only (the section imports
 * this lazily), since Leaflet reaches for `window`. Follows the club map's
 * safety pattern: nothing is handed to Leaflet as an HTML string (the popup is
 * DOM nodes, pins are empty divIcons styled in CSS, and the OpenStreetMap
 * attribution is rendered by React), so free-text names are never parsed as markup.
 *
 * The pins drop in once, when the map first scrolls into view. With reduced
 * motion, or no IntersectionObserver, they are simply placed.
 */
export function CalendarEventMap({
  groups,
  onStatus,
}: {
  groups: CalendarMapGroup[];
  /** Reports whether the map library and its tiles loaded, so the page can say so honestly. */
  onStatus?: (status: CalendarMapStatus) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const onStatusRef = useRef(onStatus);
  const tileStatusRef = useRef<TileStatus>("ready");
  const [ready, setReady] = useState(false);
  // Without IntersectionObserver there is nothing to wait for: the pins are placed at once.
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  // Create the map exactly once.
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((leafletModule) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = leafletModule.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: false }).setView(defaultCenter, defaultZoom);
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      // Tile trouble is reported, never fatal: the pins and the list still work. Sticky until Retry remounts the map.
      tiles.on("tileerror", () => {
        const next = nextTileStatus(tileStatusRef.current, "tileerror");
        if (next !== tileStatusRef.current) {
          tileStatusRef.current = next;
          onStatusRef.current?.(next);
        }
      });
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      setReady(true);
      if (tileStatusRef.current === "ready") onStatusRef.current?.("ready");
    }).catch(() => {
      if (!cancelled) onStatusRef.current?.("unavailable");
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  // Pins drop in when the map first scrolls into view; a keyboard visitor tabbing in counts as in view.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRevealed(true);
        observer.disconnect();
      }
    }, { threshold: 0.4 });
    observer.observe(element);
    const onFocus = () => setRevealed(true);
    element.addEventListener("focusin", onFocus);
    return () => {
      observer.disconnect();
      element.removeEventListener("focusin", onFocus);
    };
  }, []);

  // Place the pins once the map exists and has been seen; refit when the shown set changes.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !revealed || !L || !map || !layer) return;
    layer.clearLayers();
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    groups.forEach((group, index) => {
      const icon = L.divIcon({ className: styles.pin, html: false, iconSize: [44, 48], iconAnchor: [22, 48], popupAnchor: [0, -44] });
      const marker = L.marker([group.latitude, group.longitude], { icon, keyboard: true, riseOnHover: true });
      marker.bindPopup(buildPopupContent(document, group), { maxWidth: 280, className: styles.popup });
      marker.addTo(layer);
      const element = marker.getElement();
      if (element) {
        element.setAttribute("aria-label", markerLabel(group));
        element.setAttribute("role", "button");
        if (group.events.length > 1) element.dataset.count = String(group.events.length);
        if (!reduceMotion) {
          element.classList.add(styles.drop);
          element.style.setProperty("--drop-delay", `${dropDelayMs(index, groups.length)}ms`);
        }
      }
    });
    if (groups.length === 1) {
      map.setView([groups[0].latitude, groups[0].longitude], 9);
    } else if (groups.length > 1) {
      map.fitBounds(groups.map((group) => [group.latitude, group.longitude] as [number, number]), { padding: [40, 40], maxZoom: 9 });
    }
  }, [ready, revealed, groups]);

  return (
    <div className={styles.frame}>
      <div aria-label="Map of upcoming events" className={styles.map} ref={containerRef} role="group" />
      <p className={styles.attribution}>
        &copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a> contributors
      </p>
    </div>
  );
}
