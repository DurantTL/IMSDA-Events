"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PackageOpen, Plus } from "lucide-react";
import {
  assetAvailabilities,
  assetConditions,
  assigneeKinds,
  assigneeKindLabels,
  type AssetAvailability,
  type AssetCondition,
} from "@/modules/issued-assets/domain";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditorDialog } from "@/components/editor-dialog";
import { EmptyState } from "@/components/empty-state";
import { formHasEdits } from "@/components/form-has-edits";
import { issueDeskHref } from "@/components/issued-assets-views-model";
import { NavigationLink } from "@/components/navigation-link";
import { PageHeader } from "@/components/page-header";
import { cardCell } from "@/components/table-card-labels";
import { staffPageTitles } from "@/components/staff-navigation";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { formatCentsPlain } from "@/modules/payments/format-cents";
import { depositShortfalls, depositShortfallLabels } from "@/modules/issued-assets/returns-domain";
import type { CatalogAsset, CatalogType, CatalogView } from "@/modules/issued-assets/view";
import styles from "./issued-assets-workspace.module.css";

type Result = { created?: number; skipped?: number };

async function call(url: string, body: unknown): Promise<{ result: Result; catalog: CatalogView }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
  return json;
}

/** Tells the workspace whether one form in an open dialog holds edits, so closing the dialog can ask before discarding them. */
type ReportEdited = (key: string, edited: boolean) => void;

/** Tracks one uncontrolled form for the unsaved-changes guard: `track` goes on its onChange, `clear` runs after a save or reset. */
function useEditedForm(key?: string, report?: ReportEdited) {
  const [edited, setEdited] = useState(false);
  // Unsaved work: any field of this form changed from its starting value, until it is saved or reset (#1468).
  useUnsavedChangesGuard(edited);
  const set = (value: boolean) => { setEdited(value); if (key) report?.(key, value); };
  return { track: (event: FormEvent<HTMLFormElement>) => set(formHasEdits(event.currentTarget)), clear: () => set(false), recheck: (form: HTMLFormElement) => set(formHasEdits(form)) };
}

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

type Dialog = { kind: "add-kind" } | { kind: "edit"; typeId: string } | { kind: "add-items"; typeId: string };

