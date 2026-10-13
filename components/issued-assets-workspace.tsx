"use client";

import { useState } from "react";
import {
  assetAvailabilities,
  assetConditions,
  assigneeKinds,
  assigneeKindLabels,
  type AssetAvailability,
  type AssetCondition,
  type AssigneeKind,
} from "@/modules/issued-assets/domain";
import { depositShortfalls, depositShortfallLabels, formatCents } from "@/modules/issued-assets/returns-domain";
import type { CatalogAsset, CatalogType, CatalogView } from "@/modules/issued-assets/view";

type Result = { created?: number; skipped?: number };

async function call(url: string, body: unknown): Promise<{ result: Result; catalog: CatalogView }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
  return json;
}

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

export function IssuedAssetsWorkspace({ eventId, eventName, initialCatalog }: { eventId: string; eventName: string; initialCatalog: CatalogView }) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/events/${encodeURIComponent(eventId)}/assets`;

  async function run(url: string, body: unknown, success: (result: Result) => string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await call(url, body);
      setCatalog(response.catalog);
      setNotice(success(response.result));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That could not be saved.");
      return false;
    } finally { setBusy(false); }
  }

  return <div className="settings-stack">
    <div className="page-intro"><div>
      <p className="eyebrow">Event configuration</p>
      <h2 className="duplicate-page-title">Issued assets</h2>
      <p>Keys, keycards, wristbands, radios, welcome packets and other items {eventName} hands out. A <strong>numbered</strong> kind (a key) has one holder at a time; a <strong>quantity</strong> kind (a welcome packet) is a lot of identical items. Staff issue them from the <a href={`/check-in/assets?event=${encodeURIComponent(eventId)}`}>check-in issue desk</a>. Check-out, cash key deposits, charges and room problems are on the same desk; the <a href={`/more/issued-assets/closeout?event=${encodeURIComponent(eventId)}`}>closeout</a> lists everything still out, lost, charged, held or unresolved.</p>
    </div></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="usage-note" role="status">{notice}</p> : null}

    <section className="panel">
      <h3>Add a kind of item</h3>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void run(`${base}/types`, {
          action: "create", name: data.get("name"), mode: data.get("mode"), assigneeKinds: data.getAll("kinds"), roomLinked: data.get("roomLinked") === "on",
          depositPolicyRef: data.get("depositPolicyRef"), replacementPolicyRef: data.get("replacementPolicyRef"),
          depositCents: dollarsToCents(data.get("depositDollars")), depositShortfall: data.get("depositShortfall"), replacementFeeCents: dollarsToCents(data.get("replacementDollars")),
        }, () => "Kind of item added.").then((ok) => { if (ok) form.reset(); });
      }}>
        <label>Name <input name="name" required maxLength={80} placeholder="Dorm room key" /></label>
        <label>Behaviour <select name="mode" defaultValue="SERIALIZED">
          <option value="SERIALIZED">Numbered (one holder at a time)</option>
          <option value="QUANTITY">Quantity (a lot of identical items)</option>
        </select></label>
        <fieldset><legend>Can be issued to</legend>
          {assigneeKinds.map((kind) => <label className="checkbox-label" key={kind}><input type="checkbox" name="kinds" value={kind} defaultChecked={kind === "ATTENDEE" || kind === "REGISTRATION"} /> {assigneeKindLabels[kind]}</label>)}
        </fieldset>
        <label className="checkbox-label"><input type="checkbox" name="roomLinked" /> Room-linked: remember the room and the exact lodging assignment it was issued against</label>
        <label>Deposit policy reference (optional) <input name="depositPolicyRef" maxLength={120} placeholder="CM26 key deposit" /></label>
        <label>Replacement policy reference (optional) <input name="replacementPolicyRef" maxLength={120} /></label>
        <MoneyFields />
        <button className="primary-button" type="submit" disabled={busy}>Add kind of item</button>
      </form>
    </section>

    {catalog.types.length === 0 ? <p>No kinds of item yet.</p> : catalog.types.map((type) => <TypePanel
      key={type.id} type={type} assets={catalog.assets.filter((asset) => asset.typeId === type.id)} base={base} busy={busy} run={run}
    />)}
    {catalog.truncated ? <p role="status">Only the first items are listed. Narrow the catalog before adding more.</p> : null}
  </div>;
}

/** Dollars typed by staff to whole cents; blank is zero. */
function dollarsToCents(value: FormDataEntryValue | null) {
  const cents = Math.round(Number(String(value ?? "").trim() || 0) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : 0;
}

/** The kind's money policy (#214): the usual cash deposit, what happens to it when an item is missing, and the replacement fee. */
function MoneyFields({ type }: { type?: CatalogType }) {
  return <>
    <label>Usual cash deposit per holder (dollars, 0 for none) <input name="depositDollars" type="number" min="0" step="0.01" style={{ width: "100%" }} defaultValue={((type?.depositCents ?? 0) / 100).toFixed(2)} /></label>
    <label>If an item is missing or damaged <select name="depositShortfall" defaultValue={type?.depositShortfall ?? "KEEP_ALL"}>
      {depositShortfalls.map((value) => <option key={value} value={value}>{depositShortfallLabels[value]}</option>)}
    </select></label>
    <label>Replacement fee for one item (dollars, 0 for none) <input name="replacementDollars" type="number" min="0" step="0.01" style={{ width: "100%" }} defaultValue={((type?.replacementFeeCents ?? 0) / 100).toFixed(2)} /></label>
  </>;
}

type Run = (url: string, body: unknown, success: (result: Result) => string) => Promise<boolean>;

function TypePanel({ type, assets, base, busy, run }: { type: CatalogType; assets: CatalogAsset[]; base: string; busy: boolean; run: Run }) {
  const serialized = type.mode === "SERIALIZED";
  const setKinds = (kind: AssigneeKind, on: boolean) => {
    const next = on ? [...new Set([...type.assigneeKinds, kind])] : type.assigneeKinds.filter((existing) => existing !== kind);
    if (next.length === 0) return;
    void run(`${base}/types`, { action: "update", typeId: type.id, assigneeKinds: next }, () => `${type.name} updated.`);
  };
  return <section className="panel">
    <h3>{type.name}{type.active ? "" : " (switched off)"}</h3>
    <p>{serialized ? "Numbered" : "Quantity"}. {type.assetCount} {serialized ? "items" : "lots"}; {type.availableQuantity} in stock, {type.outQuantity} out.{type.roomLinked ? " Room-linked." : ""}{type.depositPolicyRef ? ` Deposit policy: ${type.depositPolicyRef}.` : ""}{type.replacementPolicyRef ? ` Replacement policy: ${type.replacementPolicyRef}.` : ""}{type.depositCents > 0 ? ` Usual cash deposit ${formatCents(type.depositCents)}.` : ""}{type.replacementFeeCents > 0 ? ` Replacement fee ${formatCents(type.replacementFeeCents)}.` : ""}</p>
    <div>
      <label className="checkbox-label"><input type="checkbox" checked={type.active} disabled={busy} onChange={(event) => void run(`${base}/types`, { action: "update", typeId: type.id, active: event.target.checked }, () => `${type.name} ${event.target.checked ? "switched on" : "switched off"}.`)} /> Active</label>{" "}
      <label className="checkbox-label"><input type="checkbox" checked={type.roomLinked} disabled={busy} onChange={(event) => void run(`${base}/types`, { action: "update", typeId: type.id, roomLinked: event.target.checked }, () => `${type.name} updated.`)} /> Room-linked</label>
      <fieldset><legend>Can be issued to</legend>
        {assigneeKinds.map((kind) => <label className="checkbox-label" key={kind}><input type="checkbox" checked={type.assigneeKinds.includes(kind)} disabled={busy} onChange={(event) => setKinds(kind, event.target.checked)} /> {assigneeKindLabels[kind]}</label>)}
      </fieldset>
    </div>
    <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void run(`${base}/types`, {
        action: "update", typeId: type.id, depositPolicyRef: data.get("depositPolicyRef"), replacementPolicyRef: data.get("replacementPolicyRef"),
        depositCents: dollarsToCents(data.get("depositDollars")), depositShortfall: data.get("depositShortfall"), replacementFeeCents: dollarsToCents(data.get("replacementDollars")),
      }, () => `${type.name} updated.`);
    }}>
      <label>Deposit policy reference <input name="depositPolicyRef" maxLength={120} defaultValue={type.depositPolicyRef ?? ""} /></label>
      <label>Replacement policy reference <input name="replacementPolicyRef" maxLength={120} defaultValue={type.replacementPolicyRef ?? ""} /></label>
      <MoneyFields type={type} />
      <button className="secondary-button" type="submit" disabled={busy}>Save policy</button>
    </form>

    <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const scan = String(data.get("scanCode") ?? "").trim();
      void run(`${base}/items`, {
        action: "create", typeId: type.id, identifier: data.get("identifier"), ...(scan ? { scanCode: scan } : {}),
        quantityTotal: serialized ? 1 : Number(data.get("quantityTotal") || 1), condition: data.get("condition"), location: data.get("location"),
      }, () => "Item added.").then((ok) => { if (ok) form.reset(); });
    }}>
      <h4>{serialized ? "Add one item" : "Add a lot"}</h4>
      <label>{serialized ? "Number or identifier" : "Lot name"} <input name="identifier" required maxLength={64} placeholder={serialized ? "K-214" : "WELCOME-PACKETS"} /></label>
      <label>Barcode or QR value (defaults to the identifier) <input name="scanCode" maxLength={64} /></label>
      {serialized ? null : <label>Quantity <input name="quantityTotal" type="number" style={{ width: "100%" }} min={1} max={100000} defaultValue={100} required /></label>}
      <label>Condition <select name="condition" defaultValue="GOOD">{assetConditions.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Location <input name="location" maxLength={120} placeholder="Front desk" /></label>
      <button className="secondary-button" type="submit" disabled={busy}>Add</button>
    </form>

    {serialized ? <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void run(`${base}/items`, {
        action: "bulk", typeId: type.id, prefix: data.get("prefix"), from: Number(data.get("from")), to: Number(data.get("to")), width: Number(data.get("width") || 0),
        condition: data.get("condition"), location: data.get("location"),
      }, (result) => `Added ${result.created ?? 0} item${result.created === 1 ? "" : "s"}${result.skipped ? `; ${result.skipped} already existed and were left alone` : ""}.`);
    }}>
      <h4>Add a numbered range</h4>
      <p>For example prefix K-, from 201 to 260 adds K-201 through K-260. Numbers that already exist are skipped, so it is safe to run twice.</p>
      <label>Prefix <input name="prefix" maxLength={32} placeholder="K-" /></label>
      <label>From <input name="from" type="number" style={{ width: "100%" }} min={0} required defaultValue={1} /></label>
      <label>To <input name="to" type="number" style={{ width: "100%" }} min={0} required defaultValue={60} /></label>
      <label>Zero-pad to width (0 for none) <input name="width" type="number" style={{ width: "100%" }} min={0} max={8} defaultValue={0} /></label>
      <input name="condition" type="hidden" value="GOOD" />
      <input name="location" type="hidden" value="" />
      <button className="secondary-button" type="submit" disabled={busy}>Add range</button>
    </form> : null}

    {assets.length === 0 ? null : <details>
      <summary>{assets.length} {serialized ? "items" : "lots"}</summary>
      <div className="table-wrap"><table className="report-table report-table-auto">
        <thead><tr><th scope="col">Identifier</th><th scope="col">Barcode value</th>{serialized ? null : <th scope="col">Quantity</th>}<th scope="col">Out</th><th scope="col">Condition</th><th scope="col">Location</th><th scope="col">Status</th></tr></thead>
        <tbody>{assets.map((asset) => <tr key={asset.id}>
          <th scope="row">{asset.identifier}</th>
          <td>{asset.scanCode}</td>
          {serialized ? null : <td>{asset.quantityTotal}</td>}
          <td>{asset.outQuantity}</td>
          <td><label className="visually-hidden" htmlFor={`cond-${asset.id}`}>Condition of {asset.identifier}</label>
            <select id={`cond-${asset.id}`} value={asset.condition} disabled={busy} onChange={(event) => void run(`${base}/items`, { action: "update", assetId: asset.id, condition: event.target.value as AssetCondition }, () => `${asset.identifier} updated.`)}>{assetConditions.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></td>
          <td><form onSubmit={(event) => {
            event.preventDefault();
            void run(`${base}/items`, { action: "update", assetId: asset.id, location: new FormData(event.currentTarget).get("location") ?? "" }, () => `${asset.identifier} updated.`);
          }}><label className="visually-hidden" htmlFor={`loc-${asset.id}`}>Location of {asset.identifier}</label><input id={`loc-${asset.id}`} name="location" maxLength={120} defaultValue={asset.location ?? ""} /><button className="secondary-button" type="submit" disabled={busy}>Save</button></form></td>
          <td><label className="visually-hidden" htmlFor={`avail-${asset.id}`}>Status of {asset.identifier}</label>
            <select id={`avail-${asset.id}`} value={asset.availability} disabled={busy} onChange={(event) => void run(`${base}/items`, { action: "update", assetId: asset.id, availability: event.target.value as AssetAvailability }, () => `${asset.identifier} updated.`)}>{assetAvailabilities.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </section>;
}
