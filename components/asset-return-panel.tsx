"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cardCell } from "@/components/table-card-labels";
import { chargeCategoryLabels, facilitySeverities, formatCents, holdKindLabels, returnOutcomeLabels, type ReturnOutcome } from "@/modules/issued-assets/returns-domain";
import { lodgingHoldKinds } from "@/modules/lodging/domain";
import type { DeskPerson, DeskType, IssuanceRow } from "@/modules/issued-assets/view";
import type { DeskMoney } from "@/modules/issued-assets/returns-view";

/**
 * Check-out at the issue desk (#214): return each key or item, record a loss or damage (with a replacement in the same
 * step), take and settle the cash key deposit, record the standard replacement charge, and report a room problem.
 *
 * The desk records; it never moves money. Handing a deposit back is something staff do with cash, and the button only
 * records that they did, in the amount the server worked out from what came back. A return sheet made offline is kept on
 * this device with a saved key and sent when the connection is back: sending it twice changes nothing, and anything the
 * server refuses stays visible, with the reason, until it is dismissed.
 */

type Choice = { outcome: "" | ReturnOutcome; quantity: string; note: string; evidenceRef: string; replacement: string };
type ReturnItem = { issuanceId?: string; code?: string; outcome: ReturnOutcome; quantity?: number; note?: string; evidenceRef?: string; replacementCode?: string };
type ReturnRequest = { items: ReturnItem[]; entryMethod: "MANUAL" | "SCAN" | "OFFLINE"; occurredAt?: string; idempotencyKey: string };
type SavedReturn = ReturnRequest & { rejected?: string };
type ReturnItemResult = { index: number; code: string; status: string; identifier?: string; replacementIdentifier?: string; error?: { message: string } };
type ReturnResponse = { returned: number; lost: number; damaged: number; duplicates: number; rejected: number; items: ReturnItemResult[] };

