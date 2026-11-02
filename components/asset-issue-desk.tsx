"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { assigneeKindLabels, type AssigneeKind } from "@/modules/issued-assets/domain";
import { AssetReturnPanel } from "@/components/asset-return-panel";
import { ListPager } from "@/components/list-pager";
import type { PageSlice } from "@/lib/pagination";
import { cardCell } from "@/components/table-card-labels";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import type { DeskMoney } from "@/modules/issued-assets/returns-view";
import type { AssetLookup, AssigneeOptions, DeskLot, DeskPerson, DeskType, IssuanceRow } from "@/modules/issued-assets/view";

type Item = { code: string; quantity: number };
type Assignee =
  | { kind: "ATTENDEE"; attendeeId: string }
  | { kind: "REGISTRATION"; registrationId: string }
  | { kind: "STAFF"; userId: string }
  | { kind: "ROOM"; eventUnitId: string }
  | { kind: "VEHICLE" | "TEAM"; label: string };
type IssueRequest = {
  assignee: Assignee; assignmentId?: string; items: Item[]; purpose: string; expectedReturnAt?: string;
  entryMethod: "MANUAL" | "SCAN" | "OFFLINE"; occurredAt?: string; idempotencyKey: string;
};
/** A request kept on this device. `rejected` is the server's reason when it refused an offline entry; it stays until dismissed. */
type SavedRequest = IssueRequest & { rejected?: string };
type ItemResult = { index: number; code: string; status: "ISSUED" | "DUPLICATE" | "REPLAYED" | "REJECTED"; identifier?: string; typeName?: string; error?: { message: string } };
type IssueResponse = { holder: { display: string }; issued: number; duplicates: number; rejected: number; items: ItemResult[] };

/** Saved requests belong to one event and one signed-in person: a shared desk never replays someone else's entries. */
const queueKey = (scope: string) => `imsda:issued-assets:queue:${scope}`;

