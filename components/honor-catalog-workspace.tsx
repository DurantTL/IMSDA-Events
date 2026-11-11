"use client";

import { NavigationLink as Link } from "@/components/navigation-link";
import { useRegisterCatalogAction } from "@/components/catalog-header-action";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { useConfirm } from "@/components/use-confirm";
import { staffPageTitles } from "@/components/staff-navigation";
import styles from "@/components/catalog-workspace.module.css";
import { cardCell } from "@/components/table-card-labels";
import { useEffect, useState } from "react";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { useTableSort, type SortSpec } from "@/components/use-table-sort";
import { SearchResultStatus, useClientSearch } from "@/components/search-as-you-type";
import { Award, Pencil, Save, X } from "lucide-react";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import type { HonorRecord } from "@/modules/honors/repository";
import { EmptyState } from "@/components/empty-state";
import { useEditedForms } from "@/components/use-edited-forms";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";

/** Sorts from the headers, in the address (#1458); the catalog stays in the order the server gave until a column is chosen. */
const HONOR_CATALOG_SORT = {
  code: { label: "Code", value: (honor) => honor.code },
  name: { label: "Name", value: (honor) => honor.name },
  status: { label: "Status", value: (honor) => (honor.isActive ? "Active" : "Inactive") },
  offered: { label: "Used in classes", kind: "number", noteLabel: "classes using it", value: (honor) => honor.offeringCount },
} satisfies Record<string, SortSpec<HonorRecord>>;

type CatalogResponse = { honors?: HonorRecord[]; message?: string; issues?: Array<{ message?: string }> };

