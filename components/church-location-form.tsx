"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MapPin, Save } from "lucide-react";
import { notSavedMessage, restoreFocusAfterSave, savedMessage } from "@/components/form-message";
import { HeldSaveButton, SaveResult, type SaveResultState } from "@/components/organization-form-parts";
import styles from "@/components/organization-pages.module.css";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import type { ChurchLocationRecord } from "@/modules/organizations/church-location-repository";
import { displayCoordinate, numberOrNull } from "@/components/church-location-coordinates";

const ChurchLocationMapPicker = dynamic(
  () => import("@/components/church-location-map-picker").then((mod) => mod.ChurchLocationMapPicker),
  { ssr: false, loading: () => <p className="field-help">Loading map…</p> },
);

type LocationResponse = { location?: ChurchLocationRecord; message?: string; issues?: Array<{ message?: string }> };

/**
 * A church's town and map coordinates (#437, #480), for conference staff.
 * Coordinates place the church's listed clubs on the public club map.
 * Staff can either drop a pin on a map (reusing the map library and CSP
 * scoping added for the public club map, #437) or, switching to manual
 * entry, type coordinates in from a source they trust. Address lookup
 * entered here is saved as set by hand (#724); finding a pin from a street
 * address is the separate "Find map locations" step on the directory.
 */