/** Only codes, opaque ids and a key: no names, contact details or form answers are kept on the device. */
function readQueue(scope: string): SavedRequest[] {
  try {
    const raw = window.localStorage.getItem(queueKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as SavedRequest[] : [];
  } catch { return []; }
}
function writeQueue(scope: string, queue: SavedRequest[]) {
  try {
    if (queue.length === 0) window.localStorage.removeItem(queueKey(scope));
    else window.localStorage.setItem(queueKey(scope), JSON.stringify(queue));
  } catch { /* private mode: the page still works, the retry just lives in memory */ }
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`);

/** Both tables sort from their headers (#1458); each has its own prefix, and the keys here are the whitelist. */
const PERSON_SORT: Record<"item" | "qty" | "issued" | "room", ColumnSpec<IssuanceRow>> = {
  item: { value: (row) => row.identifier, label: "item" },
  qty: { value: (row) => row.quantity, label: "quantity", kind: "number" },
  issued: { value: (row) => row.issuedAt, label: "issue date", kind: "date" },
  room: { value: (row) => row.roomName, label: "room" },
};
const OUT_NOW_SORT: Record<"item" | "qty" | "holder" | "room", ColumnSpec<IssuanceRow>> = {
  item: { value: (row) => row.identifier, label: "item" },
  qty: { value: (row) => row.quantity, label: "quantity", kind: "number" },
  holder: { value: (row) => row.holderLabel, label: "holder" },
  room: { value: (row) => row.roomName, label: "room" },
};

function lodgingNote(row: IssuanceRow) {
  if (!row.roomName) return null;
  if (!row.lodging || row.lodging.status === "CURRENT") return `Opens ${row.roomName}`;
  return row.lodging.status === "MOVED"
    ? `Opens ${row.roomName}, but they now stay in ${row.lodging.currentRooms.join(", ")}. Swap the key in Check out.`
    : `Opens ${row.roomName}, but their room was released.`;
}

export function AssetIssueDesk({ eventId, userId, types, lots, options, person, outNow, money = null, canConfigure = false, canManageMoney = false }: {
  eventId: string;
  /** The signed-in staff member: scopes the saved offline requests on this device. */
  userId: string;
  types: DeskType[];
  lots: DeskLot[];
  options: AssigneeOptions;
  person: DeskPerson | null;
  outNow: IssuanceRow[];
  /** Deposits and charges for the person (check-out, #214). */
  money?: DeskMoney | null;
  canConfigure?: boolean;
  canManageMoney?: boolean;
}) {
  const router = useRouter();
  const base = `/api/events/${encodeURIComponent(eventId)}/assets`;
  const scope = `${eventId}:${userId}`;
  const [kind, setKind] = useState<AssigneeKind>(person ? "ATTENDEE" : "ROOM");
  const [other, setOther] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [codeText, setCodeText] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [purpose, setPurpose] = useState("Issued at check-in");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IssueResponse | null>(null);
  const [queue, setQueue] = useState<SavedRequest[]>([]);
  // Codes that arrived the way a barcode scanner types (a fast burst ending in Enter); everything else was typed.
  const [scanned, setScanned] = useState<ReadonlySet<string>>(new Set());
  const keyTimes = useRef<number[]>([]);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Array<{ attendeeId: string; name: string; confirmationCode: string }>>([]);
  const [foundPager, setFoundPager] = useState<Pick<PageSlice<unknown>, "from" | "page" | "pageCount" | "to" | "total"> | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [lookup, setLookup] = useState<AssetLookup | null | "none">(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const searchTicket = useRef(0);

  // Saved requests from an earlier visit (read after mount, so the server and first client render agree).
  useEffect(() => {
    const timer = window.setTimeout(() => setQueue(readQueue(scope)), 0);
    return () => window.clearTimeout(timer);
  }, [scope]);

  /** A scanner types the whole code in a few milliseconds per key; a person, or a paste (one event), does not. */
  function arrivedLikeAScan() {
    const times = keyTimes.current;
    keyTimes.current = [];
    return times.length >= 3 && (times[times.length - 1]! - times[0]!) / (times.length - 1) < 50;
  }

  function addCode(raw: string, quantity = 1, wasScanned = false) {
    const code = raw.trim();
    if (!code) return;
    setScanned((current) => { const next = new Set(current); if (wasScanned) next.add(code.toUpperCase()); else next.delete(code.toUpperCase()); return next; });
    setItems((current) => current.some((item) => item.code.toUpperCase() === code.toUpperCase()) ? current : [...current, { code, quantity }]);
    setCodeText("");
    codeInput.current?.focus();
  }

  function currentAssignee(): Assignee | null {
    if (kind === "ATTENDEE") return person ? { kind, attendeeId: person.attendeeId } : null;
    if (kind === "REGISTRATION") return person ? { kind, registrationId: person.registrationId } : null;
    if (kind === "ROOM") return other ? { kind, eventUnitId: other } : null;
    if (kind === "STAFF") return other ? { kind, userId: other } : null;
    return other.trim() ? { kind, label: other.trim() } : null;
  }

  async function send(request: IssueRequest) {
    const response = await fetch(`${base}/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const json = await response.json();
    if (!response.ok) throw Object.assign(new Error(json.message ?? "That could not be issued."), { server: true, details: json.details });
    return json as IssueResponse;
  }

  /** The one room the desk is showing for the person, when the holder is that person (or their registration). */
  function lonePersonRoom(assignee: Assignee) {
    // Only for the person themselves: a registration may be split across rooms, which the server must ask about.
    if (!person || assignee.kind !== "ATTENDEE" || assignee.attendeeId !== person.attendeeId) return "";
    return new Set(person.rooms.map((room) => room.roomName)).size === 1 ? person.rooms[0]!.assignmentId : "";
  }

  async function submit() {
    const assignee = currentAssignee();
    if (!assignee) { setError("Choose who the items are for."); return; }
    if (items.length === 0) { setError("Scan or type at least one code."); return; }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const allScanned = items.every((item) => scanned.has(item.code.toUpperCase()));
    // The room the key is for. Online the server picks the current one; an entry made offline may be sent after a
    // move, so it carries the assignment the desk was showing when the key was handed over.
    const roomAssignment = assignmentId || (offline ? lonePersonRoom(assignee) : "");
    const request: IssueRequest = {
      assignee, items, purpose: purpose.trim() || "Issued at check-in", idempotencyKey: newKey(),
      entryMethod: offline ? "OFFLINE" : allScanned ? "SCAN" : "MANUAL",
      ...(offline ? { occurredAt: new Date().toISOString() } : {}),
      ...(roomAssignment ? { assignmentId: roomAssignment } : {}),
      ...(expectedReturn ? { expectedReturnAt: new Date(expectedReturn).toISOString() } : {}),
    };
    await deliver(request);
  }

  /** Saves the request (so a closed tab or lost response can replay it with the same key) and sends it. */
  async function deliver(request: IssueRequest) {
    setBusy(true); setError(""); setResult(null);
    const saved = [...readQueue(scope).filter((entry) => entry.idempotencyKey !== request.idempotencyKey), request];
    writeQueue(scope, saved); setQueue(saved);
    try {
      // A request first built offline keeps saying when it really happened when it is replayed later.
      const response = await send(request);
      const refused = response.items.filter((item) => item.status === "REJECTED");
      // An offline entry the server accepted only in part keeps the refused items, with why, until dismissed.
      const remaining = readQueue(scope).flatMap((entry) => (entry.idempotencyKey !== request.idempotencyKey ? [entry]
        : request.entryMethod === "OFFLINE" && refused.length > 0
          ? [{ ...entry, items: refused.map((item) => request.items[item.index]!).filter(Boolean), rejected: refused.map((item) => `${item.identifier ?? item.code}: ${item.error?.message ?? "not issued"}`).join(" ") }]
          : []));
      writeQueue(scope, remaining); setQueue(remaining);
      setResult(response);
      setItems(response.items.filter((item) => item.status === "REJECTED").map((item) => ({ code: item.code, quantity: request.items[item.index]?.quantity ?? 1 })));
      router.refresh();
    } catch (cause) {
      const failure = cause as Error & { server?: boolean; details?: { items?: ItemResult[] } };
      if (failure.server) {
        // The server answered and will not accept this request as it is, so it is never retried. An online request is
        // simply shown the reason; an offline entry (which cannot be redone) stays here with the reason until dismissed.
        const remaining = readQueue(scope).flatMap((entry) => (entry.idempotencyKey !== request.idempotencyKey ? [entry] : request.entryMethod === "OFFLINE" ? [{ ...entry, rejected: failure.message }] : []));
        writeQueue(scope, remaining); setQueue(remaining);
        if (failure.details?.items) setResult({ holder: { display: "" }, issued: 0, duplicates: 0, rejected: failure.details.items.length, items: failure.details.items });
        setError(failure.message);
      } else {
        // Keep the moment it happened: a later replay is an offline entry, and the server records that time.
        const roomAssignment = request.assignmentId;
        const offline: IssueRequest = { ...request, entryMethod: "OFFLINE", occurredAt: request.occurredAt ?? new Date().toISOString(), ...(roomAssignment ? { assignmentId: roomAssignment } : {}) };
        const kept = readQueue(scope).map((entry) => entry.idempotencyKey === request.idempotencyKey ? offline : entry);
        writeQueue(scope, kept); setQueue(kept);
        setError("Not sent. The request is saved on this device; retry when you are connected. Nothing was issued yet.");
      }
    } finally { setBusy(false); }
  }

  async function runSearch(value: string, page = 1) {
    setSearch(value);
    const ticket = (searchTicket.current += 1);
    try {
      const response = await fetch(`${base}/lookup?person=${encodeURIComponent(value.trim())}&page=${page}`, { cache: "no-store" });
      const json = await response.json();
      if (ticket !== searchTicket.current) return; // a newer search has started; ignore this older answer
      setFound(response.ok ? json.people : []);
      setFoundPager(response.ok && typeof json.total === "number" ? json : null);
    } catch {
      if (ticket !== searchTicket.current) return;
      setFound([]); setFoundPager(null);
    }
  }

  async function runLookup() {
    if (!lookupCode.trim()) return;
    setLookup(null); setError("");
    try {
      const response = await fetch(`${base}/lookup?code=${encodeURIComponent(lookupCode.trim())}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message ?? "Lookup failed.");
      setLookup(json.asset ?? "none");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Lookup failed."); }
  }

  async function change(issuanceId: string, body: unknown, done: string) {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(`${base}/issuances/${encodeURIComponent(issuanceId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
      setResult({ holder: { display: "" }, issued: 0, duplicates: 0, rejected: 0, items: [{ index: 0, code: done, status: "ISSUED" }] });
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That could not be saved."); }
    finally { setBusy(false); }
  }

  const openForPerson = person?.issuances.filter((row) => row.open) ?? [];
  const endedForPerson = person?.issuances.filter((row) => !row.open) ?? [];
  const personSort = useTableSort(openForPerson, PERSON_SORT, "issued");
  const outNowSort = useTableSort(outNow, OUT_NOW_SORT, "outNow");
  const kinds = [...new Set(types.flatMap((type) => type.assigneeKinds))];

  return <div className="settings-stack">
    <div className="page-intro"><div>
      <p className="eyebrow">Check-in</p>
      <h2 className="duplicate-page-title">Issue keys and items</h2>
      <p>Scan or type each code. A typed code and a scanned code are checked the same way. Once a person is chosen, Check out records returns, lost or damaged keys and the cash key deposit. The <a href={`/more/issued-assets/closeout?event=${encodeURIComponent(eventId)}`}>closeout</a> lists everything still out or unresolved.</p>
    </div></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}

    {queue.length > 0 ? <section className="panel form-stack" role="status">
      <h3>Saved on this device, not confirmed</h3>
      <p>Requests that did not reach the server, or that it refused, stay here until you dismiss them. Retrying is safe: the same saved key can never issue twice.</p>
      <ul>{queue.map((entry) => <li key={entry.idempotencyKey}>{entry.items.map((item) => item.code).join(", ")}{" "}
        {entry.rejected ? <strong>Not accepted by the server: {entry.rejected} </strong> : null}
        {entry.rejected ? null : <button className="secondary-button" type="button" disabled={busy} onClick={() => void deliver(entry)}>Retry</button>}{" "}
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { const rest = readQueue(scope).filter((other) => other.idempotencyKey !== entry.idempotencyKey); writeQueue(scope, rest); setQueue(rest); }}>{entry.rejected ? "Dismiss" : "Discard"}</button></li>)}</ul>
    </section> : null}

    <section className="panel form-stack">
      <h3>Who is it for?</h3>
      {person ? <p><strong>{person.name}</strong>, registration {person.confirmationCode}.{" "}
        {person.rooms.length === 0 ? "Not placed in a room." : `Room: ${person.rooms.map((room) => room.roomName).join("; ")}.`}
        {person.registrationActive ? "" : " This registration is not active."}</p> : <p>Find an attendee, or choose a room, staff member, vehicle or team below.</p>}
      <label>Find an attendee (name or confirmation code) <input value={search} onChange={(event) => void runSearch(event.target.value)} onFocus={() => { if (found.length === 0) void runSearch(search); }} /></label>
      {found.length > 0 ? <ul>{found.map((row) => <li key={row.attendeeId}><a href={`/check-in/assets?event=${encodeURIComponent(eventId)}&attendee=${encodeURIComponent(row.attendeeId)}`}>{row.name} ({row.confirmationCode})</a></li>)}</ul> : null}
      {found.length > 0 && foundPager ? <ListPager label="Attendee lookup pages" onPage={(page) => void runSearch(search, page)} slice={foundPager} /> : null}
      <label>Issue to <select value={kind} onChange={(event) => { setKind(event.target.value as AssigneeKind); setOther(""); }}>
        {(["ATTENDEE", "REGISTRATION", "ROOM", "STAFF", "VEHICLE", "TEAM"] as const).filter((value) => kinds.includes(value) || kinds.length === 0).map((value) => <option key={value} value={value}>{assigneeKindLabels[value]}</option>)}
      </select></label>
      {kind === "ROOM" ? <label>Room <select value={other} onChange={(event) => setOther(event.target.value)}><option value="">Choose a room</option>{options.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label> : null}
      {kind === "STAFF" ? <label>Staff member <select value={other} onChange={(event) => setOther(event.target.value)}><option value="">Choose a person</option>{options.staff.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label> : null}
      {kind === "VEHICLE" || kind === "TEAM" ? <label>{assigneeKindLabels[kind]} name <input value={other} maxLength={80} onChange={(event) => setOther(event.target.value)} /></label> : null}
      {(kind === "ATTENDEE" || kind === "REGISTRATION") && !person ? <p>Search above to choose the attendee.</p> : null}
      {person && person.rooms.length > 1 ? <label>Room the key is for <select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
        <option value="">Choose a room</option>{person.rooms.map((room) => <option key={room.assignmentId} value={room.assignmentId}>{room.roomName}, {room.firstNight} to {room.lastNight}</option>)}
      </select></label> : null}
    </section>

    <section className="panel form-stack">
      <h3>Items</h3>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); addCode(codeText, 1, arrivedLikeAScan()); }}>
        <label>Scan or type a code (K-214) <input ref={codeInput} value={codeText} onChange={(event) => { keyTimes.current.push(Date.now()); setCodeText(event.target.value); }} autoComplete="off" autoCapitalize="characters" maxLength={64} /></label>
        <button className="secondary-button" type="submit">Add</button>
      </form>
      {lots.length > 0 ? <p>{lots.map((lot) => <button key={lot.code} type="button" className="secondary-button" disabled={lot.remaining <= 0} onClick={() => addCode(lot.code)}>{lot.typeName}: {lot.identifier} ({lot.remaining} left)</button>)}</p> : null}
      {items.length === 0 ? <p>Nothing added yet.</p> : <ul>{items.map((item) => <li key={item.code}>{item.code}{" "}
        <label>Quantity <input type="number" min={1} max={100000} value={item.quantity} onChange={(event) => setItems((current) => current.map((row) => row.code === item.code ? { ...row, quantity: Math.max(1, Number(event.target.value) || 1) } : row))} /></label>{" "}
        <button className="secondary-button" type="button" onClick={() => setItems((current) => current.filter((row) => row.code !== item.code))}>Remove</button></li>)}</ul>}
      <label>Purpose <input value={purpose} maxLength={200} onChange={(event) => setPurpose(event.target.value)} /></label>
      <label>Expected back (optional) <input type="datetime-local" value={expectedReturn} onChange={(event) => setExpectedReturn(event.target.value)} /></label>
      <button className="primary-button" type="button" disabled={busy || items.length === 0} onClick={() => void submit()}>Issue {items.length > 0 ? `${items.length} item${items.length === 1 ? "" : "s"}` : ""}</button>
      {result ? <div role="status">
        <p>{result.issued} issued{result.duplicates ? `, ${result.duplicates} already issued to this holder` : ""}{result.rejected ? `, ${result.rejected} not issued` : ""}.</p>
        <ul>{result.items.map((item) => <li key={`${item.index}:${item.code}`}>{item.identifier ?? item.code}: {item.status === "ISSUED" ? "issued" : item.status === "DUPLICATE" || item.status === "REPLAYED" ? "already issued to this holder, nothing changed" : item.error?.message ?? "not issued"}</li>)}</ul>
      </div> : null}
    </section>

    {person ? <section className="panel form-stack">
      <h3>Issued to {person.name}</h3>
      {openForPerson.length === 0 ? <p>Nothing issued yet.</p> : <div className="table-wrap">{personSort.note}<table role="table" className="report-table table-cards">
        <caption className="sr-only">Open items issued to {person.name}</caption>
        <thead role="rowgroup"><tr role="row">{personSort.header("item", "Item")}{personSort.header("qty", "Qty")}{personSort.header("issued", "Issued")}{personSort.header("room", "Room")}<th role="columnheader" scope="col">Change</th></tr></thead>
        <tbody role="rowgroup">{personSort.rows.map((row) => <tr role="row" key={row.id}>
          <th role="rowheader" scope="row">{row.identifier} <small>{row.typeName}</small></th>
          <td {...cardCell("Qty")}>{row.quantity}</td>
          <td {...cardCell("Issued")}>{new Date(row.issuedAt).toLocaleString()}{row.entryMethod === "OFFLINE" ? " (entered offline)" : ""}</td>
          <td {...cardCell("Room")}>{lodgingNote(row) ?? "Not room-linked"}</td>
          <td {...cardCell(null)}><IssuanceActions row={row} busy={busy} change={change} /></td>
        </tr>)}</tbody>
      </table></div>}
      {endedForPerson.length > 0 ? <details><summary>{endedForPerson.length} earlier issue{endedForPerson.length === 1 ? "" : "s"} (history is kept)</summary>
        <ul>{endedForPerson.map((row) => <li key={row.id}>{row.identifier} ({row.typeName}), {row.endReason?.toLowerCase()} {row.endedAt ? new Date(row.endedAt).toLocaleString() : ""}{row.endNote ? `: ${row.endNote}` : ""}{row.roomName ? `. Opened ${row.roomName}.` : ""}</li>)}</ul></details> : null}
    </section> : null}

    {person && money ? <AssetReturnPanel eventId={eventId} userId={userId} person={person} money={money} types={types} canConfigure={canConfigure} canManageMoney={canManageMoney} /> : null}

    <section className="panel form-stack">
      <h3>Look up an item</h3>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void runLookup(); }}>
        <label>Code <input value={lookupCode} onChange={(event) => setLookupCode(event.target.value)} maxLength={64} /></label>
        <button className="secondary-button" type="submit">Look up</button>
      </form>
      {lookup === "none" ? <p role="status">No item has that code.</p> : lookup ? <div role="status">
        <p><strong>{lookup.asset.identifier}</strong> ({lookup.asset.typeName}), {lookup.asset.availability.toLowerCase()}, {lookup.asset.outQuantity} of {lookup.asset.quantityTotal} out.</p>
        {lookup.open.length === 0 ? <p>Not issued to anyone.</p> : <ul>{lookup.open.map((row) => <li key={row.id}>With {row.holderLabel} ({assigneeKindLabels[row.holderKind].toLowerCase()}){row.quantity > 1 ? `, ${row.quantity}` : ""}. {lodgingNote(row) ?? ""}</li>)}</ul>}
        {lookup.history.length > lookup.open.length ? <details><summary>History ({lookup.history.length})</summary><ul>{lookup.history.map((row) => <li key={row.id}>{row.holderLabel}, {new Date(row.issuedAt).toLocaleString()}{row.open ? " (current)" : `, ${row.endReason?.toLowerCase() ?? "ended"}`}{row.roomName ? `, ${row.roomName}` : ""}</li>)}</ul></details> : null}
      </div> : null}
    </section>

    {!person ? <section className="panel form-stack">
      <h3>Out now</h3>
      {outNow.length === 0 ? <p>Nothing is issued right now.</p> : <div className="table-wrap">{outNowSort.note}<table role="table" className="report-table table-cards">
        <caption className="sr-only">The most recent {outNow.length} open issues</caption>
        <thead role="rowgroup"><tr role="row">{outNowSort.header("item", "Item")}{outNowSort.header("qty", "Qty")}{outNowSort.header("holder", "Holder")}{outNowSort.header("room", "Room")}</tr></thead>
        <tbody role="rowgroup">{outNowSort.rows.map((row) => <tr role="row" key={row.id}><th role="rowheader" scope="row">{row.identifier} <small>{row.typeName}</small></th><td {...cardCell("Qty")}>{row.quantity}</td><td {...cardCell("Holder")}>{row.holderLabel}</td><td {...cardCell("Room")}>{lodgingNote(row) ?? ""}</td></tr>)}</tbody>
      </table></div>}
    </section> : null}
  </div>;
}

function IssuanceActions({ row, busy, change }: { row: IssuanceRow; busy: boolean; change: (id: string, body: unknown, done: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Replacing or swapping a key is part of Check out (the original's return, loss or damage is recorded with it).
  return <div>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => setOpen(!open)}>Entered in error</button>
    {open ? <form className="form-stack" onSubmit={(event) => {
      event.preventDefault();
      void change(row.id, { action: "correct", reason }, `${row.identifier} withdrawn`).then(() => { setOpen(false); setReason(""); });
    }}>
      {row.depositEntryId ? <p>A cash deposit covers this item. Withdrawing it does not settle the deposit: it is listed in the closeout for a decision.</p> : null}
      <label>Reason <input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={300} /></label>
      <button className="secondary-button" type="submit" disabled={busy}>Withdraw</button>
    </form> : null}
  </div>;
}