/** `showEventLink` (#1839): only for viewers with an event, as the event's Classes page sends anyone without one away. */
export function HonorCatalogWorkspace({ initialHonors, showEventLink = false }: { initialHonors: HonorRecord[]; showEventLink?: boolean }) {
  const [honors, setHonors] = useState(initialHonors);
  // The focused editor: closed until Add honor or a row's Edit opens it (#1590).
  const [editor, setEditor] = useState<HonorRecord | "new" | null>(null);
  const editing = editor === "new" ? null : editor;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const search = useClientSearch();
  // The honor form is unsaved when a field differs from what it opened with (a blank form, or the honor being edited).
  // It leaves the page, and so clears, on a save that closes an edit, Cancel, or choosing another honor to edit (#1468).
  const edits = useEditedForms();
  useUnsavedChangesGuard(edits.dirty);
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const editorRef = useAccessibleDialog<HTMLElement>(editor !== null, closeEditor);
  // The page header's one filled button opens the new-honor editor (D3).
  const registerAction = useRegisterCatalogAction();
  useEffect(() => {
    registerAction({ run: () => openEditor("new"), busy: false });
    return () => registerAction(null);
  }, [registerAction]);

  const query = search.term.trim().toLowerCase();
  const visible = query
    ? honors.filter((honor) => `${honor.code} ${honor.name}`.toLowerCase().includes(query))
    : honors;
  const sorted = useTableSort(visible, HONOR_CATALOG_SORT, "catalog");

  /** Close, Cancel, Escape and the backdrop all come here: a form with typed work asks first, and a save in flight waits. */
  async function closeEditor() {
    if (saving) return;
    if (edits.dirty && !(await askConfirm({
      title: editing ? `Discard changes to ${editing.name}` : "Discard the new honor",
      body: <p>This honor has changes that haven&apos;t been saved. Discarding closes the editor and loses them.</p>,
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      destructive: true,
    }))) return;
    edits.clear("honor");
    setEditor(null);
    setError("");
  }

  function openEditor(next: HonorRecord | "new") {
    setEditor(next);
    setNotice("");
    setError("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        editing ? `/api/admin/honors/${encodeURIComponent(editing.id)}` : "/api/admin/honors",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: String(form.get("code") ?? ""),
            name: String(form.get("name") ?? ""),
            description: String(form.get("description") ?? ""),
            isActive: form.get("isActive") === "on",
          }),
        },
      );
      const result = await response.json().catch(() => ({})) as CatalogResponse;
      if (!response.ok || !result.honors) {
        throw new Error(result.message ?? result.issues?.[0]?.message ?? "The honor could not be saved.");
      }
      setHonors(result.honors);
      setNotice(editing ? "Honor updated." : "Honor added to the catalog.");
      setEditor(null);
      edits.clear("honor");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The honor could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const importDialog = (
    <CsvImportDialog
      eyebrow="Honor catalog CSV"
      help={(
        <p>
          Fill in the CSV template (Code, Name, Description, Active, and optionally Catalog Number and Category) and save it
          as CSV. Honors are matched by code: new codes are added, known codes are updated with what the file fills in.
          Honors missing from the file are left alone; nothing is deleted.
        </p>
      )}
      importUrl="/api/admin/honors/import"
      onImported={(result) => {
        if (Array.isArray(result.honors)) setHonors(result.honors as HonorRecord[]);
        setNotice(`Honor catalog updated: ${Number(result.added ?? 0)} added, ${Number(result.updated ?? 0)} updated.`);
      }}
      templateHref="/api/admin/honors/template"
      title="Import honors"
      variant="staff"
    />
  );

  return (
    <>
      <section className="page-stack">
        <p className={styles.definition} data-catalog-definition="">
          This list defines each honor.{honors.length > 0 && <> &quot;Used in classes&quot; counts the classes across all Honors Weekends, past ones included, that teach it.</>}{" "}
          Honors members have already earned stay on their records, which show the honor&apos;s current name and code.
        </p>
        {showEventLink && (
          <ul aria-label="Related pages" className={styles.links}>
            <li><span className={styles.linksLabel}>Each event chooses what it offers on</span> <Link href="/more/honors">{staffPageTitles.honors}</Link></li>
          </ul>
        )}
        {notice && <div className="inline-notice success" role="status">{notice}</div>}
        <div className={styles.toolbar}>
          {honors.length > 0 && (
            <label className="form-stack">
              <span className="sr-only">Filter honors</span>
              <input
                {...search.inputProps}
                placeholder="Filter by code or name"
                type="search"
              />
            </label>
          )}
          <span className={styles.toolbarTools}>{importDialog}</span>
        </div>
        <section className="panel dense-rows">
          <div className="section-heading">
            <div>
              <h2>Honors</h2>
            </div>
            <span className="count-badge">{honors.length} honors</span>
          </div>
          {honors.length === 0 ? (
            <>
              <EmptyState hint="Use Add honor, or import a CSV, to add the honors from last year's class list." icon={<Award aria-hidden="true" size={27} />} title="No honors yet">The honor catalog is empty.</EmptyState>
            </>
          ) : (
            <>
              <SearchResultStatus message={`${visible.length} of ${honors.length} ${honors.length === 1 ? "honor" : "honors"} shown.`} />
              <div className="report-table-wrap card-box">
                {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
                <table className="report-table table-cards table-cards-corner table-cards-compact" role="table">
                  <thead role="rowgroup">
                    <tr role="row">
                      <SortableHeader {...sorted.headerProps("code")} />
                      <SortableHeader {...sorted.headerProps("name")} />
                      <SortableHeader {...sorted.headerProps("status")} />
                      <SortableHeader {...sorted.headerProps("offered")} />
                      <th role="columnheader" scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {sorted.rows.map((honor) => (
                      <tr key={honor.id} role="row">
                        <td {...cardCell("Code")}><code>{honor.code}</code></td>
                        <th role="rowheader" scope="row">
                          <strong className={styles.name}>{honor.name}</strong>
                          {honor.description && <small className={styles.detail}>{honor.description}</small>}
                        </th>
                        <td {...cardCell("Status")}>
                          <span className={`status-chip ${honor.isActive ? "green" : "gold"}`}>
                            {honor.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td {...cardCell("Used in classes")}>
                          {honor.offeringCount === 0 ? "Not in any class" : `${honor.offeringCount} ${honor.offeringCount === 1 ? "class" : "classes"}`}
                        </td>
                        <td {...cardCell(null)}>
                          <div className="row-actions">
                            <button
                              aria-label={`Edit ${honor.name}`}
                              className="secondary-button"
                              onClick={() => openEditor(honor)}
                              type="button"
                            >
                              <Pencil aria-hidden="true" size={14} /> Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </section>

      {editor !== null && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void closeEditor(); }} role="presentation">
          <section aria-labelledby="honor-editor-title" aria-modal="true" className="modal-card" ref={editorRef} role="dialog" tabIndex={-1}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">{editing ? "Edit honor" : "New honor"}</p>
                <h2 id="honor-editor-title">{editing ? editing.name : "Add an honor"}</h2>
              </div>
              <button aria-label="Close honor editor" className="icon-button modal-close-button" disabled={saving} onClick={() => void closeEditor()} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <form className="form-stack" key={editing?.id ?? "new"} onChange={edits.track("honor")} onSubmit={save} ref={edits.gone("honor")}>
              {error && <div className={`inline-notice error ${styles.editorError}`} role="alert">{error}</div>}
              {editing && (
                <p className={styles.editorNote}>
                  {editing.offeringCount === 0 ? "No class teaches this honor." : `${editing.offeringCount} ${editing.offeringCount === 1 ? "class teaches" : "classes teach"} this honor, across all Honors Weekends.`}{" "}
                  Honors members have already earned stay on their records, under the honor&apos;s current name and code.
                </p>
              )}
              <div className="form-grid two-column">
                <label>
                  Code
                  <input defaultValue={editing?.code ?? ""} maxLength={40} name="code" placeholder="e.g. AR-011" required />
                </label>
                <label>
                  Name
                  <input defaultValue={editing?.name ?? ""} maxLength={120} name="name" required />
                </label>
              </div>
              <label>
                Description (optional)
                <textarea defaultValue={editing?.description ?? ""} maxLength={2000} name="description" rows={3} />
              </label>
              <label className="checkbox-label">
                <input defaultChecked={editing?.isActive ?? true} name="isActive" type="checkbox" /> Active (can be offered at sites)
              </label>
              <div className={`form-actions ${styles.dialogActions}`}>
                <button className="secondary-button" disabled={saving} onClick={() => void closeEditor()} type="button">Cancel</button>
                <button aria-disabled={saving || undefined} className={`primary-button ${styles.held}`} type="submit">
                  <Save aria-hidden="true" size={16} />
                  {saving ? " Saving…" : " Save honor"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {confirmDialog}
    </>
  );
}