export function IssuedAssetsWorkspace({ eventId, initialCatalog, canOpenDesk, strip }: {
  eventId: string;
  initialCatalog: CatalogView;
  /** The issue and return desk (/check-in/assets) needs MANAGE_CHECK_IN; without it there is no link to a closed page (#1735). */
  canOpenDesk: boolean;
  /** The "Issued item pages" strip, drawn under the header. */
  strip?: React.ReactNode;
}) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // True after an Edit save that stored some groups and then failed on a later one.
  const [partlySaved, setPartlySaved] = useState(false);
  const base = `/api/events/${encodeURIComponent(eventId)}/assets`;
  // The forms of the open dialog that hold edits. A ref: it is only read when the dialog is asked to close.
  const editedForms = useRef(new Set<string>());
  const reportEdited: ReportEdited = (key, edited) => { if (edited) editedForms.current.add(key); else editedForms.current.delete(key); };

  async function run(url: string, body: unknown, success: (result: Result) => string, onError?: (message: string) => void) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await call(url, body);
      setCatalog(response.catalog);
      setNotice(success(response.result));
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That could not be saved.";
      if (onError) onError(message); else setError(message);
      return false;
    } finally { setBusy(false); }
  }

  function openDialog(next: Dialog) {
    // A leftover page message must not appear inside the new dialog.
    setError(""); setNotice("");
    editedForms.current.clear();
    setPartlySaved(false);
    setDialog(next);
  }

  /** The save worked: close and keep its success notice on the page. */
  function closeDialog() {
    editedForms.current.clear();
    setDiscardOpen(false);
    setDialog(null);
  }

  /** Cancel or discard: close and drop any message the dialog showed, so a failed save does not reappear on the page. */
  function abandonDialog() {
    setError(""); setNotice("");
    closeDialog();
  }

  /** Close, Cancel and Escape all come through here: a clean dialog closes at once, a dirty one asks first, and nothing closes mid-save so a failure shows in the open dialog. */
  function requestClose() {
    if (busy) return;
    if (editedForms.current.size > 0) { setDiscardOpen(true); return; }
    abandonDialog();
  }

  const dialogType = dialog && dialog.kind !== "add-kind" ? catalog.types.find((type) => type.id === dialog.typeId) ?? null : null;
  // While a dialog is open its own alert and status show the result; one announcement, not two.
  const pageMessages = dialog === null;

  return <div className={`settings-stack ${styles.stack}`}>
    <PageHeader
      title={staffPageTitles.issuedAssets}
      description="Set up the keys, keycards and other items this event hands out, and see how many of each are in stock."
      primary={<button className="primary-button" type="button" onClick={() => openDialog({ kind: "add-kind" })}><Plus size={16} aria-hidden="true" /> Add a kind of item</button>}
      secondary={canOpenDesk ? <NavigationLink className="secondary-button" href={issueDeskHref(eventId)}>Issue and return desk</NavigationLink> : undefined}
      below={strip}
    />
    {pageMessages && error ? <p className="form-error" role="alert">{error}</p> : null}
    {pageMessages && notice ? <p className="usage-note" role="status">{notice}</p> : null}

    {catalog.types.length === 0
      ? <EmptyState action={{ label: "Add a kind of item", onClick: () => openDialog({ kind: "add-kind" }) }} actionClass="secondary-button" canCreate headingLevel={2} icon={<PackageOpen size={26} aria-hidden="true" />} title="No kinds of item yet">Add a kind of item, such as a dorm room key or a welcome packet, then add its numbered items or its lots.</EmptyState>
      : catalog.types.map((type) => <TypeCard
        key={type.id} type={type} assets={catalog.assets.filter((asset) => asset.typeId === type.id)} base={base} busy={busy} run={run}
        onEdit={() => openDialog({ kind: "edit", typeId: type.id })} onAddItems={() => openDialog({ kind: "add-items", typeId: type.id })}
      />)}
    {catalog.truncated ? <p role="status">Only the first items are listed. Narrow the catalog before adding more.</p> : null}

    {dialog?.kind === "add-kind" ? <EditorDialog className={styles.editor} closeLabel="Close the add a kind of item form" onRequestClose={requestClose} title="Add a kind of item">
      <DialogMessages error={error} notice={notice} />
      <AddKindForm base={base} busy={busy} run={run} report={reportEdited} onCancel={requestClose} onDone={closeDialog} />
    </EditorDialog> : null}
    {dialog?.kind === "edit" && dialogType ? <EditorDialog className={styles.editor} closeLabel={`Close the edit form for ${dialogType.name}`} onRequestClose={requestClose} title={`Edit ${dialogType.name}`}>
      <DialogMessages error={error} notice={notice} />
      <EditTypeForm type={dialogType} base={base} busy={busy} run={run} fail={setError} onPartial={() => setPartlySaved(true)} report={reportEdited} onCancel={requestClose} onDone={closeDialog} />
    </EditorDialog> : null}
    {dialog?.kind === "add-items" && dialogType ? <EditorDialog className={styles.editor} closeLabel={`Close the add items form for ${dialogType.name}`} onRequestClose={requestClose} title={`Add items to ${dialogType.name}`}>
      <DialogMessages error={error} notice={notice} />
      <AddItemsForms type={dialogType} base={base} busy={busy} run={run} report={reportEdited} onCancel={requestClose} onDone={closeDialog} />
    </EditorDialog> : null}

    <ConfirmDialog
      confirmLabel="Discard changes"
      destructive
      onCancel={() => setDiscardOpen(false)}
      onConfirm={abandonDialog}
      open={discardOpen}
      title="Discard your changes?"
    >
      <p>{partlySaved ? "Part of this form was saved. The edits that were not saved are lost if you close now. Keep editing to save them first." : "You have unsaved edits. If you close now they are lost. Keep editing to save them first."}</p>
    </ConfirmDialog>
  </div>;
}

