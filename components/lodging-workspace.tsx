"use client";

import { EventSetupHelp } from "@/components/event-setup-help";
import { StaffPageHeader } from "@/components/staff-page-header";
import labels from "@/components/lodging-labels.module.css";
import { cardCell } from "@/components/table-card-labels";
import { lodgingNightsLine } from "@/modules/lodging/lodging-views-model";
import { useState } from "react";
import { useEditedForms } from "@/components/use-edited-forms";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import {
  lodgingCategories,
  lodgingCategoryLabels,
  lodgingRateBases,
  lodgingRateBasisLabels,
  type LodgingCategory,
  type LodgingRateBasis,
} from "@/modules/lodging/domain";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import type { LodgingUnitView, LodgingView } from "@/modules/lodging/service";
import { formatCentsPlain } from "@/modules/payments/format-cents";

async function call(url: string, method: string, body: unknown): Promise<{ lodging: LodgingView }> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
  return json;
}

function nightsInService(unit: LodgingUnitView) {
  return unit.nightStatuses.filter((status) => status === "AVAILABLE").length;
}

function describeUnit(unit: LodgingUnitView) {
  const parts = [unit.beds || (unit.isArea ? "counted area" : "no beds listed")];
  if (unit.floor) parts.push(`floor ${unit.floor}`);
  if (unit.bathroom === "PRIVATE") parts.push("private bath");
  if (unit.bathroom === "SHARED") parts.push("shared bath");
  if (unit.bathroom === "BATHHOUSE") parts.push("bathhouse");
  if (unit.specialUse) parts.push("special use");
  if (!unit.assignable) parts.push("not assignable");
  return parts.join(", ");
}

export function LodgingWorkspace({ eventName, initialView, canSetRates, canSeeRegistrationPages }: { eventName: string; initialView: LodgingView; canSetRates: boolean; /** The viewer also manages registrations, so the Requests and Assignments pages are theirs to open. */ canSeeRegistrationPages: boolean }) {
  const [view, setView] = useState(initialView);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/events/${view.eventId}/lodging`;

  async function run(action: () => Promise<{ lodging: LodgingView }>, success: string): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      setView(result.lodging);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That could not be saved.");
      return false;
    } finally { setBusy(false); }
  }

  return <div className="settings-stack">
    <StaffPageHeader description={`Rooms, beds and sites for ${eventName}, night by night. This is inventory only: nobody is assigned here, and a guest's request is not a placement.`} />
    {view.property ? <p className={labels.context}><span><strong>{view.property.name}</strong></span><span>{lodgingNightsLine(view.nights)}</span></p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="usage-note" role="status">{notice}</p> : null}

    {!view.property ? <section className="panel">
      <h3>Choose a property</h3>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        const key = new FormData(event.currentTarget).get("propertyKey");
        void run(() => call(base, "POST", { propertyKey: key }), "Property chosen.");
      }}>
        {view.availableProperties.length === 0
          ? <><p>No properties are set up yet. Ask a system administrator to load the lodging properties.</p><EventSetupHelp context="lodging properties" id="lodging-no-properties" /></>
          : <>
            <label>Property <select name="propertyKey" required>{view.availableProperties.map((property) => <option key={property.key} value={property.key}>{property.name}</option>)}</select></label>
            <div className="filter-bar-actions"><button className="primary-button" type="submit" disabled={busy}>Use this property</button></div>
          </>}
      </form>
    </section> : <>
      <section className="panel">
        <h3>{view.property.name}</h3>
        <p className="field-hint">Hotel details on the event settings page are separate and never counted as on-site lodging.{canSeeRegistrationPages ? " What guests asked for is under Requests; who is placed where is under Assignments." : ""}</p>
        <p>Property layout version {view.property.templateVersion}.{" "}
          {view.property.currentTemplateVersion !== view.property.templateVersion ? <>
            <span role="status">Version {view.property.currentTemplateVersion} is available. Capacities for this event stay as they are until you update.</span>{" "}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(() => call(`${base}/layout`, "POST", {}), "Updated to the latest property layout.")}>Update to latest property layout</button>
          </> : "This event uses the latest layout."}</p>
        {view.nights.length === 0 ? <p>This event has no bookable nights.</p> : <div className="table-wrap"><table className="report-table report-table-auto table-cards" role="table">
          <caption>People the inventory takes, by night</caption>
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Night</th><th role="columnheader" scope="col">Capacity in service</th></tr></thead>
          <tbody role="rowgroup">{view.totalsByNight.map((row) => <tr key={row.night} role="row"><th role="rowheader" scope="row">{row.night}</th><td {...cardCell("Capacity in service")}>{row.capacity}{row.unlimited ? " plus tent camping (no fixed limit)" : ""}</td></tr>)}</tbody>
        </table></div>}
      </section>

      {view.buildings.map((building) => <BuildingUnits key={building.key} building={building} nights={view.nights} base={base} busy={busy} run={run} />)}

      <section className="panel">
        <h3>Lodging rates</h3>
        <p>No rate means lodging is included or free. A tent with power uses the tent rate unless it has its own.</p>
        {canSetRates ? <div className="table-wrap"><table className="report-table report-table-auto table-cards table-cards-wide" role="table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Category</th><th role="columnheader" scope="col">Current rate</th><th role="columnheader" scope="col">Set</th></tr></thead>
          <tbody role="rowgroup">{lodgingCategories.map((category) => <RateRow key={category} category={category} view={view} base={base} busy={busy} run={run} />)}</tbody>
        </table></div> : <p>Only staff who manage finance can set rates.{" "}
          {Object.keys(view.rates).length === 0 ? "None are set." : lodgingCategories.filter((category) => view.rates[category]).map((category) => `${lodgingCategoryLabels[category]}: ${formatRate(view.rates[category]!)}`).join("; ")}</p>}
      </section>
    </>}
  </div>;
}

