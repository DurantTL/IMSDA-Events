"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "./question-library-manager.module.css";
import type { QuestionLibraryAdminRow } from "@/modules/question-library/domain";

/**
 * The saved-question list for system administrators (#1070): rename, re-describe or delete. The server checks the same
 * permission on every call. Nothing here reaches a form: questions already added are independent copies and stay as they are.
 */
export function QuestionLibraryManager({ items }: { items: QuestionLibraryAdminRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The rename form is dirty only while open and its values differ from the saved question; Cancel and a save close it (#1468).
  const editing = editingId === null ? undefined : items.find((item) => item.id === editingId);
  useUnsavedChangesGuard(editing !== undefined && (name !== editing.name || description !== editing.description));
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The row that held focus disappears or changes, so focus goes back to the list heading.
  const focusHeading = () => window.setTimeout(() => headingRef.current?.focus(), 0);

  async function call(id: string, method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/question-library/${encodeURIComponent(id)}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message ?? "The change could not be saved."); return; }
      setEditingId(null); setConfirmingId(null);
      router.refresh();
      focusHeading();
    } catch {
      setError("The change could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const heading = <h2 className={styles.heading} ref={headingRef} tabIndex={-1}>Saved questions</h2>;
  // The heading stays in the empty state so focus has somewhere to land after the last item is deleted.
  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        {heading}
        <p className="quiet-copy">Nothing is saved yet. In the form builder, open a question&apos;s actions menu and choose Save to library.</p>
        <div><Link className="secondary-button" href="/registration-builder">Open the form builder</Link></div>
      </div>
    );
  }
  return (
    <div className="form-stack dense-rows">
      <div className="section-heading">{heading}<span className="count-badge">{items.length} saved</span></div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <ul className={styles.rows}>
        {items.map((item) => (
          <li className={`${styles.row} ${editingId === item.id ? styles.editing : ""}`} key={item.id}>
            {editingId === item.id ? (
              <form className={styles.editForm} onSubmit={(event) => { event.preventDefault(); void call(item.id, "PATCH", { name, description }); }}>
                <label>Name<input maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} /></label>
                <label>Note<textarea maxLength={500} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
                {name !== item.name || description !== item.description ? <p className={styles.meta} role="status">Unsaved changes</p> : null}
                <div className={styles.editActions}>
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => { setEditingId(null); focusHeading(); }}>Cancel</button>
                  <button className="primary-button" type="submit" disabled={busy || name.trim().length === 0}>{busy ? "Saving…" : "Save changes"}</button>
                </div>
              </form>
            ) : (
              <>
                <div className={styles.body}>
                  <div className={styles.titleLine}>
                    <h3 className={styles.name}>{item.name}</h3>
                    {item.unreadable
                      ? <span className="status-chip coral">Needs repair</span>
                      : <span className="status-chip neutral">{item.fieldCount} question{item.fieldCount === 1 ? "" : "s"}</span>}
                  </div>
                  {item.unreadable
                    ? <p className={styles.problem}>The stored question can no longer be read, so it is not offered in the builder. Delete it and save it again.</p>
                    : <p className={styles.meta}>{item.fieldLabels.join(", ")}</p>}
                  {item.description && <p className="field-help">{item.description}</p>}
                  <p className={styles.meta}>{item.createdBy ? `Saved by ${item.createdBy}` : "Saved by a former user"}</p>
                </div>
                <div className={`row-actions ${styles.actions}`}>
                  <button className="secondary-button" type="button" disabled={busy} aria-label={`Rename ${item.name}`} onClick={() => { setEditingId(item.id); setName(item.name); setDescription(item.description); setConfirmingId(null); }}>Rename</button>
                  {confirmingId === item.id ? (
                    <>
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => { setConfirmingId(null); focusHeading(); }}>Keep it</button>
                      <button className="primary-button lifecycle-danger-button" type="button" disabled={busy} onClick={() => void call(item.id, "DELETE")}>{busy ? "Deleting…" : `Delete ${item.name}`}</button>
                    </>
                  ) : (
                    <button className="secondary-button" type="button" disabled={busy} aria-label={`Delete ${item.name}`} onClick={() => setConfirmingId(item.id)}>Delete</button>
                  )}
                </div>
                {confirmingId === item.id && <p className={`field-help ${styles.confirm}`}>Deleting removes it from the library. Questions already added to forms are independent copies and stay as they are.</p>}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