/** What a save made inside a dialog said, shown inside the dialog (an alert for a failure, a status for a success). */
function DialogMessages({ error, notice }: { error: string; notice: string }) {
  return <>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="usage-note" role="status">{notice}</p> : null}
  </>;
}

type Run = (url: string, body: unknown, success: (result: Result) => string, onError?: (message: string) => void) => Promise<boolean>;
type DialogFormProps = { base: string; busy: boolean; run: Run; report: ReportEdited; onCancel: () => void; onDone: () => void };

function AddKindForm({ base, busy, run, report, onCancel, onDone }: DialogFormProps) {
  const addType = useEditedForm("add-kind", report);
  return <form className="form-stack" onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(`${base}/types`, {
      action: "create", name: data.get("name"), mode: data.get("mode"), assigneeKinds: data.getAll("kinds"), roomLinked: data.get("roomLinked") === "on",
      depositPolicyRef: data.get("depositPolicyRef"), replacementPolicyRef: data.get("replacementPolicyRef"),
      depositCents: dollarsToCents(data.get("depositDollars")), depositShortfall: data.get("depositShortfall"), replacementFeeCents: dollarsToCents(data.get("replacementDollars")),
    }, () => "Kind of item added.").then((ok) => { if (ok) { form.reset(); addType.clear(); onDone(); } });
  }} onChange={addType.track}>
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
    <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Add kind of item"}</button></div>
  </form>;
}

/**
 * One Save for what used to be separate controls. It sends the same requests as before (one for Active, one for Room-linked,
 * one for who it can be issued to, one for the policy and money) and only for what changed, one after another.
 */
