// "Save to library" (#1070): one question's configuration goes to the question library, where anyone who can build forms
// can add an independent copy of it to any form. Answers, registrations and people are never part of it.
import { useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { useBuilder } from "./builder-context";
import { libraryFieldsFromForm } from "./library-insert";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { hasVisibilityRule } from "@/modules/forms/visibility-rule";

type SaveResult = { id?: string; replacedAcknowledgments?: string[]; message?: string };

export function BuilderSaveQuestionDialog() {
  const { libraryTarget, setLibraryTarget, definition, eventId, information, setNotice, setLibraryRefresh } = useBuilder();
  const field = libraryTarget && definition ? definition.sections.flatMap((section) => section.fields).find((candidate) => candidate.id === libraryTarget.fieldId) : undefined;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [seenFieldId, setSeenFieldId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Start from the question's own label each time a different question is chosen.
  if ((field?.id ?? null) !== seenFieldId) {
    setSeenFieldId(field?.id ?? null);
    setName(field?.label ?? "");
    setDescription("");
    setError("");
  }
  const close = () => { if (!saving) setLibraryTarget(null); };
  // Focus trap, Escape and focus return are the shared dialog's; the first focusable is the X, so focus goes to the name.
  const dialogRef = useAccessibleDialog<HTMLElement>(Boolean(libraryTarget && field && definition), close, { initialFocus: () => nameRef.current });
  if (!libraryTarget || !field || !definition) return null;
  const referencesOthers = Boolean(hasVisibilityRule(field) || field.optionalWhen);

  async function save() {
    if (!field || !definition) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/question-library", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: (information ? information.eventId : eventId) || null, name, description, fields: libraryFieldsFromForm(definition, [field.id]) }),
      });
      const result = await response.json().catch(() => ({})) as SaveResult;
      if (!response.ok || !result.id) throw new Error(result.message ?? "The question could not be saved to the library.");
      setLibraryRefresh((count) => count + 1);
      setLibraryTarget(null);
      setNotice(`Saved “${name.trim()}” to the question library.${result.replacedAcknowledgments?.length ? " Its policy-version wording was replaced with placeholder wording, because policy versions belong to one event." : ""}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The question could not be saved to the library.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="modal-card confirm-import-modal" role="dialog" aria-modal="true" aria-labelledby="save-question-title" tabIndex={-1} ref={dialogRef}>
        <div className="modal-head">
          <div><p className="eyebrow">Question library</p><h2 id="save-question-title">Save “{field.label}” to the library</h2></div>
          <button className="icon-button modal-close-button" type="button" aria-label="Close dialog" onClick={close}><X size={18} /></button>
        </div>
        <div className="boundary-callout"><ShieldCheck size={19} /><span><strong>Settings only</strong><small>A saved question keeps the wording, type, choices and rules. Never answers, people or registrations. Adding it later puts an independent copy on a form; changing the library never changes that copy or a published form.</small></span></div>
        <div className="form-stack">
          <label>Name in the library<input ref={nameRef} autoComplete="off" name="builder-library-name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Note (optional)<textarea autoComplete="off" name="builder-library-note" maxLength={500} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
        {referencesOthers && <p className="field-help">This question depends on another question on this form. That link is not saved. When the question is added, it is marked to repair so you can choose what it depends on.</p>}
        <p className="field-help">A saved question is not a form template, an event template or a ready-made module: it is one question you reuse.</p>
        {error && <div className="inline-notice error" role="alert">{error}</div>}
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={close}>Cancel</button>
          <button className="primary-button" type="button" disabled={saving || name.trim().length === 0} onClick={save}>{saving ? "Saving…" : "Save to library"}</button>
        </div>
      </section>
    </div>
  );
}
