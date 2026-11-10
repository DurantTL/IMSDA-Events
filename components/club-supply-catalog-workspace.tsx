"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { ExportLink } from "@/components/export-link";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { useConfirm } from "@/components/use-confirm";
import { staffPageTitles } from "@/components/staff-navigation";
import catalogStyles from "@/components/catalog-workspace.module.css";
import { useMemo, useState } from "react";
import { SearchResultStatus, useClientSearch } from "@/components/search-as-you-type";
import { Check, Download, FileUp, Package, RefreshCw, Upload, X } from "lucide-react";
import styles from "@/components/club-supplies.module.css";
import type { ClubSupplyImportSummary, MergedNumberConflict, RepeatedCatalogNumber } from "@/modules/club-supplies/catalog-csv";
import { type ClubSupplySection, clubSupplySectionLabels, clubSupplySections } from "@/modules/club-supplies/domain";
import type { ClubSupplyItemRecord } from "@/modules/club-supplies/repository";
import { EmptyState } from "@/components/empty-state";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { Money } from "@/components/exact-value";

type PreviewStep = {
  line: number;
  name: string;
  action: "ADD" | "UPDATE" | "SKIP";
  message: string;
  section: ClubSupplySection | null;
  honorMatch: "MATCHED" | "UNMATCHED" | null;
  duplicateOfLine: number | null;
};

type ImportResponse = {
  steps?: PreviewStep[];
  summary?: ClubSupplyImportSummary;
  repeatedNumbers?: RepeatedCatalogNumber[];
  mergedNumberConflicts?: MergedNumberConflict[];
  fingerprint?: string;
  items?: ClubSupplyItemRecord[];
  error?: string;
  message?: string;
  issues?: Array<{ message?: string }>;
};

type Preview = {
  csv: string;
  steps: PreviewStep[];
  summary: ClubSupplyImportSummary;
  repeatedNumbers: RepeatedCatalogNumber[];
  mergedNumberConflicts: MergedNumberConflict[];
  fingerprint: string;
};

/** A file download from an API route, not a page, so a plain link. */
const TEMPLATE_HREF = "/api/admin/club-supplies/template";
const actionLabels = { ADD: "Add", UPDATE: "Update", SKIP: "Skip" } as const;
const actionTone = { ADD: "green", UPDATE: "purple", SKIP: "gold" } as const;

/**
 * Staff page for the club supply catalog (#531): download the template,
 * upload a CSV, read the dry run (counts, honors matched and unmatched,
 * repeated-number warnings, every row), confirm exactly that preview, then
 * browse the catalog by section and mark items active or inactive.
 */
