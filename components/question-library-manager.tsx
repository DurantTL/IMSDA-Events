"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

  async function call(id: string, method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/question-library/${encodeURIComponent(id)}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message ?? "The change could not be saved."); return; }
      setEditingId(null); setConfirmingId(null);
      router.refresh();
    } catch {
      setError("The change could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return <p className="quiet-copy">Nothing is saved yet. In the form builder, open a question&apos;s actions menu and choose Save to library.</p>;
  return (
    <div className="form-stack">
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <ul className="question-library-list">
        {items.map((item) => (
          <li className="panel question-library-item" key={item.id}>
            {editingId === item.id ? (
              <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void call(item.id, "PATCH", { name, description }); }}>
                <label>Name<input maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} /></label>
                <label>Note<textarea maxLength={500} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
                <div className="form-actions">
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                  <button className="primary-button" type="submit" disabled={busy || name.trim().length === 0}>{busy ? "Saving…" : "Save changes"}</button>
                </div>
              </form>
            ) : (
              <>
                <div>
                  <strong>{item.name}</strong>
                  {item.unreadable
                    ? <small className="club-report-problem"> · The stored question can no longer be read, so it is not offered in the builder. Delete it and save it again.</small>
                    : <small className="quiet-copy"> · {item.fieldCount} question{item.fieldCount === 1 ? "" : "s"}: {item.fieldLabels.join(", ")}</small>}
                  {item.description && <p className="field-help">{item.description}</p>}
                  <small className="quiet-copy">{item.createdBy ? `Saved by ${item.createdBy}` : "Saved by a former user"}</small>
                </div>
                <div className="form-actions">
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => { setEditingId(item.id); setName(item.name); setDescription(item.description); setConfirmingId(null); }}>Rename</button>
                  {confirmingId === item.id ? (
                    <>
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmingId(null)}>Keep it</button>
                      <button className="primary-button lifecycle-danger-button" type="button" disabled={busy} onClick={() => void call(item.id, "DELETE")}>{busy ? "Deleting…" : `Delete ${item.name}`}</button>
                    </>
                  ) : (
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmingId(item.id)}>Delete</button>
                  )}
                </div>
                {confirmingId === item.id && <p className="field-help">Deleting removes it from the library. Questions already added to forms are independent copies and stay as they are.</p>}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