const queueKey = (scope: string) => `imsda:issued-assets:returns:${scope}`;
function readQueue(scope: string): SavedReturn[] {
  try {
    const raw = window.localStorage.getItem(queueKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as SavedReturn[] : [];
  } catch { return []; }
}
function writeQueue(scope: string, queue: SavedReturn[]) {
  try {
    if (queue.length === 0) window.localStorage.removeItem(queueKey(scope));
    else window.localStorage.setItem(queueKey(scope), JSON.stringify(queue));
  } catch { /* private mode: the sheet still works, the retry just lives in memory */ }
}
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`);
const emptyChoice: Choice = { outcome: "", quantity: "", note: "", evidenceRef: "", replacement: "" };
const stateWords: Record<string, string> = { RETURNED: "returned", DAMAGED: "returned damaged", LOST: "lost", OUTSTANDING: "still out", UNACCOUNTED: "no recorded outcome", CORRECTED: "withdrawn in error", CONTINUED: "continued" };

export function AssetReturnPanel({ eventId, userId, person, money, types, canConfigure, canManageMoney }: {
  eventId: string;
  userId: string;
  person: DeskPerson;
  money: DeskMoney;
  types: DeskType[];
  canConfigure: boolean;
  /** MANAGE_FINANCE or CONFIGURE_EVENT: may record a charge beyond the standard replacement fee. */
  canManageMoney: boolean;
}) {
  const router = useRouter();
  const base = `/api/events/${encodeURIComponent(eventId)}/assets`;
  const scope = `${eventId}:${userId}`;
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [scanText, setScanText] = useState("");
  const [scanned, setScanned] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<ReturnResponse | null>(null);
  const [queue, setQueue] = useState<SavedReturn[]>([]);
  const open = person.issuances.filter((row) => row.open);
  const typeOf = (row: IssuanceRow) => types.find((type) => type.name === row.typeName);
  const choice = (id: string) => choices[id] ?? emptyChoice;
  const setChoice = (id: string, patch: Partial<Choice>) => setChoices((current) => ({ ...current, [id]: { ...(current[id] ?? emptyChoice), ...patch } }));
  const pendingKey = useRef(newKey());

  useEffect(() => {
    const timer = window.setTimeout(() => setQueue(readQueue(scope)), 0);
    return () => window.clearTimeout(timer);
  }, [scope]);

  async function send(request: ReturnRequest) {
    const response = await fetch(`${base}/returns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const json = await response.json();
    if (!response.ok) throw Object.assign(new Error(json.message ?? "That could not be recorded."), { server: true });
    return json as ReturnResponse;
  }

  /** Saves the sheet (so a closed tab or lost response can replay it with the same key) and sends it. */
  async function deliver(request: ReturnRequest) {
    setBusy(true); setError(""); setNotice(""); setResult(null);
    writeQueue(scope, [...readQueue(scope).filter((entry) => entry.idempotencyKey !== request.idempotencyKey), request]); setQueue(readQueue(scope));
    try {
      const response = await send(request);
      const refused = response.items.filter((item) => item.status === "REJECTED");
      // An offline sheet the server accepted only in part keeps the refused lines, with why, until dismissed.
      const remaining = readQueue(scope).flatMap((entry) => (entry.idempotencyKey !== request.idempotencyKey ? [entry]
        : request.entryMethod === "OFFLINE" && refused.length > 0
          ? [{ ...entry, items: refused.map((item) => request.items[item.index]!).filter(Boolean), rejected: refused.map((item) => `${item.identifier ?? item.code}: ${item.error?.message ?? "not recorded"}`).join(" ") }]
          : []));
      writeQueue(scope, remaining); setQueue(remaining);
      setResult(response);
      if (refused.length === 0) { setChoices({}); setScanned([]); pendingKey.current = newKey(); }
      router.refresh();
    } catch (cause) {
      const failure = cause as Error & { server?: boolean };
      if (failure.server) {
        const remaining = readQueue(scope).flatMap((entry) => (entry.idempotencyKey !== request.idempotencyKey ? [entry] : request.entryMethod === "OFFLINE" ? [{ ...entry, rejected: failure.message }] : []));
        writeQueue(scope, remaining); setQueue(remaining);
        setError(failure.message);
      } else {
        // Keep the moment it happened: a later replay is an offline sheet, and the server records that time.
        const offline: ReturnRequest = { ...request, entryMethod: "OFFLINE", occurredAt: request.occurredAt ?? new Date().toISOString() };
        const kept = readQueue(scope).map((entry) => entry.idempotencyKey === request.idempotencyKey ? offline : entry);
        writeQueue(scope, kept); setQueue(kept);
        setError("Not sent. The sheet is saved on this device; retry when you are connected. Nothing was recorded yet.");
      }
    } finally { setBusy(false); }
  }

  function submit() {
    const items: ReturnItem[] = [];
    for (const row of open) {
      const picked = choice(row.id);
      if (!picked.outcome) continue;
      const quantity = !row.serialized && picked.quantity.trim() ? Number(picked.quantity) : undefined;
      items.push({
        issuanceId: row.id, outcome: picked.outcome, ...(quantity && quantity !== row.quantity ? { quantity } : {}),
        ...(picked.note.trim() ? { note: picked.note.trim() } : {}), ...(picked.evidenceRef.trim() ? { evidenceRef: picked.evidenceRef.trim() } : {}),
        ...(picked.replacement.trim() && row.serialized ? { replacementCode: picked.replacement.trim() } : {}),
      });
    }
    for (const code of scanned) items.push({ code, outcome: "RETURNED" });
    if (items.length === 0) { setError("Choose what happened to at least one item, or scan a code."); return; }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    void deliver({ items, entryMethod: offline ? "OFFLINE" : "MANUAL", ...(offline ? { occurredAt: new Date().toISOString() } : {}), idempotencyKey: pendingKey.current });
  }

  /** One money or facility call: the same screen shows the result and refreshes. */
  // One saved key per intended action (the same path and details), kept until the server confirms it: a retry after a lost
  // response replays instead of recording twice, and a different amount or item is a different action with its own key.
  const actionKeys = useRef<Record<string, string>>({});
  async function post(path: string, body: unknown, done: string) {
    setBusy(true); setError(""); setNotice(""); setResult(null);
    const signature = `${path}:${JSON.stringify(body)}`;
    try {
      const keyed = path === "facility" ? body : { ...(body as object), idempotencyKey: (actionKeys.current[signature] ??= newKey()) };
      const response = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(keyed) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
      delete actionKeys.current[signature];
      setNotice(json.blockError ? `${done} The room could not be blocked: ${json.blockError}` : done);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That could not be saved."); }
    finally { setBusy(false); }
  }

  // Open items of a deposit-bearing kind that no deposit covers yet, by kind.
  const uncovered = open.filter((row) => !row.depositEntryId && (typeOf(row)?.depositCents ?? 0) > 0);
  const uncoveredByType = [...new Set(uncovered.map((row) => row.typeName))].map((name) => ({ type: types.find((type) => type.name === name)!, rows: uncovered.filter((row) => row.typeName === name) }));
  // The fate an issue has now: an administrator may have corrected it (a lost key found) or written the loss off.
  const fateOf = (row: IssuanceRow) => money.fates[row.id]?.endReason ?? row.endReason;
  const chargeable = person.issuances.filter((row) => (fateOf(row) === "LOST" || fateOf(row) === "DAMAGED") && !money.fates[row.id]?.writtenOff && !money.charges.some((charge) => charge.issuanceId === row.id));

  return <section className="panel" aria-labelledby="checkout-heading">
    <h3 id="checkout-heading">Check out: {person.name}</h3>
    <p>Choose what happened to each item. The deposit is handed back in full only when every covered item comes back in good order. This desk records; it does not move money.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}

    {queue.length > 0 ? <div role="status">
      <h4>Return sheets saved on this device, not confirmed</h4>
      <ul>{queue.map((entry) => <li key={entry.idempotencyKey}>{entry.items.map((item) => item.code ?? item.issuanceId?.slice(0, 6)).join(", ")}{" "}
        {entry.rejected ? <strong>Not accepted by the server: {entry.rejected} </strong> : <button className="secondary-button" type="button" disabled={busy} onClick={() => void deliver(entry)}>Retry</button>}{" "}
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { const rest = readQueue(scope).filter((other) => other.idempotencyKey !== entry.idempotencyKey); writeQueue(scope, rest); setQueue(rest); }}>{entry.rejected ? "Dismiss" : "Discard"}</button></li>)}</ul>
    </div> : null}

    {open.length === 0 ? <p>Nothing is out for {person.name}.</p> : <>
      <div className="table-wrap"><table role="table" className="report-table table-cards">
        <caption className="sr-only">Items out for {person.name}</caption>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Item</th><th role="columnheader" scope="col">Qty</th><th role="columnheader" scope="col">What happened</th></tr></thead>
        <tbody role="rowgroup">{open.map((row) => {
          const picked = choice(row.id);
          return <tr role="row" key={row.id}>
            <th role="rowheader" scope="row">{row.identifier} <small>{row.typeName}</small>{row.depositEntryId ? <small> (deposit taken)</small> : null}</th>
            <td {...cardCell("Qty")}>{row.quantity}</td>
            <td {...cardCell(null)}>
              <label>What happened to {row.identifier}
                <select value={picked.outcome} onChange={(event) => setChoice(row.id, { outcome: event.target.value as Choice["outcome"] })}>
                  <option value="">Not back yet</option>
                  <option value="RETURNED">{returnOutcomeLabels.RETURNED}</option>
                  <option value="DAMAGED">{returnOutcomeLabels.DAMAGED}</option>
                  <option value="LOST">{returnOutcomeLabels.LOST}</option>
                </select></label>
              {picked.outcome && !row.serialized ? <label>How many of {row.quantity} <input type="number" min={1} max={row.quantity} style={{ width: "100%" }} value={picked.quantity} placeholder={String(row.quantity)} onChange={(event) => setChoice(row.id, { quantity: event.target.value })} /></label> : null}
              {picked.outcome === "LOST" || picked.outcome === "DAMAGED" ? <>
                <label>What happened <input value={picked.note} maxLength={300} required onChange={(event) => setChoice(row.id, { note: event.target.value })} /></label>
                <label>Photo or incident number (optional) <input value={picked.evidenceRef} maxLength={200} onChange={(event) => setChoice(row.id, { evidenceRef: event.target.value })} /></label>
              </> : null}
              {picked.outcome && row.serialized ? <label>New {row.typeName.toLowerCase()} to hand over, if any (code) <input value={picked.replacement} maxLength={64} autoCapitalize="characters" onChange={(event) => setChoice(row.id, { replacement: event.target.value })} /></label> : null}
            </td>
          </tr>;
        })}</tbody>
      </table></div>
      <p><button className="secondary-button" type="button" disabled={busy} onClick={() => setChoices(Object.fromEntries(open.map((row) => [row.id, { ...choice(row.id), outcome: "RETURNED" as const }])))}>Mark everything returned</button></p>
    </>}

    <form onSubmit={(event) => { event.preventDefault(); const code = scanText.trim().toUpperCase(); if (code && !scanned.includes(code)) setScanned((current) => [...current, code]); setScanText(""); }}>
      <label>Or scan or type a returned code (K-214) <input value={scanText} onChange={(event) => setScanText(event.target.value)} maxLength={64} autoComplete="off" autoCapitalize="characters" /></label>
      <button className="secondary-button" type="submit">Add</button>
    </form>
    {scanned.length > 0 ? <p>Returned by code: {scanned.join(", ")} <button className="secondary-button" type="button" onClick={() => setScanned([])}>Clear</button></p> : null}
    <button className="primary-button" type="button" disabled={busy} onClick={submit}>Record check-out</button>
    {result ? <div role="status">
      <p>{result.returned} returned{result.damaged ? `, ${result.damaged} returned damaged` : ""}{result.lost ? `, ${result.lost} lost` : ""}{result.duplicates ? `, ${result.duplicates} already recorded, nothing changed` : ""}{result.rejected ? `, ${result.rejected} not recorded` : ""}.</p>
      <ul>{result.items.map((item) => <li key={`${item.index}:${item.code}`}>{item.identifier ?? item.code}: {item.status === "REJECTED" ? item.error?.message ?? "not recorded" : item.status === "DUPLICATE" || item.status === "REPLAYED" ? "already recorded, nothing changed" : item.status.toLowerCase()}{item.replacementIdentifier ? `, replaced by ${item.replacementIdentifier}` : ""}</li>)}</ul>
    </div> : null}

    <h4>Cash key deposit</h4>
    {uncoveredByType.map(({ type, rows }) => <DepositForm key={type.id} type={type} rows={rows} busy={busy} onSubmit={(amountCents) => post("deposits", { action: "record", issuanceIds: rows.map((row) => row.id), amountCents }, `Recorded a ${formatCents(amountCents)} cash deposit for ${rows.map((row) => row.identifier).join(", ")}.`)} />)}
    {money.deposits.length === 0 && uncoveredByType.length === 0 ? <p>No deposit has been taken for this person.</p> : null}
    {money.deposits.map((deposit) => <div key={deposit.entryId} className="panel">
      <p><strong>{formatCents(deposit.amountCents)} cash deposit</strong> ({deposit.typeName}), taken by {deposit.takenByName} {new Date(deposit.takenAt).toLocaleString()}. Covers: {deposit.covers.map((cover) => `${cover.identifier} (${stateWords[cover.state] ?? cover.state})`).join(", ")}.</p>
      {deposit.settled ? <p role="status">Settled: {formatCents(deposit.settled.refundCents)} handed back, {formatCents(deposit.settled.keepCents)} kept{deposit.settled.lateHandedBackCents > 0 ? ` (${formatCents(deposit.settled.lateHandedBackCents)} of that handed back later after a found item; ${formatCents(deposit.keptRemainingCents)} still held)` : ""} ({new Date(deposit.settled.at).toLocaleString()}, {deposit.settled.byName}).</p>
        : deposit.outcome && deposit.outcome.ok ? <div>
          <p role="status">{deposit.outcome.message}</p>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void post("deposits", { action: "settle", depositEntryId: deposit.entryId }, deposit.outcome && deposit.outcome.ok && deposit.outcome.refundCents > 0 ? `Recorded: ${formatCents(deposit.outcome.refundCents)} handed back${deposit.outcome.keepCents > 0 ? `, ${formatCents(deposit.outcome.keepCents)} kept` : ""}.` : `Recorded: the ${formatCents(deposit.outcome?.ok ? deposit.outcome.keepCents : 0)} deposit is kept.`)}>
            {deposit.outcome.refundCents > 0 ? `I handed back ${formatCents(deposit.outcome.refundCents)}${deposit.outcome.keepCents > 0 ? ` and kept ${formatCents(deposit.outcome.keepCents)}` : ""}` : `Record the ${formatCents(deposit.outcome.keepCents)} deposit as kept`}
          </button>
        </div>
        : <p>{deposit.outcome && !deposit.outcome.ok ? deposit.outcome.message : ""}</p>}
    </div>)}

    {chargeable.length > 0 || money.charges.length > 0 ? <>
      <h4>Lost or damaged items and charges</h4>
      {chargeable.map((row) => {
        const type = typeOf(row);
        const fee = (type?.replacementFeeCents ?? 0) * (row.endQuantity ?? row.quantity);
        // A deposit that already kept money for this loss: charging the whole fee as well would take it twice.
        const kept = money.deposits.find((deposit) => deposit.entryId === row.depositEntryId)?.keptRemainingCents ?? 0;
        return <ChargeForm key={row.id} row={row} lost={fateOf(row) === "LOST"} fee={fee} keptByDeposit={kept} canManageMoney={canManageMoney} busy={busy}
          onCharge={(category, amountCents, reason, confirmKeptDeposit) => post("charges", { action: "charge", issuanceId: row.id, category, amountCents, reason, post: true, ...(confirmKeptDeposit ? { confirmKeptDeposit: true } : {}) }, `Charged ${formatCents(amountCents)} for ${row.identifier} to the registration.`)} />;
      })}
      {money.charges.length > 0 ? <ul>{money.charges.map((charge) => <li key={charge.entryId}>{charge.identifier}: {chargeCategoryLabels[charge.category]} charge {formatCents(charge.amountCents)}{charge.posted ? " (posted to the registration)" : " (recorded only)"}{charge.waived ? ", waived" : ""}{charge.depositOffsetCents > 0 ? `; the deposit that was kept covered ${formatCents(charge.depositOffsetCents)} of it` : ""}. {charge.reason}</li>)}</ul> : null}
      {money.charges.some((charge) => !charge.waived) ? <p>Waiving a charge needs finance or an event administrator and is done from the <a href={`/more/issued-assets/closeout?event=${encodeURIComponent(eventId)}`}>closeout</a>.</p> : null}
    </> : null}

    <h4>Room inspection</h4>
    <FacilityForm rooms={person.rooms} issuanceId={open[0]?.id ?? person.issuances[0]?.id} canConfigure={canConfigure} busy={busy}
      onSubmit={(body) => post("facility", body, "Reported. It is on the closeout until it is resolved.")} />
  </section>;
}