export function ClubSupplyCatalogWorkspace({ initialItems }: { initialItems: ClubSupplyItemRecord[] }) {
  const [items, setItems] = useState(initialItems);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const [section, setSection] = useState<ClubSupplySection | "">("");
  const search = useClientSearch();
  const [toggling, setToggling] = useState<string | null>(null);
  // Who supplies an item and its price (#1688): the one item being edited, and what has been typed.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftSupplier, setDraftSupplier] = useState<"ADVENTSOURCE" | "CONFERENCE">("ADVENTSOURCE");
  const [draftPrice, setDraftPrice] = useState("");
  const [priceError, setPriceError] = useState("");
  // A failed save shows in the editor, so the typed values stay (#1590).
  const [editorError, setEditorError] = useState("");
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  // A changed supplier or price that is not saved yet.
  const editedItem = editing ? items.find((item) => item.id === editing) : undefined;
  const originalPrice = editedItem?.unitPriceCents == null ? "" : (editedItem.unitPriceCents / 100).toFixed(2);
  const editorDirty = Boolean(editedItem) && (draftSupplier !== editedItem!.supplier || (draftSupplier === "CONFERENCE" && draftPrice.trim() !== originalPrice));
  useUnsavedChangesGuard(editorDirty);
  const editorRef = useAccessibleDialog<HTMLElement>(Boolean(editedItem), closeEditor);

  /** Close, Cancel, Escape and the backdrop: a save in flight waits, and typed work asks first. */
  async function closeEditor() {
    if (toggling) return;
    if (editorDirty && !(await askConfirm({
      title: `Discard changes to ${editedItem?.name ?? "this item"}`,
      body: <p>The supplier or price has changes that haven&apos;t been saved. Discarding closes the editor and loses them.</p>,
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      destructive: true,
    }))) return;
    setEditing(null);
    setPriceError("");
    setEditorError("");
  }

  async function send(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/club-supplies/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({})) as ImportResponse;
    return { response, result };
  }

  async function runPreview(csv: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setStale(false);
    try {
      const { response, result } = await send({ csv, confirm: false });
      if (!response.ok || !result.steps || !result.summary || !result.fingerprint) {
        throw new Error(result.message ?? result.issues?.[0]?.message ?? "That file couldn't be read.");
      }
      setPreview({ csv, steps: result.steps, summary: result.summary, repeatedNumbers: result.repeatedNumbers ?? [],
        mergedNumberConflicts: result.mergedNumberConflicts ?? [],
        fingerprint: result.fingerprint,
      });
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "That file couldn't be read.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await runPreview(await file.text());
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const { response, result } = await send({ csv: preview.csv, confirm: true, fingerprint: preview.fingerprint });
      if (response.status === 409 && result.error === "PREVIEW_CHANGED") {
        setStale(true);
        throw new Error(result.message ?? "The catalog changed since this preview. Refresh the preview before saving.");
      }
      if (!response.ok || !result.summary) throw new Error(result.message ?? "The catalog could not be saved.");
      if (result.items) setItems(result.items);
      setNotice(`Catalog saved: ${result.summary.added} added, ${result.summary.updated} updated, ${result.summary.skipped} skipped.`);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The catalog could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: ClubSupplyItemRecord) {
    setToggling(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/club-supplies/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      const result = await response.json().catch(() => ({})) as ImportResponse;
      if (!response.ok || !result.items) throw new Error(result.message ?? "The item could not be updated.");
      setItems(result.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be updated.");
    } finally {
      setToggling(null);
    }
  }

  function startEditing(item: ClubSupplyItemRecord) {
    setEditing(item.id);
    setDraftSupplier(item.supplier);
    setDraftPrice(item.unitPriceCents === null ? "" : (item.unitPriceCents / 100).toFixed(2));
    setPriceError("");
    setEditorError("");
    setError("");
    setNotice("");
  }

  async function saveOrdering(item: ClubSupplyItemRecord) {
    setToggling(item.id);
    setPriceError("");
    setEditorError("");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/club-supplies/${encodeURIComponent(item.id)}/ordering`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier: draftSupplier, unitPrice: draftSupplier === "CONFERENCE" ? draftPrice : null }),
      });
      const result = await response.json().catch(() => ({})) as ImportResponse;
      if (response.status === 400 && result.error === "INVALID_PRICE") {
        setPriceError(result.message ?? "Enter a price in dollars and cents, such as 1.25.");
        return;
      }
      if (!response.ok || !result.items) throw new Error(result.message ?? "The supplier could not be saved.");
      setItems(result.items);
      setEditing(null);
      setNotice(`Saved. ${item.name} is now ${draftSupplier === "CONFERENCE" ? "supplied by the conference" : "supplied by AdventSource"}.`);
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : "The supplier could not be saved.");
    } finally {
      setToggling(null);
    }
  }

  const visible = useMemo(() => {
    const text = search.term.trim().toLowerCase();
    return items.filter((item) => (!section || item.section === section)
      && (!text || `${item.name} ${item.catalogNumber ?? ""}`.toLowerCase().includes(text)));
  }, [items, section, search.term]);

  const changes = preview ? preview.summary.added + preview.summary.updated : 0;
  const counts: Array<[string, number]> = preview ? [
    ["Added", preview.summary.added],
    ["Updated", preview.summary.updated],
    ["Skipped", preview.summary.skipped],
    ["Honors matched", preview.summary.honorsMatched],
    ["Honors unmatched", preview.summary.honorsUnmatched],
    ["Repeated numbers", preview.summary.repeatedNumbers],
    ["Merged rows with another number", preview.summary.mergedNumberConflicts],
  ] : [];

  const uploadAction = (
    <label className={`primary-button ${styles.upload}`}>
      <FileUp aria-hidden="true" size={16} /> {busy && !preview ? "Reading…" : "Upload CSV"}
      <input accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={chooseFile} type="file" />
    </label>
  );

  return (
    <>
      <section className="page-stack">
        <p className={catalogStyles.definition} data-catalog-definition="">
          This list defines each item. Active items can be ordered by clubs; inactive items can&apos;t be newly ordered. Changing an item, its
          supplier or its price here does not change the quantities or prices on orders already placed.
        </p>
        <ul aria-label="Related pages" className={catalogStyles.links}>
          <li><span className={catalogStyles.linksLabel}>Orders clubs have placed:</span> <Link href="/admin/club-supplies/conference-orders">Conference club orders</Link></li>
          <li><span className={catalogStyles.linksLabel}>Items sold at an event are set up on</span> <Link href="/more/merchandise">{staffPageTitles.merchandise}</Link></li>
        </ul>
        {notice && <div className="inline-notice success" role="status">{notice}</div>}
        {error && <div className="inline-notice error" role="alert">{error}</div>}
        <div className={catalogStyles.toolbar}>
          {uploadAction}
          <span className={catalogStyles.toolbarTools}>
            <ExportLink className="text-button" href={TEMPLATE_HREF}><Download aria-hidden="true" size={14} /> CSV template</ExportLink>
          </span>
        </div>
        <details className={catalogStyles.importHelp}>
          <summary>How the CSV import works</summary>
          <p className="field-help">
            Columns: Section, Item, Catalog Number, and an optional Active (Yes or No). Items are matched by section and
            name, not by number; a repeated catalog number is only a warning. A missing column or blank cell keeps what
            is saved: numbers are never cleared, and each item keeps its active setting. The reference file is <code>docs/reference/adventsource-club-catalog.csv</code>. Nothing is saved
            until you confirm the preview.
          </p>
        </details>

        {preview && (
          <section className="panel" aria-labelledby="club-supply-preview-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Dry run · nothing saved yet</p>
                <h2 id="club-supply-preview-title">Preview</h2>
              </div>
              <span className="count-badge">{`${preview.summary.rows} rows`}</span>
            </div>
            <ul className={styles.counts}>
              {counts.map(([label, value]) => <li key={label}><strong>{value}</strong><span>{label}</span></li>)}
            </ul>
            {preview.mergedNumberConflicts.length > 0 && (
              <ul className={styles.warnings} aria-label="Merged rows with a different catalog number">
                {preview.mergedNumberConflicts.map((entry) => (
                  <li key={entry.line}>
                    Row {entry.line} repeats row {entry.duplicateOfLine} with number <code>{entry.catalogNumber}</code>; the item keeps <code>{entry.keptCatalogNumber}</code>.
                  </li>
                ))}
              </ul>
            )}
            {preview.repeatedNumbers.length > 0 && (
              <ul className={styles.warnings} aria-label="Repeated catalog numbers">
                {preview.repeatedNumbers.map((entry) => (
                  <li key={entry.catalogNumber}>
                    <code>{entry.catalogNumber}</code> is on {entry.count} items (rows {entry.lines.slice(0, 6).join(", ")}{entry.lines.length > 6 ? ", …" : ""}).
                  </li>
                ))}
              </ul>
            )}
            <div className={`report-table-wrap ${styles.previewTable}`}>
              <table className="report-table">
                <thead><tr><th>Row</th><th>Item</th><th>Section</th><th>What happens</th></tr></thead>
                <tbody>
                  {preview.steps.map((step) => (
                    <tr key={step.line}>
                      <td>{step.line}</td>
                      <td translate="no">{step.name || "—"}</td>
                      <td>{step.section ? clubSupplySectionLabels[step.section] : "—"}</td>
                      <td><span className={`status-chip ${actionTone[step.action]}`}>{actionLabels[step.action]}</span> {step.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button className="secondary-button" disabled={busy} onClick={() => { setPreview(null); setStale(false); }} type="button">Cancel</button>
              {stale ? (
                <button className="secondary-button" disabled={busy} onClick={() => runPreview(preview.csv)} type="button">
                  <RefreshCw aria-hidden="true" size={16} /> Refresh preview
                </button>
              ) : (
                <button className="secondary-button" disabled={busy || changes === 0} onClick={confirm} type="button">
                  <Upload aria-hidden="true" size={16} /> {busy ? "Saving…" : changes === 0 ? "Nothing to save" : `Confirm ${changes} change${changes === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </section>
        )}

        <section className="panel dense-rows">
          <div className="section-heading">
            <div>
              <h2>Items</h2>
            </div>
            <span className="count-badge">{`${items.length} items`}</span>
          </div>
          {items.length === 0 ? (
            <EmptyState hint="Use Upload CSV with the reference file to start the catalog." icon={<Package aria-hidden="true" size={27} />} title="No items yet">The supply catalog has no items.</EmptyState>
          ) : (
            <>
              <div className={styles.filters}>
                <label>
                  Section
                  <select onChange={(event) => setSection(event.target.value as ClubSupplySection | "")} value={section}>
                    <option value="">All sections</option>
                    {clubSupplySections.map((value) => <option key={value} value={value}>{clubSupplySectionLabels[value]}</option>)}
                  </select>
                </label>
                <label>
                  Search
                  <input {...search.inputProps} placeholder="Name or catalog number" type="search" />
                </label>
              </div>
              <p className="quiet-copy">{`${visible.length} shown`}</p>
              <SearchResultStatus message={`${visible.length} shown.`} />
              <ul className={catalogStyles.rowList}>
                {visible.map((item) => (
                  <li className={catalogStyles.rowCard} key={item.id}>
                    <span className={catalogStyles.rowText}>
                      <strong translate="no">{item.name}</strong>
                      <small className={catalogStyles.detail}>
                        {clubSupplySectionLabels[item.section]}
                        {" · "}{item.catalogNumber ? <>No. <code>{item.catalogNumber}</code></> : "No catalog number"}
                        {item.sizeLabel ? ` · ${item.sizeLabel}` : ""}
                        {item.honorCode ? ` · Honor ${item.honorCode}` : ""}
                        {" · "}{item.supplier === "CONFERENCE" ? <>Conference-supplied, {item.unitPriceCents === null ? "no price set" : <><Money cents={item.unitPriceCents} /> each</>}</> : "AdventSource"}
                      </small>
                    </span>
                    <span className={`row-actions ${catalogStyles.rowMeta}`}>
                      <span className={`status-chip ${item.isActive ? "green" : "gold"}`}>{item.isActive ? "Active" : "Inactive"}</span>
                      <button
                        aria-label={`Supplier and price: ${item.name}`}
                        className="secondary-button"
                        disabled={toggling === item.id}
                        onClick={() => startEditing(item)}
                        type="button"
                      >
                        Supplier and price
                      </button>
                      <button
                        aria-label={`${item.isActive ? "Mark inactive" : "Mark active"}: ${item.name}`}
                        className="secondary-button"
                        disabled={toggling === item.id}
                        onClick={() => toggle(item)}
                        type="button"
                      >
                        {item.isActive ? "Mark inactive" : <><Check aria-hidden="true" size={14} /> Mark active</>}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </section>

      {editedItem && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void closeEditor(); }} role="presentation">
          <section aria-labelledby="supply-editor-title" aria-modal="true" className="modal-card" ref={editorRef} role="dialog" tabIndex={-1}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Supplier and price</p>
                <h2 id="supply-editor-title" translate="no">{editedItem.name}</h2>
              </div>
              <button aria-label="Close supplier editor" className="icon-button modal-close-button" disabled={toggling === editedItem.id} onClick={() => void closeEditor()} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => { event.preventDefault(); void saveOrdering(editedItem); }}
            >
              {editorError && <div className={`inline-notice error ${catalogStyles.editorError}`} role="alert">{editorError}</div>}
              <p className={catalogStyles.editorNote}>Orders already placed keep their quantities and prices.</p>
              <label>
                Supplied by
                <select onChange={(event) => setDraftSupplier(event.target.value as "ADVENTSOURCE" | "CONFERENCE")} value={draftSupplier}>
                  <option value="ADVENTSOURCE">AdventSource</option>
                  <option value="CONFERENCE">The conference</option>
                </select>
              </label>
              {draftSupplier === "CONFERENCE" && (
                <label>
                  Price each (dollars)
                  <input aria-describedby={priceError ? `price-error-${editedItem.id}` : undefined} aria-invalid={priceError ? true : undefined} inputMode="decimal" onChange={(event) => setDraftPrice(event.target.value)} placeholder="1.25" type="text" value={draftPrice} />
                  {priceError && <small className="field-error-message" id={`price-error-${editedItem.id}`}>{priceError}</small>}
                </label>
              )}
              <div className="form-actions">
                <button className="secondary-button" disabled={toggling === editedItem.id} onClick={() => void closeEditor()} type="button">Cancel</button>
                <button className="primary-button" disabled={toggling === editedItem.id} type="submit">{toggling === editedItem.id ? "Saving…" : "Save supplier"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {confirmDialog}
    </>
  );
}