export function ChurchLocationForm({
  endpoint,
  initialLocation,
}: {
  endpoint: string;
  initialLocation: ChurchLocationRecord;
}) {
  const [location, setLocation] = useState(initialLocation);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResultState | null>(null);
  const [cityText, setCityText] = useState(initialLocation.city);
  const [stateText, setStateText] = useState(initialLocation.state);
  const [zipText, setZipText] = useState(initialLocation.zip);
  const [entryMode, setEntryMode] = useState<"manual" | "map">("manual");
  const [latitudeText, setLatitudeText] = useState(initialLocation.latitude !== null ? displayCoordinate(initialLocation.latitude) : "");
  const [longitudeText, setLongitudeText] = useState(initialLocation.longitude !== null ? displayCoordinate(initialLocation.longitude) : "");

  // Dirty while any field differs from the last saved location (#1468).
  const savedLatitude = location.latitude !== null ? displayCoordinate(location.latitude) : "";
  const savedLongitude = location.longitude !== null ? displayCoordinate(location.longitude) : "";
  useUnsavedChangesGuard(
    cityText !== location.city ||
      stateText !== location.state ||
      zipText !== location.zip ||
      latitudeText !== savedLatitude ||
      longitudeText !== savedLongitude,
  );

  const parsedLatitude = numberOrNull(latitudeText);
  const parsedLongitude = numberOrNull(longitudeText);
  const pinLatitude = typeof parsedLatitude === "number" ? parsedLatitude : null;
  const pinLongitude = typeof parsedLongitude === "number" ? parsedLongitude : null;

  function handlePin(latitude: number, longitude: number) {
    setLatitudeText(displayCoordinate(latitude));
    setLongitudeText(displayCoordinate(longitude));
    setResult((current) => (current?.tone === "success" ? null : current));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in a field submits without a click, and the Save button stays focusable while saving, so hold here too.
    if (saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: String(form.get("city") ?? ""),
          state: String(form.get("state") ?? ""),
          zip: String(form.get("zip") ?? ""),
          latitude: parsedLatitude,
          longitude: parsedLongitude,
        }),
      });
      const result = await response.json().catch(() => ({})) as LocationResponse;
      if (!response.ok || !result.location) {
        throw new Error(result.message ?? result.issues?.[0]?.message ?? "The church location could not be saved.");
      }
      setLocation(result.location);
      setCityText(result.location.city);
      setStateText(result.location.state);
      setZipText(result.location.zip);
      setLatitudeText(result.location.latitude !== null ? displayCoordinate(result.location.latitude) : "");
      setLongitudeText(result.location.longitude !== null ? displayCoordinate(result.location.longitude) : "");
      setResult({ tone: "success", text: savedMessage(), slot: "form" });
    } catch (caught) {
      setResult({ tone: "error", text: notSavedMessage(caught instanceof Error ? caught.message : "The church location could not be saved."), slot: "form" });
    } finally {
      setSaving(false);
      restoreFocusAfterSave("church-location-save");
    }
  }

  // The lookup only takes churches that have a street address from the import (ADR 0014). This page does not load the address,
  // so a church with no location row at all (never imported) is told to enter the town or pick the point, and the lookup is
  // offered only to an imported location that still has no map point.
  const offerLookup = location.source === "IMPORT" && location.latitude === null;
  const sourceText = location.source === "IMPORT"
    ? "Comes from the eAdventist import."
    : location.source === "GEOCODED"
      ? "Comes from an accepted address lookup."
      : location.source === "MANUAL"
        ? "Set by hand."
        : "No location on file yet. Enter the town below, or switch to Pick on map and place the point there. Find map locations only looks up churches that have a street address from the eAdventist import.";

  return (
    <form className={`panel form-stack ${styles.stack}`} key={location.updatedAt ?? "new"} onChange={() => setResult((current) => (current?.tone === "success" ? null : current))} onSubmit={save}>
      <p className={styles.statusLine}>
        <strong>Source</strong> {sourceText}
        {offerLookup && <>{" "}If this church has a street address on file, <Link className={styles.textLink} href="/admin/organizations/map-locations">Find map locations</Link> can look up its map point.</>}
      </p>
      <div className={styles.fieldGrid}>
        <label>
          City or town
          <input maxLength={120} name="city" onChange={(event) => setCityText(event.target.value)} value={cityText} placeholder="e.g. Des Moines" />
        </label>
        <label>
          State
          <input maxLength={2} name="state" onChange={(event) => setStateText(event.target.value)} value={stateText} placeholder="e.g. IA" />
        </label>
        <label>
          ZIP code
          <input maxLength={10} name="zip" onChange={(event) => setZipText(event.target.value)} value={zipText} placeholder="e.g. 50309 or 50309-1234" />
        </label>
      </div>
      <div className={styles.fieldGrid}>
        <label>
          Latitude
          <input
            inputMode="decimal"
            name="latitude"
            onChange={(event) => setLatitudeText(event.target.value)}
            placeholder="e.g. 41.5868"
            readOnly={entryMode === "map"}
            value={latitudeText}
          />
        </label>
        <label>
          Longitude
          <input
            inputMode="decimal"
            name="longitude"
            onChange={(event) => setLongitudeText(event.target.value)}
            placeholder="e.g. -93.6250"
            readOnly={entryMode === "map"}
            value={longitudeText}
          />
        </label>
      </div>
      <div>
        <button
          className="secondary-button"
          onClick={() => setEntryMode((mode) => (mode === "map" ? "manual" : "map"))}
          type="button"
        >
          <MapPin aria-hidden="true" size={16} />
          {entryMode === "map" ? "Enter coordinates manually" : "Pick on map"}
        </button>
      </div>
      {entryMode === "map" && (
        <ChurchLocationMapPicker latitude={pinLatitude} longitude={pinLongitude} onChange={handlePin} />
      )}
      <p className={styles.note}>
        {entryMode === "map"
          ? "Click the map to place the church's pin, or drag an existing pin to adjust it. Coordinates fill in above; switch to manual entry to type them instead."
          : "Latitude and longitude are typed in by hand, from a source you trust. Give both or leave both blank, or use “Pick on map” instead."}
        {" "}Saving here marks this location as set by hand, so imports and “Find map locations” leave it alone.
        {" "}A church without coordinates still lists its clubs; it just won&apos;t have a pin on the map.
      </p>
      <div className={styles.saveRow}>
        <HeldSaveButton id="church-location-save" held={saving} icon={<Save aria-hidden="true" size={16} />} label="Save location" />
        <SaveResult result={result} slot="form" />
      </div>
    </form>
  );
}