// Each building's units sort from their headers (#1458); the keys here are the whitelist. The nights table is in date order and
// the rates table is the short fixed list of lodging categories, so neither sorts.
const UNIT_SORT: Record<"unit" | "details" | "sleeps" | "nights" | "unavailable" | "holds", ColumnSpec<LodgingUnitView>> = {
  unit: { value: (unit) => unit.name, label: "unit" },
  details: { value: (unit) => describeUnit(unit), label: "details" },
  sleeps: { value: (unit) => unit.capacityOverride ?? unit.defaultCapacity, label: "sleeps up to", kind: "number" },
  nights: { value: (unit) => nightsInService(unit), label: "nights in service", kind: "number" },
  unavailable: { value: (unit) => unit.unavailable, label: "unavailable" },
  holds: { value: (unit) => unit.holds.filter((hold) => hold.active).length, label: "active holds", kind: "number" },
};

function BuildingUnits({ building, nights, base, busy, run }: {
  building: LodgingView["buildings"][number];
  nights: string[];
  base: string;
  busy: boolean;
  run: (action: () => Promise<{ lodging: LodgingView }>, success: string) => Promise<boolean>;
}) {
  // One shared sort for every building: a header click orders each building's units the same way.
  const sorted = useTableSort(building.units, UNIT_SORT);
  return <section className="panel">
    <h3>{building.name}</h3>
    <div className="table-wrap">{sorted.note}<table className="report-table report-table-auto table-cards table-cards-wide" role="table">
      <thead role="rowgroup"><tr role="row">{sorted.header("unit", "Unit")}{sorted.header("details", "Details")}{sorted.header("sleeps", "Sleeps up to")}{sorted.header("nights", "Nights in service")}{sorted.header("unavailable", "Unavailable")}{sorted.header("holds", "Holds")}</tr></thead>
      <tbody role="rowgroup">{sorted.rows.map((unit) => <UnitRow key={unit.eventUnitId} unit={unit} nights={nights} base={base} busy={busy} run={run} />)}</tbody>
    </table></div>
  </section>;
}

function formatRate(rate: { amountCents: number; basis: LodgingRateBasis; minimumNights: number | null }) {
  return `${formatCentsPlain(rate.amountCents)} ${lodgingRateBasisLabels[rate.basis]}${rate.minimumNights ? `, ${rate.minimumNights}+ nights` : ""}`;
}