function EditTypeForm({ type, base, busy, run, fail, onPartial, report, onCancel, onDone }: DialogFormProps & { type: CatalogType; fail: (message: string) => void; onPartial: () => void }) {
  const edit = useEditedForm("edit-kind", report);
  const formRef = useRef<HTMLFormElement>(null);
  // What the form started from. After a partial save the saved groups move to their saved values, so only the groups still unsaved count as edits.
  const [start, setStart] = useState({
    active: type.active, roomLinked: type.roomLinked, kinds: type.assigneeKinds as readonly string[],
    depositPolicyRef: type.depositPolicyRef ?? "", replacementPolicyRef: type.replacementPolicyRef ?? "", depositCents: type.depositCents, depositShortfall: type.depositShortfall as string, replacementFeeCents: type.replacementFeeCents,
  });
  const recheck = edit.recheck;
  useEffect(() => { if (formRef.current) recheck(formRef.current); }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const active = data.get("active") === "on";
    const roomLinked = data.get("roomLinked") === "on";
    const chosen = data.getAll("kinds");
    const kinds = assigneeKinds.filter((kind) => chosen.includes(kind));
    if (kinds.length === 0) { fail("Choose at least one kind of holder this item can be issued to."); return; }
    const kindsChanged = kinds.length !== start.kinds.length || kinds.some((kind) => !start.kinds.includes(kind));
    const policy = {
      depositPolicyRef: data.get("depositPolicyRef"), replacementPolicyRef: data.get("replacementPolicyRef"),
      depositCents: dollarsToCents(data.get("depositDollars")), depositShortfall: data.get("depositShortfall"), replacementFeeCents: dollarsToCents(data.get("replacementDollars")),
    };
    const policyChanged = String(policy.depositPolicyRef ?? "") !== start.depositPolicyRef || String(policy.replacementPolicyRef ?? "") !== start.replacementPolicyRef
      || policy.depositCents !== start.depositCents || policy.depositShortfall !== start.depositShortfall || policy.replacementFeeCents !== start.replacementFeeCents;
    const requests: Array<{ body: Record<string, unknown>; done: string; failed: string; saved: Partial<typeof start> }> = [];
    if (active !== start.active) requests.push({ body: { action: "update", typeId: type.id, active }, done: `${type.name} ${active ? "switched on" : "switched off"}.`, failed: "The Active change", saved: { active } });
    if (roomLinked !== start.roomLinked) requests.push({ body: { action: "update", typeId: type.id, roomLinked }, done: `${type.name} updated.`, failed: "The Room-linked change", saved: { roomLinked } });
    if (kindsChanged) requests.push({ body: { action: "update", typeId: type.id, assigneeKinds: kinds }, done: `${type.name} updated.`, failed: "The change to who it can be issued to", saved: { kinds } });
    if (policyChanged) requests.push({ body: { action: "update", typeId: type.id, ...policy }, done: `${type.name} updated.`, failed: "The policy and money change", saved: { depositPolicyRef: String(policy.depositPolicyRef ?? ""), replacementPolicyRef: String(policy.replacementPolicyRef ?? ""), depositCents: policy.depositCents, depositShortfall: String(policy.depositShortfall), replacementFeeCents: policy.replacementFeeCents } });
    const saved: string[] = [];
    let moved = start;
    for (const request of requests) {
      let reason = "";
      const ok = await run(`${base}/types`, request.body, () => request.done, (message) => { reason = message; });
      if (!ok) {
        if (saved.length === 0) { fail(reason); return; }
        // Say what was stored and what was not.
        fail(`${saved.join(" ")} ${request.failed} could not be saved: ${reason}`);
        onPartial();
        setStart(moved);
        return;
      }
      saved.push(request.done);
      moved = { ...moved, ...request.saved };
    }
    edit.clear();
    onDone();
  }
  return <form ref={formRef} className="form-stack" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }} onChange={edit.track}>
    <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={start.active} /> Active</label>
    <label className="checkbox-label"><input type="checkbox" name="roomLinked" defaultChecked={start.roomLinked} /> Room-linked</label>
    <fieldset><legend>Can be issued to</legend>
      {assigneeKinds.map((kind) => <label className="checkbox-label" key={kind}><input type="checkbox" name="kinds" value={kind} defaultChecked={start.kinds.includes(kind)} /> {assigneeKindLabels[kind]}</label>)}
    </fieldset>
    <label>Deposit policy reference <input name="depositPolicyRef" maxLength={120} defaultValue={start.depositPolicyRef} /></label>
    <label>Replacement policy reference <input name="replacementPolicyRef" maxLength={120} defaultValue={start.replacementPolicyRef} /></label>
    <MoneyFields type={{ ...type, depositCents: start.depositCents, replacementFeeCents: start.replacementFeeCents, depositShortfall: start.depositShortfall as CatalogType["depositShortfall"] }} />
    <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
  </form>;
}