function DepositForm({ type, rows, busy, onSubmit }: { type: DeskType; rows: IssuanceRow[]; busy: boolean; onSubmit: (amountCents: number) => Promise<void> }) {
  const [amount, setAmount] = useState((type.depositCents / 100).toFixed(2));
  const cents = Math.round(Number(amount) * 100);
  return <form onSubmit={(event) => { event.preventDefault(); if (cents >= 1) void onSubmit(cents); }}>
    <p>{rows.map((row) => row.identifier).join(", ")} ({type.name}) has no deposit yet. Usual deposit {formatCents(type.depositCents)}.</p>
    <label>Cash taken (dollars) <input type="number" min="0.01" step="0.01" style={{ width: "100%" }} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    <button className="secondary-button" type="submit" disabled={busy || !(cents >= 1)}>Record {Number.isFinite(cents) && cents >= 1 ? formatCents(cents) : "the"} deposit taken</button>
  </form>;
}

function ChargeForm({ row, lost, fee, keptByDeposit, canManageMoney, busy, onCharge }: {
  row: IssuanceRow; lost: boolean; fee: number; keptByDeposit: number; canManageMoney: boolean; busy: boolean;
  onCharge: (category: "REPLACEMENT" | "DAMAGE" | "OTHER", amountCents: number, reason: string, confirmKeptDeposit?: boolean) => Promise<void>;
}) {
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<"REPLACEMENT" | "DAMAGE" | "OTHER">(lost ? "REPLACEMENT" : "DAMAGE");
  const [reason, setReason] = useState("");
  const what = `${row.identifier} (${row.typeName}) ${lost ? "was lost" : "came back damaged"}`;
  if (keptByDeposit > 0) {
    return <div>
      <p>{what}. The cash deposit already kept {formatCents(keptByDeposit)} for lost or damaged items, so the standard fee is not offered: charging it as well would take the guest&apos;s money twice.</p>
      {canManageMoney ? <form onSubmit={(event) => { event.preventDefault(); const cents = Math.round(Number(amount) * 100); if (cents >= 1 && reason.trim().length >= 3) void onCharge(category === "OTHER" ? "REPLACEMENT" : category, cents, reason.trim(), true); }}>
        <label>Full cost of the loss (dollars); only the part above {formatCents(keptByDeposit)} is charged <input type="number" min="0.01" step="0.01" style={{ width: "100%" }} value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
        <label>Reason <input value={reason} maxLength={500} minLength={3} required onChange={(event) => setReason(event.target.value)} /></label>
        <button className="secondary-button" type="submit" disabled={busy}>Charge only the part above the kept deposit</button>
      </form> : <p>Finance or an event administrator can charge the part above what the deposit kept.</p>}
    </div>;
  }
  return <div>
    <p>{what}. {fee > 0 ? `The standard replacement fee is ${formatCents(fee)}. If the cash deposit is settled before this is charged, it will not be kept for this item as well.` : "This kind has no standard replacement fee."}</p>
    {fee > 0 ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void onCharge("REPLACEMENT", fee, `Replacement fee for ${row.identifier}`)}>Charge {formatCents(fee)} to the registration</button> : null}
    {canManageMoney ? <>{" "}<button className="secondary-button" type="button" onClick={() => setCustom(!custom)}>{custom ? "Cancel" : "Another amount"}</button></> : null}
    {custom && canManageMoney ? <form onSubmit={(event) => { event.preventDefault(); const cents = Math.round(Number(amount) * 100); if (cents >= 1 && reason.trim().length >= 3) void onCharge(category, cents, reason.trim()); }}>
      <label>Kind of charge <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>{(["REPLACEMENT", "DAMAGE", "OTHER"] as const).map((value) => <option key={value} value={value}>{chargeCategoryLabels[value]}</option>)}</select></label>
      <label>Amount (dollars) <input type="number" min="0.01" step="0.01" style={{ width: "100%" }} value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
      <label>Reason <input value={reason} maxLength={500} minLength={3} required onChange={(event) => setReason(event.target.value)} /></label>
      <button className="secondary-button" type="submit" disabled={busy}>Charge to the registration</button>
    </form> : null}
  </div>;
}

