"use client";

// The form template editor (#1064): the shared registration builder's own pieces
// (state, edits, section cards, field settings, payment and roster settings,
// remove dialogs) opened on a form template instead of an event's form. The
// template belongs to no event, so there is no preview, test submission or
// publish here: Save creates the next immutable version of the template. Panel
// layout is the step-3 work (#1069) and is not started here.

import { useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import { BuilderContext } from "@/components/registration-builder/builder-context";
import { BuilderDialogs } from "@/components/registration-builder/builder-dialogs";
import { BuilderConfirmationEditor, BuilderRosterSettings } from "@/components/registration-builder/builder-form-settings";
import { BuilderPaymentSettings } from "@/components/registration-builder/builder-payment-settings";
import { BuilderSectionCard } from "@/components/registration-builder/builder-section-card";
import type { FormView, FormVersionView } from "@/components/registration-builder/builder-types";
import { useBuilderActions } from "@/components/registration-builder/use-builder-actions";
import { useBuilderDerived } from "@/components/registration-builder/use-builder-derived";
import { useBuilderEdits } from "@/components/registration-builder/use-builder-edits";
import type { BuilderModel } from "@/components/registration-builder/use-builder-model";
import { useBuilderRemoval } from "@/components/registration-builder/use-builder-removal";
import { useBuilderState } from "@/components/registration-builder/use-builder-state";
import type { FormTemplateVersionEntry } from "@/modules/forms/form-template-library-domain";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { moduleOwnedFields } from "@/modules/forms/template-module-fields";

export type FormTemplateEditorProps = {
  templateKey: string;
  name: string;
  description: string;
  audience: string;
  version: number;
  source: "CODE" | "APP";
  appCreated: boolean;
  definition: RegistrationFormDefinition;
  repairingUnreadable: boolean;
  usedByForms: number;
  versions: FormTemplateVersionEntry[];
};

function sourceLabel(source: "CODE" | "APP") {
  return source === "APP" ? "Edited in the app" : "From the code";
}

/** The shared builder model, opened on a stand-in form built from the template: nothing in it is an event's form. */
function templateAsForm(props: FormTemplateEditorProps): FormView {
  const now = new Date().toISOString();
  const activeVersion: FormVersionView = {
    id: `${props.templateKey}-v${props.version}`, versionNumber: props.version, status: "DRAFT", definition: props.definition,
    publishedAt: null, createdAt: now, updatedAt: now, createdBy: "", testSubmissionCount: 0, choiceUsage: {}, testSubmissions: [],
  };
  return { id: props.templateKey, eventId: "", name: props.name, slug: props.templateKey, status: "DRAFT", createdAt: now, updatedAt: now, createdBy: "", activeVersion, versions: [activeVersion] };
}

export function FormTemplateEditor(props: FormTemplateEditorProps) {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const initialForms = useMemo(() => [templateAsForm(props)], [props]);
  const state = useBuilderState({ initialForms });
  const derived = useBuilderDerived(null, state);
  const edits = useBuilderEdits(state, derived);
  const removal = useBuilderRemoval(state, edits);
  const actions = useBuilderActions({ eventId: "", eventSlug: "" }, state, derived, askConfirm);
  const { definition, dirty, setDirty, busy, setBusy, error, setError, notice, setNotice } = state;
  const [name, setName] = useState(props.name);
  const [description, setDescription] = useState(props.description);
  const [audience, setAudience] = useState(props.audience);
  const [version, setVersion] = useState(props.version);
  const [source, setSource] = useState(props.source);
  const [history, setHistory] = useState(props.versions);
  const [conflict, setConflict] = useState(false);

  async function saveTemplate() {
    if (!definition) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/form-templates/${encodeURIComponent(props.templateKey)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version, name, description, audience, definition }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setConflict(result.error === "VERSION_CONFLICT");
        throw new Error(typeof result.message === "string" ? result.message : "Unable to save this template.");
      }
      setVersion(result.version); setSource("APP"); setDirty(false); setConflict(false);
      setHistory((current) => [{ version: result.version, source: "APP", createdAt: new Date().toISOString(), createdBy: "You" }, ...current]);
      setNotice(`Saved as version ${result.version}. Forms already created from this template keep the definition they were created with; new forms and "Update draft from a template" use this version.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this template."); }
    finally { setBusy(null); }
  }

  // The shared model, with Save pointed at the template instead of an event's form.
  const model: BuilderModel = {
    eventId: "", eventSlug: "", eventName: "", eventAudience: undefined, eventBillingMode: undefined, canEditNotifications: false, canSaveAsTemplate: false, mealPlanPrices: {},
    ...state, ...derived, ...edits, ...removal, ...actions, saveDraft: saveTemplate,
  };
  const owned = definition ? moduleOwnedFields(definition) : [];

  return <BuilderContext.Provider value={model}><section className="page-stack builder-workspace">{confirmDialog}
    <section className="panel builder-editor-head">
      <div className="builder-status-row">
        <span className={`status-chip ${source === "APP" ? "gold" : "purple"}`}>Version {version}</span>
        <span>{sourceLabel(source)}</span>
        <span>{props.usedByForms} {props.usedByForms === 1 ? "form" : "forms"} created from it</span>
        {dirty && <span role="status">Unsaved changes</span>}
      </div>
      <div className="builder-title-row">
        <label>Template name<input autoComplete="off" name="form-template-name" value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setDirty(true); }} /></label>
        <label>Who it is for<input autoComplete="off" name="form-template-audience" value={audience} maxLength={80} onChange={(event) => { setAudience(event.target.value); setDirty(true); }} /></label>
        <label className="field-wide">Description<input autoComplete="off" name="form-template-description" value={description} maxLength={500} onChange={(event) => { setDescription(event.target.value); setDirty(true); }} /></label>
        <button className="primary-button" type="button" disabled={busy !== null || !dirty || !name.trim() || !audience.trim()} onClick={saveTemplate}><Save size={15} aria-hidden="true" /> {busy === "save" ? "Saving…" : "Save new version"}</button>
      </div>
      <p className="field-help">Each save creates a new version and keeps the old ones. A template version holds the form&apos;s questions and settings only. It does not include meal plans, lodging inventory, cancellation policies, messages, people, answers or registrations.</p>
      {props.repairingUnreadable && <p className="inline-notice error" role="alert">The stored definition could not be read, so this opens the code&apos;s copy. Saving stores a new, readable version.</p>}
      {source === "APP" && !props.appCreated && <p className="field-help">This template was edited in the app, so code updates no longer apply to it.</p>}
    </section>
    {error && <div className="inline-notice error" role="alert">{error}{conflict && <> <button className="text-button" type="button" onClick={() => window.location.reload()}>Reload the template</button></>}</div>}
    {notice && <div className="inline-notice" role="status">{notice}</div>}
    {owned.length > 0 && <section className="panel" aria-label="Fields that belong to a module">
      <h3>Module-owned fields</h3>
      <p className="field-help">These fields belong to a module bundle and keep fixed keys, because reports and registration read them by key. Change their wording and prices, but leave the keys as they are.</p>
      <ul>{owned.map((field) => <li key={field.fieldKey}><strong>{field.label}</strong> <small>({field.moduleName}, key <code>{field.fieldKey}</code>)</small></li>)}</ul>
    </section>}
    {definition && <div className="builder-canvas">
      <BuilderRosterSettings />
      {definition.sections.map((section, sectionIndex) => <BuilderSectionCard key={section.id} section={section} sectionIndex={sectionIndex} />)}
      <button className="add-section-button" type="button" onClick={edits.addSection}><Plus size={17} /> Add another section</button>
      <BuilderPaymentSettings />
      <BuilderConfirmationEditor />
    </div>}
    <section className="panel" aria-label="Version history">
      <h3>Versions</h3>
      <ul>{history.map((entry) => <li key={entry.version}>Version {entry.version}: {sourceLabel(entry.source).toLowerCase()}{entry.createdBy ? `, by ${entry.createdBy}` : ""}, {entry.createdAt.slice(0, 16).replace("T", " ")} UTC</li>)}
        {history.length === 0 && <li>Version {version}: from the code. No older versions are stored yet.</li>}</ul>
    </section>
    <BuilderDialogs />
  </section></BuilderContext.Provider>;
}