function AddItemsForms({ type, base, busy, run, report, onCancel, onDone }: DialogFormProps & { type: CatalogType }) {
  const serialized = type.mode === "SERIALIZED";
  const addItem = useEditedForm("add-item", report);
  const addRange = useEditedForm("add-range", report);
  return <div>
    <form className={`form-stack ${styles.dialogSection}`} onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const scan = String(data.get("scanCode") ?? "").trim();
      void run(`${base}/items`, {
        action: "create", typeId: type.id, identifier: data.get("identifier"), ...(scan ? { scanCode: scan } : {}),
        quantityTotal: serialized ? 1 : Number(data.get("quantityTotal") || 1), condition: data.get("condition"), location: data.get("location"),
      }, () => "Item added.").then((ok) => { if (ok) { form.reset(); addItem.clear(); } });
    }} onChange={addItem.track}>
      <h3>{serialized ? "Add one item" : "Add a lot"}</h3>
      <label>{serialized ? "Number or identifier" : "Lot name"} <input name="identifier" required maxLength={64} placeholder={serialized ? "K-214" : "WELCOME-PACKETS"} /></label>
      <label>Barcode or QR value (defaults to the identifier) <input name="scanCode" maxLength={64} /></label>
      {serialized ? null : <label>Quantity <input name="quantityTotal" type="number" style={{ width: "100%" }} min={1} max={100000} defaultValue={100} required /></label>}
      <label>Condition <select name="condition" defaultValue="GOOD">{assetConditions.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Location <input name="location" maxLength={120} placeholder="Front desk" /></label>
      <div className="form-actions"><button className="secondary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Add"}</button></div>
    </form>

    {serialized ? <form className={`form-stack ${styles.dialogSection}`} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void run(`${base}/items`, {
        action: "bulk", typeId: type.id, prefix: data.get("prefix"), from: Number(data.get("from")), to: Number(data.get("to")), width: Number(data.get("width") || 0),
        condition: data.get("condition"), location: data.get("location"),
      }, (result) => `Added ${result.created ?? 0} item${result.created === 1 ? "" : "s"}${result.skipped ? `; ${result.skipped} already existed and were left alone` : ""}.`).then((ok) => { if (ok) { addRange.clear(); onDone(); } });
    }} onChange={addRange.track}>
      <h3>Add a numbered range</h3>
      <p>For example prefix K-, from 201 to 260 adds K-201 through K-260. Numbers that already exist are skipped, so it is safe to run twice.</p>
      <label>Prefix <input name="prefix" maxLength={32} placeholder="K-" /></label>
      <label>From <input name="from" type="number" style={{ width: "100%" }} min={0} required defaultValue={1} /></label>
      <label>To <input name="to" type="number" style={{ width: "100%" }} min={0} required defaultValue={60} /></label>
      <label>Zero-pad to width (0 for none) <input name="width" type="number" style={{ width: "100%" }} min={0} max={8} defaultValue={0} /></label>
      <input name="condition" type="hidden" value="GOOD" />
      <input name="location" type="hidden" value="" />
      <div className="form-actions"><button className="secondary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Add range"}</button></div>
    </form> : null}

    <div className={`form-actions ${styles.dialogSection}`}><button className="secondary-button" type="button" onClick={onCancel}>Close</button></div>
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

/** The items table sorts from its headers (#1458); the keys on this object are the whitelist. */
const ASSET_SORT: Record<"identifier" | "scanCode" | "quantity" | "out" | "condition" | "location" | "status", ColumnSpec<CatalogAsset>> = {
  identifier: { value: (asset) => asset.identifier, label: "identifier" },
  scanCode: { value: (asset) => asset.scanCode, label: "barcode value" },
  quantity: { value: (asset) => asset.quantityTotal, label: "quantity", kind: "number" },
  out: { value: (asset) => asset.outQuantity, label: "out", kind: "number" },
  condition: { value: (asset) => asset.condition, label: "condition" },
  location: { value: (asset) => asset.location, label: "location" },
  status: { value: (asset) => asset.availability, label: "status" },
};


