"use client";

import { cardCell } from "@/components/table-card-labels";
import { EmptyState } from "@/components/empty-state";
import { useState } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { ConfirmDialog } from "@/components/confirm-dialog";
import Link from "next/link";
import { Info } from "lucide-react";
import styles from "@/components/tag-configuration-workspace.module.css";

type TagRow = { id: string; name: string; color: string; description: string; isActive: boolean };

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "The tag could not be saved.");
  return body;
}

export function TagConfigurationWorkspace({
  eventId,
  initialTags,
  canCreate = false,
}: {
  eventId: string;
  /** Not shown: the event bar names the event. Kept so existing callers still type-check. */
  eventName?: string;
  initialTags: TagRow[];
  /** Whether the viewer may add tags: the form and the empty-state action show only then (#743). */
  canCreate?: boolean;
}) {
  const [notice, setNotice] = useState("");
  const [tags, setTags] = useState(initialTags);
  // The tags as last saved, so a row edited but not yet saved with its own Save button counts as unsaved (#1468).
  const [savedTags, setSavedTags] = useState(initialTags);
  // The add form is uncontrolled and React clears it when the action ends, so this tracks what is typed in it.
  const [addTyped, setAddTyped] = useState(false);
  const rowsDirty = tags.some((tag) => {
    const saved = savedTags.find((candidate) => candidate.id === tag.id);
    return saved !== undefined && (tag.name !== saved.name || tag.color !== saved.color || tag.description !== saved.description);
  });
  useUnsavedChangesGuard(rowsDirty || addTyped);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Review before deactivating a tag (#471): this is the closest thing to
  // "removing" one — tags are never deleted, only taken out of new
  // assignments — so it gets the same confirm as the other removal actions.
  const [deactivateTarget, setDeactivateTarget] = useState<TagRow | null>(null);

  async function addTag(form: FormData) {
    setSaving(true); setError("");
    try {
      const body = await responseJson(await fetch(`/api/events/${eventId}/tags`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          color: form.get("color"),
          description: form.get("description") ?? "",
          isActive: true,
        }),
      }));
      setTags((current) => [...current, body.tag].sort((a, b) => a.name.localeCompare(b.name)));
      setSavedTags((current) => [...current, body.tag]);
      setNotice(`Tag ${body.tag.name} added. Next: staff can apply it to registrations and attendees from the registrations list.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The tag could not be saved."); }
    finally { setSaving(false); setAddTyped(false); }
  }

  function openDeactivate(row: TagRow) {
    // A leftover page error must not appear inside the new dialog.
    setError("");
    setDeactivateTarget(row);
  }

  async function updateTag(row: TagRow, patch: Partial<TagRow>) {
    setSaving(true); setError("");
    try {
      const body = await responseJson(await fetch(`/api/events/${eventId}/tags/${row.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...row, ...patch }),
      }));
      setTags((current) => current.map((candidate) => candidate.id === row.id ? body.tag : candidate));
      setSavedTags((current) => current.map((candidate) => candidate.id === row.id ? body.tag : candidate));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tag could not be updated.");
      return false;
    } finally { setSaving(false); }
  }

  return <div className="settings-stack">
    <p className={`usage-note ${styles.usageNote}`}><Info aria-hidden="true" size={16} /><span>Where this shows up: staff add or remove these tags from a registration&rsquo;s notes &amp; tags panel in <Link href={`/people?event=${eventId}`}>Registrations</Link>.</span></p>
    {/* While the deactivate dialog is open, its own alert shows the error; one announcement, not two. */}
    {error && !deactivateTarget && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="inline-notice success" role="status">{notice}</p>}
    <section className="panel">
      <div className="section-heading"><div><h2>Configured tags</h2><p>Staff can only apply tags defined here. Deactivating a tag hides it from new assignments; it stays visible on anything already tagged.</p></div></div>
      {tags.length === 0 ? (
        <EmptyState
          announce={false}
          canCreate={canCreate}
          hint={canCreate ? undefined : "Ask an event administrator to add tags."}
          title="No tags yet"
        >
          Tags are labels staff apply to registrations and attendees, such as VIP or Needs ride. Add one below and it appears on the registrations list.
        </EmptyState>
      ) : <div className="table-wrap"><table className="editable-settings-table table-cards table-cards-xwide" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Tag</th><th role="columnheader" scope="col">Color</th><th role="columnheader" scope="col">Name</th><th role="columnheader" scope="col">Description</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col">Actions</th></tr></thead><tbody role="rowgroup">{tags.map((row) => <tr key={row.id} role="row">
        <th role="rowheader" scope="row"><strong translate="no">{row.name}</strong></th>
        <td {...cardCell("Color")}><input className={styles.colorInput} aria-label={`Color for ${row.name}`} type="color" value={row.color} onChange={(event) => setTags((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, color: event.target.value } : candidate))} /></td>
        <td {...cardCell("Name")}><input className={styles.rowInput} aria-label={`Name for ${row.name}`} value={row.name} onChange={(event) => setTags((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, name: event.target.value } : candidate))} /></td>
        <td {...cardCell("Description")}><input className={styles.rowInput} aria-label={`Description for ${row.name}`} value={row.description} onChange={(event) => setTags((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, description: event.target.value } : candidate))} /></td>
        <td {...cardCell("Status")}>{row.isActive ? "Active" : "Inactive"}</td>
        <td {...cardCell(null)}><span className={`form-actions ${styles.rowActions}`}><button className="secondary-button" disabled={saving} type="button" onClick={() => updateTag(row, {})}>Save</button><button className="secondary-button" disabled={saving} type="button" onClick={() => row.isActive ? openDeactivate(row) : updateTag(row, { isActive: true })}>{row.isActive ? "Deactivate" : "Activate"}</button></span></td>
      </tr>)}</tbody></table></div>}
    </section>
    {canCreate && <section className="panel" aria-labelledby="add-tag-heading">
      <div className="section-heading"><div><h2 id="add-tag-heading">Add a tag</h2><p>Name it and pick a color. It is available to staff right away.</p></div></div>
      <form className={`form-stack ${styles.addForm}`} action={addTag} onChange={(event) => { const data = new FormData(event.currentTarget); setAddTyped(String(data.get("name") ?? "").trim() !== "" || String(data.get("description") ?? "").trim() !== ""); }}>
        <div className={`form-grid two-column color-field-row ${styles.colorRow}`}><label>Name<input id="tag-name-input" name="name" required placeholder="VIP" /></label><label>Color<input className={styles.colorInput} name="color" type="color" defaultValue="#4F46E5" /></label></div>
        <label>Description<input name="description" /></label>
        <button className="primary-button" disabled={saving} type="submit">Add tag</button>
      </form>
    </section>}

    <ConfirmDialog
      busy={saving}
      busyLabel="Deactivating…"
      confirmLabel={deactivateTarget ? `Deactivate "${deactivateTarget.name}"` : "Deactivate tag"}
      error={error}
      onCancel={() => setDeactivateTarget(null)}
      onConfirm={() => {
        if (!deactivateTarget) return;
        void updateTag(deactivateTarget, { isActive: false }).then((ok) => {
          if (ok) setDeactivateTarget(null);
        });
      }}
      open={deactivateTarget !== null}
      title={deactivateTarget ? `Deactivate "${deactivateTarget.name}"?` : "Deactivate tag?"}
    >
      <p>
        This tag is removed from new assignments right away. It stays visible, unchanged, on every
        registration and attendee already tagged with it, and can be reactivated at any time.
      </p>
    </ConfirmDialog>
  </div>;
}