function FacilityForm({ rooms, issuanceId, canConfigure, busy, onSubmit }: { rooms: DeskPerson["rooms"]; issuanceId: string | undefined; canConfigure: boolean; busy: boolean; onSubmit: (body: unknown) => Promise<void> }) {
  const [unitId, setUnitId] = useState(rooms[0]?.unitId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<(typeof facilitySeverities)[number]>("MEDIUM");
  const [block, setBlock] = useState(false);
  const [kind, setKind] = useState<(typeof lodgingHoldKinds)[number]>("DAMAGE");
  const [firstNight, setFirstNight] = useState(rooms[0]?.lastNight ?? "");
  const [lastNight, setLastNight] = useState(rooms[0]?.lastNight ?? "");
  if (rooms.length === 0) return <p>This person has no room on record, so there is no room to inspect.</p>;
  return <form onSubmit={(event) => {
    event.preventDefault();
    void onSubmit({
      action: "report", targetKind: "UNIT", eventUnitId: unitId, title, severity, source: "CHECKOUT_INSPECTION", ...(description.trim() ? { description: description.trim() } : {}),
      ...(issuanceId ? { sourceIssuanceId: issuanceId } : {}),
      ...(block && canConfigure ? { block: { kind, reason: title, firstNight, lastNight } } : {}),
    }).then(() => { setTitle(""); setDescription(""); setBlock(false); });
  }}>
    {rooms.length > 1 ? <label>Room <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>{rooms.map((room) => <option key={room.assignmentId} value={room.unitId}>{room.roomName}</option>)}</select></label> : <p>Room: {rooms[0]!.roomName}</p>}
    <label>What is wrong <input value={title} maxLength={160} minLength={3} required onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Details (optional) <textarea value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Severity <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>{facilitySeverities.map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}</select></label>
    {canConfigure ? <>
      <label className="checkbox-label"><input type="checkbox" checked={block} onChange={(event) => setBlock(event.target.checked)} /> Also block the room for later nights (nobody who is already placed is moved)</label>
      {block ? <>
        <label>Kind of block <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>{lodgingHoldKinds.map((value) => <option key={value} value={value}>{holdKindLabels[value]}</option>)}</select></label>
        <label>First night <input type="date" value={firstNight} onChange={(event) => setFirstNight(event.target.value)} required /></label>
        <label>Last night <input type="date" value={lastNight} onChange={(event) => setLastNight(event.target.value)} required /></label>
      </> : null}
    </> : <p>An event administrator can block the room once the issue is reported.</p>}
    <button className="secondary-button" type="submit" disabled={busy}>Report the room problem</button>
  </form>;
}
