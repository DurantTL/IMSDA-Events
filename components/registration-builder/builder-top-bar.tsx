// Top bar zone: the page actions (preview, templates) and the form header with
// the version chip, Save draft, Publish version and the form title.
import { staffPageTitles } from "@/components/staff-navigation";
import { AlertTriangle, BookmarkPlus, CopyPlus, Eye, ExternalLink, FileClock, Layers3, Save, Send, ShieldCheck } from "lucide-react";
import { statusLabel } from "./builder-types";
import { useLoadedBuilder, useBuilder } from "./builder-context";

export function BuilderPageIntro() {
  const { selectedForm, definition, busy, setShowTemplates, showDraftTemplates, setShowDraftTemplates, showPreview, eventName, canSaveAsTemplate, showSaveTemplate, setShowSaveTemplate } = useBuilder();
  return (
    <div className="page-intro"><div><p className="eyebrow">Public registration setup</p><h2 className="duplicate-page-title">{staffPageTitles.registrationForm}</h2><p>Create, arrange, preview, test, and publish versioned registration forms for {eventName} without code.</p></div><div className="intro-actions"><span className="count-badge"><ShieldCheck size={16} /> Safe draft editing</span>{definition && <button className="secondary-button" type="button" onClick={showPreview}><Eye size={16} /> Preview &amp; test</button>}<button className="secondary-button" type="button" onClick={() => setShowTemplates((value) => !value)}><CopyPlus size={16} /> New from template</button>{selectedForm && <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => setShowDraftTemplates((value) => !value)} aria-expanded={showDraftTemplates}><Layers3 size={16} /> Update draft from a template</button>}{canSaveAsTemplate && selectedForm && <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => setShowSaveTemplate((value) => !value)} aria-expanded={showSaveTemplate}><BookmarkPlus size={16} /> Save as template</button>}</div></div>
  );
}

// The three form actions are shared by the phone layout's header and the editor shell's top bar (#1132),
// so Save draft and Publish have one set of labels and one set of rules.
export function BuilderSaveDraftButton({ className = "secondary-button" }: { className?: string }) {
  const { dirty, busy, canEdit, editsCreateDraft, saveDraft } = useLoadedBuilder();
  return <button className={className} type="button" disabled={!canEdit || (!dirty && !editsCreateDraft) || busy !== null} aria-describedby="builder-action-hints" onClick={saveDraft}><Save size={15} /> {busy === "save" ? "Saving…" : editsCreateDraft ? (dirty ? "Save as new draft" : "Create new version") : "Save draft"}</button>;
}

export function BuilderPublicLink({ className = "secondary-button" }: { className?: string }) {
  const { selectedForm, publishedVersion, eventSlug } = useLoadedBuilder();
  return publishedVersion ? <a className={className} href={`/register/${eventSlug}/${selectedForm.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open public form</a> : <button className={className} type="button" disabled title="Publish this form to create its public link"><ExternalLink size={15} /> Open public form</button>;
}

/**
 * Shows for a draft, and for a live or withdrawn version with unsaved edits
 * (#1137): Publish then saves the edits, which creates the new draft, and
 * publishes it. Historical versions never show it.
 */
export function BuilderPublishButton({ className = "primary-button" }: { className?: string }) {
  const { selectedVersion, busy, dirty, editsCreateDraft, canEdit, publishBlockedReason, beginPublish } = useLoadedBuilder();
  if (selectedVersion.status !== "DRAFT" && !(canEdit && editsCreateDraft && dirty)) return null;
  return <button className={className} type="button" disabled={Boolean(publishBlockedReason) || busy !== null} aria-describedby="builder-action-hints" title={publishBlockedReason || undefined} onClick={beginPublish}><Send size={15} /> {busy === "publish" ? "Publishing…" : dirty ? "Publish changes" : "Publish version"}</button>;
}

/** Why Save or Publish is unavailable, and what a live version means for edits. Both layouts point `aria-describedby` at it. */
export function BuilderActionHints() {
  const { selectedVersion, dirty, setPreviewStepId, previewSteps, isHistorical, hasValidTest, testRequired, hasEverPublished, editsCreateDraft } = useLoadedBuilder();
  return (
    <div id="builder-action-hints">{editsCreateDraft && !isHistorical && <p className="builder-gate"><FileClock size={15} /> {selectedVersion.status === "PUBLISHED" ? `Version ${selectedVersion.versionNumber} is live and is never changed in place.` : `Version ${selectedVersion.versionNumber} is withdrawn from the public page.`} {dirty ? "Choose Publish changes to save and publish your edits, or Save as new draft to keep them unpublished; until then they are not saved." : "Make your edits, or choose Create new version to start a draft from it."} Existing registrations keep the version they were submitted under.</p>}{selectedVersion.status === "DRAFT" && dirty && !hasEverPublished && <p className="builder-gate"><AlertTriangle size={15} /> Save this draft to enable Publish version.</p>}{selectedVersion.status === "DRAFT" && !dirty && testRequired && !hasValidTest && <p className="builder-gate"><AlertTriangle size={15} /> Run a test submission first. A valid test is required only before a form&apos;s first publish, and saving edits clears earlier tests. <a href="#live-form-preview" onClick={() => { const last = previewSteps[previewSteps.length - 1]; if (last) setPreviewStepId(last.id); }}>Go to the test panel</a></p>}</div>
  );
}

export function BuilderHistoricalGate() {
  const { isHistorical } = useLoadedBuilder();
  return isHistorical ? <p className="builder-gate"><FileClock size={15} /> Historical versions are immutable and shown read-only.</p> : null;
}

export function BuilderEditorHead() {
  const { selectedVersion, definition, dirty, canEdit, replaceDefinition } = useLoadedBuilder();
  return (
    <section className="panel builder-editor-head"><div className="builder-status-row"><span className={`status-chip ${selectedVersion.status === "PUBLISHED" ? "green" : selectedVersion.status === "DRAFT" ? "gold" : "purple"}`}>{statusLabel(selectedVersion.status)}</span><span>Version {selectedVersion.versionNumber}</span>{dirty && <span className="unsaved-dot">Unsaved changes</span>}</div><label>Form title<input autoComplete="off" name="builder-rb-field-1" disabled={!canEdit} value={definition.title} maxLength={120} onChange={(event) => replaceDefinition({ ...definition, title: event.target.value })} /></label><label>Description<textarea autoComplete="off" name="builder-rb-note-2" disabled={!canEdit} value={definition.description} maxLength={500} rows={2} onChange={(event) => replaceDefinition({ ...definition, description: event.target.value })} /></label><div className="builder-actions"><BuilderSaveDraftButton /><BuilderPublicLink /><BuilderPublishButton /></div><BuilderActionHints /><BuilderHistoricalGate /></section>
  );
}