function UnitRow({ unit, nights, base, busy, run }: {
  unit: LodgingUnitView;
  nights: string[];
  base: string;
  busy: boolean;
  run: (action: () => Promise<{ lodging: LodgingView }>, success: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const activeHolds = unit.holds.filter((hold) => hold.active);
  // Typed work in this unit's capacity box, hold-release reasons and new-hold form: any field off its starting value. A save,
  // or closing the holds list, clears the forms it covers; a failed save keeps what was typed (#1468).
  const edits = useEditedForms();
  useUnsavedChangesGuard(edits.dirty);
  const holdKeys = ["newHold", ...unit.holds.map((hold) => `release:${hold.id}`)];
  return <>
    <tr role="row">
      <th role="rowheader" scope="row">{unit.name}{unit.retired ? " (Retired)" : ""}
        {unit.unavailable || activeHolds.length > 0 ? <ul className={labels.row} aria-label={`State of ${unit.name}`}>
          {unit.unavailable ? <li className={labels.state}>Unavailable</li> : null}
          {activeHolds.length > 0 ? <li className={labels.state}>{activeHolds.length === 1 ? "On hold" : `${activeHolds.length} holds`}</li> : null}
        </ul> : null}</th>
      <td {...cardCell("Details")}>{describeUnit(unit)}{unit.notes ? ` (${unit.notes})` : ""}</td>
      <td {...cardCell("Sleeps up to")}>
        <form onChange={edits.track("capacity")} onSubmit={(event) => {
          event.preventDefault();
          const raw = String(new FormData(event.currentTarget).get("capacity") ?? "").trim();
          void run(() => call(`${base}/units/${unit.eventUnitId}`, "PATCH", { capacityOverride: raw === "" ? null : Number(raw) }), `Capacity for ${unit.name} saved.`).then((ok) => { if (ok) edits.clear("capacity"); });
        }}>
          <label className="sr-only" htmlFor={`cap-${unit.eventUnitId}`}>Sleeps up to for {unit.name}</label>
          <input id={`cap-${unit.eventUnitId}`} name="capacity" type="number" min={0} max={500} defaultValue={unit.capacityOverride ?? ""} placeholder={unit.defaultCapacity === null ? "no limit" : String(unit.defaultCapacity)} />
          <button type="submit" className="secondary-button" disabled={busy}>Save</button>
        </form>
      </td>
      <td {...cardCell("Nights in service")}>{nightsInService(unit)} of {nights.length}</td>
      <td {...cardCell("Unavailable")}>
        <label><input type="checkbox" checked={unit.unavailable} disabled={busy} onChange={(event) => void run(() => call(`${base}/units/${unit.eventUnitId}`, "PATCH", { unavailable: event.target.checked }), `${unit.name} updated.`)} /> Unavailable</label>
      </td>
      <td {...cardCell("Holds")}><button type="button" className="secondary-button" aria-expanded={open} onClick={() => { if (open) edits.clear(...holdKeys); setOpen(!open); }}>{activeHolds.length} active, {unit.holds.length} total</button></td>
    </tr>
    {open ? <tr role="row"><td colSpan={6} role="cell">
      {unit.holds.length === 0 ? <p>No holds yet.</p> : <ul>{unit.holds.map((hold) => <li key={hold.id}>
        <strong>{({ STAFF: "Staff hold", MAINTENANCE: "Maintenance", SAFETY: "Safety", DAMAGE: "Damage" } as Record<string, string>)[hold.kind] ?? hold.kind}</strong>: {hold.reason}, {hold.firstNight} to {hold.lastNight}{hold.active ? "" : ` (released: ${hold.releaseReason})`}
        {hold.staleDefault ? <span role="alert"> This default hold no longer covers every night of the event. <button type="button" className="secondary-button" disabled={busy || nights.length === 0} onClick={() => void run(() => call(`${base}/holds/${hold.id}`, "PATCH", { action: "change_window", firstNight: nights[0], lastNight: nights[nights.length - 1] }), "Hold extended to cover the event.")}>Extend to cover the event</button></span> : null}
        <ul>{hold.history.map((entry, index) => <li key={index}>{entry.type.toLowerCase().replace("_", " ")} on {entry.at.slice(0, 10)}{entry.reason ? `: ${entry.reason}` : ""}{entry.firstNight ? ` (${entry.firstNight} to ${entry.lastNight})` : ""}</li>)}</ul>
        {hold.active ? <form className={labels.stack} onChange={edits.track(`release:${hold.id}`)} onSubmit={(event) => {
          event.preventDefault();
          const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
          void run(() => call(`${base}/holds/${hold.id}`, "PATCH", { action: "release", reason }), "Hold released.").then((ok) => { if (ok) edits.clear(`release:${hold.id}`); });
        }}>
          <label>Reason for releasing <input name="reason" required maxLength={300} /></label>
          <button type="submit" className="secondary-button" disabled={busy}>Release hold</button>
        </form> : null}
      </li>)}</ul>}
      <form className={labels.stack} onChange={edits.track("newHold")} onSubmit={(event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        void run(() => call(`${base}/units/${unit.eventUnitId}/holds`, "POST", {
          kind: form.get("kind"), reason: form.get("reason"), firstNight: form.get("firstNight"), lastNight: form.get("lastNight"),
        }), `Hold placed on ${unit.name}.`).then((ok) => {
          if (ok) {
            formElement.reset();
            edits.clear("newHold");
          }
        });
      }}>
        <label>Kind <select name="kind"><option value="STAFF">Staff hold</option><option value="MAINTENANCE">Maintenance</option><option value="SAFETY">Safety</option><option value="DAMAGE">Damage</option></select></label>
        <label>Reason <input name="reason" required maxLength={300} /></label>
        <label>First night <input name="firstNight" type="date" required defaultValue={nights[0]} /></label>
        <label>Last night <input name="lastNight" type="date" required defaultValue={nights[nights.length - 1]} /></label>
        <button type="submit" className="secondary-button" disabled={busy || nights.length === 0}>Place hold</button>
      </form>
    </td></tr> : null}
  </>;
}

function RateRow({ category, view, base, busy, run }: {
  category: LodgingCategory;
  view: LodgingView;
  base: string;
  busy: boolean;
  run: (action: () => Promise<{ lodging: LodgingView }>, success: string) => Promise<boolean>;
}) {
  const rate = view.rates[category];
  // Typed work in this category's rate form: any field off its starting value. Saving or removing the rate clears it (#1468).
  const edits = useEditedForms();
  useUnsavedChangesGuard(edits.dirty);
  return <tr role="row">
    <th role="rowheader" scope="row">{lodgingCategoryLabels[category]}</th>
    <td {...cardCell("Current rate")}>{rate ? formatRate(rate) : category === "TENT_WITH_POWER" && view.rates.TENT ? "Uses the tent rate" : "Included or free"}</td>
    {/* Keyed on the saved rate so a save re-mounts the form with defaults that match what is shown ("12.5" becomes "12.50"). */}
    <td {...cardCell("Set")}><form key={rate ? `${rate.amountCents}:${rate.basis}:${rate.minimumNights ?? ""}` : "none"} onChange={edits.track("rate")} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const dollars = Number(form.get("amount"));
      const minimum = String(form.get("minimumNights") ?? "").trim();
      void run(() => call(`${base}/rates`, "PUT", {
        category,
        rate: { amountCents: Math.round(dollars * 100), basis: form.get("basis"), minimumNights: minimum === "" ? null : Number(minimum) },
      }), `${lodgingCategoryLabels[category]} rate saved.`).then((ok) => { if (ok) edits.clear("rate"); });
    }}>
      <label>Amount ($) <input name="amount" type="number" min={0} step="0.01" required defaultValue={rate ? (rate.amountCents / 100).toFixed(2) : ""} /></label>
      <label>Basis <select name="basis" defaultValue={rate?.basis ?? "PER_UNIT_NIGHT"}>{lodgingRateBases.map((basis) => <option key={basis} value={basis}>{lodgingRateBasisLabels[basis]}</option>)}</select></label>
      <label>Minimum nights <input name="minimumNights" type="number" min={1} max={30} defaultValue={rate?.minimumNights ?? ""} /></label>
      <button type="submit" className="secondary-button" disabled={busy}>Save rate</button>
      {rate ? <button type="button" className="secondary-button" disabled={busy} onClick={(event) => {
        const formElement = event.currentTarget.form;
        void run(() => call(`${base}/rates`, "PUT", { category, rate: null }), `${lodgingCategoryLabels[category]} rate removed.`).then((ok) => {
          if (ok) {
            formElement?.reset();
            edits.clear("rate");
          }
        });
      }}>Remove rate</button> : null}
    </form></td>
  </tr>;
}
