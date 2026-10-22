// "Save as template" (#1065), for system administrators. It saves the stored version of the open form as a new template, or
// as the next version of an existing one. Only configuration is copied; the form, its answers and registrations are not
// touched. The server snapshots the persisted version, so unsaved editor content is left out unless it is saved first.
import { useState } from "react";
import { X } from "lucide-react";
import { useBuilder } from "./builder-context";

type Saved = { key: string; version: number; created: boolean; replacedAcknowledgments: string[] };

export function BuilderSaveTemplatePanel() {
  const { eventId, selectedForm, selectedVersion, definition, dirty, busy, showSaveTemplate, setShowSaveTemplate, templates, canSaveAsTemplate, refreshTemplates } = useBuilder();
  const [mode, setMode] = useState<"NEW" | "NEW_VERSION">("NEW");
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("Any event");
  const [description, setDescription] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [acceptSavedVersion, setAcceptSavedVersion] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  if (!canSaveAsTemplate || !showSaveTemplate || !selectedForm || !selectedVersion || !definition) return null;
  const target = templates.find((template) => template.key === (templateKey || templates[0]?.key));
  const ready = (!dirty || acceptSavedVersion)
    && (mode === "NEW" ? name.trim().length > 0 && audience.trim().length > 0 : target !== undefined);

  async function save() {
    if (!selectedForm || !selectedVersion) return;
    setSaving(true); setError(""); setSaved(null);
    try {
      const reference = { eventId, formId: selectedForm.id, versionId: selectedVersion.id };
      const body = mode === "NEW"
        ? { mode, ...reference, name, description, audience }
        : { mode, ...reference, templateKey: target!.key, expectedVersion: target!.version ?? 1 };
      const response = await fetch("/api/admin/form-templates/from-form", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as Partial<Saved> & { message?: string };
      if (!response.ok || !result.key) throw new Error(result.message ?? "The template could not be saved.");
      setSaved(result as Saved);
      await refreshTemplates();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel builder-template-panel" aria-labelledby="save-template-title">
      <div className="section-heading">
        <div><p className="eyebrow">System administrators only</p><h2 id="save-template-title">Save {selectedForm.name} as a template</h2></div>
        <button className="icon-button modal-close-button" aria-label="Close save as template" type="button" onClick={() => setShowSaveTemplate(false)}><X size={18} /></button>
      </div>
      <p className="field-help">This saves version {selectedVersion.versionNumber} of the form as it is stored. It copies the questions and settings only, never answers, registrations or test submissions, and the form itself does not change.</p>
      {dirty && (
        <div className="inline-notice" role="alert">
          <label className="checkbox-row">
            <input type="checkbox" checked={acceptSavedVersion} onChange={(event) => setAcceptSavedVersion(event.target.checked)} />
            <span>This form has unsaved changes. Save the template from the stored version and leave my unsaved changes out. (To include them, save the draft first.)</span>
          </label>
        </div>
      )}
      <fieldset className="form-stack">
        <legend>Save as</legend>
        <label><input type="radio" name="save-template-mode" checked={mode === "NEW"} onChange={() => setMode("NEW")} /> A new template</label>
        <label><input type="radio" name="save-template-mode" checked={mode === "NEW_VERSION"} onChange={() => setMode("NEW_VERSION")} /> A new version of an existing template</label>
      </fieldset>
      {mode === "NEW" ? (
        <div className="form-grid two-column">
          <label>Template name<input autoComplete="off" name="builder-save-template-name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Who it is for<input autoComplete="off" name="builder-save-template-audience" maxLength={80} value={audience} onChange={(event) => setAudience(event.target.value)} /></label>
          <label>Description<textarea autoComplete="off" name="builder-save-template-note" maxLength={500} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
      ) : (
        <label>Template
          <select value={target?.key ?? ""} onChange={(event) => setTemplateKey(event.target.value)}>
            {templates.map((template) => <option key={template.key} value={template.key}>{template.name} (version {template.version ?? 1})</option>)}
          </select>
        </label>
      )}
      <p className="field-help">An acknowledgment that points at this event&apos;s published policy version is saved as placeholder wording, because policy versions belong to one event.</p>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {saved && (
        <div className="inline-notice" role="status">
          {saved.created ? "Template created." : `Saved as version ${saved.version} of the template.`}{" "}
          <a href={`/admin/form-templates/${encodeURIComponent(saved.key)}`}>Open it in Form templates</a>.
          {saved.replacedAcknowledgments.length > 0 && <> Reword the acknowledgment wording for: {saved.replacedAcknowledgments.join(", ")}.</>}
        </div>
      )}
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={() => setShowSaveTemplate(false)}>Close</button>
        <button className="primary-button" type="button" disabled={!ready || saving || busy !== null} onClick={save}>{saving ? "Saving…" : mode === "NEW" ? "Create template" : "Save new version"}</button>
      </div>
    </section>
  );
}