function TypeCard({ type, assets, base, busy, run, onEdit, onAddItems }: { type: CatalogType; assets: CatalogAsset[]; base: string; busy: boolean; run: Run; onEdit: () => void; onAddItems: () => void }) {
  const serialized = type.mode === "SERIALIZED";
  const sorted = useTableSort(assets, ASSET_SORT);
  const headingId = `issued-kind-${type.id}`;
  const policyFacts = `${type.roomLinked ? "Room-linked." : ""}${type.depositPolicyRef ? ` Deposit policy: ${type.depositPolicyRef}.` : ""}${type.replacementPolicyRef ? ` Replacement policy: ${type.replacementPolicyRef}.` : ""}${type.depositCents > 0 ? ` Usual cash deposit ${formatCentsPlain(type.depositCents)}.` : ""}${type.replacementFeeCents > 0 ? ` Replacement fee ${formatCentsPlain(type.replacementFeeCents)}.` : ""}`.trim();
  return <section className={`panel form-stack ${styles.card}`} aria-labelledby={headingId}>
    <div className={styles.cardHead}>
      <div className={styles.titleRow}>
        <h2 className={styles.name} id={headingId}>{type.name}</h2>
        <span className={`status-chip ${type.active ? "green" : "neutral"}`}>{type.active ? "Active" : "Inactive"}</span>
      </div>
      <div className={styles.actions}>
        <button className="secondary-button" type="button" aria-label={`Edit ${type.name}`} onClick={onEdit}>Edit</button>
        <button className="secondary-button" type="button" aria-label={`Add items to ${type.name}`} onClick={onAddItems}>Add items</button>
      </div>
    </div>
    <p className={styles.kindLine}>{serialized ? "Numbered" : "Quantity"}</p>
    <p className={styles.counts}>{type.assetCount} {serialized ? (type.assetCount === 1 ? "item" : "items") : (type.assetCount === 1 ? "lot" : "lots")}; {type.availableQuantity} in stock, {type.outQuantity} out.</p>
    {policyFacts ? <p className={styles.policy}>{policyFacts}</p> : null}

    {assets.length === 0 ? null : <details className={styles.items}>
      <summary>{assets.length} {serialized ? (assets.length === 1 ? "item" : "items") : (assets.length === 1 ? "lot" : "lots")}</summary>
      {sorted.note}
      <div className="table-wrap card-box dense-rows"><table role="table" className="report-table table-cards table-cards-compact">
        <caption className="sr-only">{type.name} {serialized ? "items" : "lots"}</caption>
        <thead role="rowgroup"><tr role="row">{sorted.header("identifier", "Identifier")}{sorted.header("scanCode", "Barcode value")}{serialized ? null : sorted.header("quantity", "Quantity")}{sorted.header("out", "Out")}{sorted.header("condition", "Condition")}{sorted.header("location", "Location")}{sorted.header("status", "Status")}</tr></thead>
        <tbody role="rowgroup">{sorted.rows.map((asset) => <tr role="row" key={asset.id}>
          <th role="rowheader" scope="row">{asset.identifier}</th>
          <td {...cardCell("Barcode value")}>{asset.scanCode}</td>
          {serialized ? null : <td {...cardCell("Quantity")}>{asset.quantityTotal}</td>}
          <td {...cardCell("Out")}>{asset.outQuantity}</td>
          <td {...cardCell("Condition")}><label className="sr-only" htmlFor={`cond-${asset.id}`}>Condition of {asset.identifier}</label>
            <select id={`cond-${asset.id}`} value={asset.condition} disabled={busy} onChange={(event) => void run(`${base}/items`, { action: "update", assetId: asset.id, condition: event.target.value as AssetCondition }, () => `${asset.identifier} updated.`)}>{assetConditions.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></td>
          <td {...cardCell("Location")}><LocationForm asset={asset} base={base} busy={busy} run={run} /></td>
          <td {...cardCell("Status")}><label className="sr-only" htmlFor={`avail-${asset.id}`}>Status of {asset.identifier}</label>
            <select id={`avail-${asset.id}`} value={asset.availability} disabled={busy} onChange={(event) => void run(`${base}/items`, { action: "update", assetId: asset.id, availability: event.target.value as AssetAvailability }, () => `${asset.identifier} updated.`)}>{assetAvailabilities.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </section>;
}

/** One item's location box. Typed but unsaved text is unsaved work until Save (#1468). */
function LocationForm({ asset, base, busy, run }: { asset: CatalogAsset; base: string; busy: boolean; run: Run }) {
  const edit = useEditedForm();
  return <form className="form-stack" onChange={edit.track} onSubmit={(event) => {
    event.preventDefault();
    void run(`${base}/items`, { action: "update", assetId: asset.id, location: new FormData(event.currentTarget).get("location") ?? "" }, () => `${asset.identifier} updated.`).then((ok) => { if (ok) edit.clear(); });
  }}><label className="sr-only" htmlFor={`loc-${asset.id}`}>Location of {asset.identifier}</label><input id={`loc-${asset.id}`} name="location" maxLength={120} defaultValue={asset.location ?? ""} /><button className="secondary-button" type="submit" disabled={busy}>Save</button></form>;
}
