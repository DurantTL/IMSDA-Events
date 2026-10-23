// Everything that talks to the server or swaps the draft wholesale: create
// from a template, save, test, publish, withdraw, slug sync, and switching form
// or version. The save order and the messages are unchanged from the original
// single-file builder.
import { useRef } from "react";
import { withExplicitSensitiveFlags } from "@/modules/forms/field-flags";
import { recordTemplateCleanupCreated } from "@/components/template-cleanup-checklist";
import { type FormVersionView, type FormView, blankPreviewAttendees, firstPreviewStepId, type BuilderWorkspaceProps } from "./builder-types";
import { runPublishFlow } from "./publish-flow";
import { canRestoreVersion, restoreConfirmation, restoreNotice, restoreSaveTarget } from "./version-history";
import type { useConfirm } from "@/components/use-confirm";
import type { BuilderState } from "./use-builder-state";
import type { BuilderDerived } from "./use-builder-derived";

export function useBuilderActions({ eventId, eventSlug }: Pick<BuilderWorkspaceProps, "eventId" | "eventSlug">, state: BuilderState, derived: BuilderDerived, askConfirm: ReturnType<typeof useConfirm>["confirm"]) {
  const { setForms, setSelectedFormId, selectedForm, setSelectedVersionId, selectedVersion, definition, setDefinition, responses, setResponses, previewAttendees, setPreviewAttendees, dirty, setDirty, setBusy, setFocusRequest, setNotice, setError, setTestIssues, setShowTemplates, setConfirmingPublish, setConfirmingUnpublish, setShowDraftTemplates, draftTemplateTarget, setDraftTemplateTarget, setDraftTemplateError, slugPrompt, setSlugPrompt, setSlugError, setExpandedFieldId, setPreviewStepId, closeModuleLibrary } = state;
  const { roster, previewSteps, editsCreateDraft, slugMayNeedSync } = derived;
  function syncForm(form: FormView, message?: string, preserveTestResponses = false) {
    setForms((current) => [form, ...current.filter((item) => item.id !== form.id)]);
    setSelectedFormId(form.id);
    setSelectedVersionId(form.activeVersion.id);
    const nextDefinition = structuredClone(form.activeVersion.definition);
    setDefinition(nextDefinition);
    setDirty(false);
    if (!preserveTestResponses) {
      setResponses({});
      setPreviewAttendees(blankPreviewAttendees(nextDefinition));
      setPreviewStepId(firstPreviewStepId(nextDefinition));
      setTestIssues([]);
      setExpandedFieldId(null);
      closeModuleLibrary();
    }
    if (message) setNotice(message);
  }

  async function createFromTemplate(templateKey: string, templateVersionId?: string | null) {
    setBusy("create"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateKey, ...(templateVersionId ? { templateVersionId } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to create this form.");
      syncForm(result.form, "Draft created from the selected template.");
      recordTemplateCleanupCreated(result.form.id, result.form.activeVersion.definition);
      setShowTemplates(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create this form."); }
    finally { setBusy(null); }
  }

  async function updateDraftFromTemplate() {
    if (!selectedForm || !draftTemplateTarget) return;
    setBusy("draft-template"); setDraftTemplateError(""); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/draft-from-template`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateKey: draftTemplateTarget.key, ...(draftTemplateTarget.versionId ? { templateVersionId: draftTemplateTarget.versionId } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to update the draft from this template.");
      syncForm(result.form, `The draft now matches the ${draftTemplateTarget.name} template. The published form is unchanged until you publish this draft. A test is optional.`);
      setDraftTemplateTarget(null); setShowDraftTemplates(false);
    } catch (caught) { setDraftTemplateError(caught instanceof Error ? caught.message : "Unable to update the draft from this template."); }
    finally { setBusy(null); }
  }

  // Hides the "template changed" notice for the one newer version it advertised. The form, its draft and its source are untouched.
  async function dismissTemplateNotice() {
    const advertised = selectedForm?.templateNotice;
    if (!selectedForm || !advertised) return;
    setBusy("dismiss-notice"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/template-notice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateVersionId: advertised.latestVersionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to dismiss this notice.");
      // Only the notice changes: the editor's draft, unsaved edits and selected version stay as they are.
      setForms((current) => current.map((form) => (form.id === selectedForm.id ? { ...form, templateNotice: result.form.templateNotice ?? null } : form)));
      setNotice("Notice dismissed for this template version. It will appear again if the template changes again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to dismiss this notice."); }
    finally { setBusy(null); }
  }

  // Reloads the template list and each form's notice from the server, leaving the editor's draft and unsaved edits alone.
  async function refreshTemplates() {
    try {
      const response = await fetch(`/api/events/${eventId}/forms`);
      if (!response.ok) return;
      const result = await response.json() as { forms: FormView[]; templates: BuilderWorkspaceProps["templates"] };
      state.setTemplates(result.templates);
      setForms((current) => current.map((form) => ({ ...form, templateNotice: result.forms.find((fresh) => fresh.id === form.id)?.templateNotice ?? null })));
    } catch { /* the lists stay as they were; a stale version is refused by the server */ }
  }

  async function saveDraft() {
    if (!selectedForm || !selectedVersion || !definition) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: withExplicitSensitiveFlags(definition), expectedUpdatedAt: selectedVersion.updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to save this draft.");
      syncForm(result.form, editsCreateDraft ? `Version ${result.form.activeVersion.versionNumber} was saved as a new draft. The ${selectedVersion.status === "PUBLISHED" ? "published version stays live" : "withdrawn version stays withdrawn"} until you publish this draft (a test is optional).` : "Draft saved locally.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this draft."); }
    finally { setBusy(null); }
  }

  async function runTest() {
    if (!selectedForm || !selectedVersion) return;
    if (dirty) { setError("Save the draft before running a test submission."); return; }
    setBusy("test"); setError(""); setNotice(""); setTestIssues([]);
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/test-submissions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: selectedVersion.id,
          responses,
          ...(roster?.enabled ? { attendees: previewAttendees } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to run this test submission.");
      const issues = result.submission.validation.issues ?? [];
      const refreshed = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}`);
      if (refreshed.ok) syncForm((await refreshed.json()).form, undefined, true);
      setTestIssues(issues);
      if (issues.length > 0) {
        const issueStep = previewSteps.find((step) => (
          step.fieldKeys.includes(issues[0].key)
          || (issues[0].key === "attendees" && step.managesAttendees)
        ));
        if (issueStep) setPreviewStepId(issueStep.id);
      }
      setNotice(result.submission.isValid ? "Valid test submission saved. This draft is eligible to publish." : "Test saved with validation issues. Correct the highlighted responses and try again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to run this test submission."); }
    finally { setBusy(null); }
  }

  async function beginPublish() {
    if (!selectedForm || !slugMayNeedSync) { setConfirmingPublish(true); return; }
    setBusy("slug"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/slug`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to check the web address.");
      if (result.suggestion.needsSync) { setSlugError(""); setSlugPrompt({ offeredSlug: result.suggestion.offeredSlug }); }
      else setConfirmingPublish(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to check the web address."); }
    finally { setBusy(null); }
  }

  function keepSlug() {
    setSlugPrompt(null); setSlugError(""); setConfirmingPublish(true);
  }

  async function updateSlug() {
    if (!selectedForm || !slugPrompt) return;
    setBusy("slug"); setSlugError("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/slug`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slugPrompt.offeredSlug }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to update the web address.");
      syncForm(result.form, `The web address is now /register/${eventSlug}/${result.form.slug}.`, true);
      setSlugPrompt(null);
      setConfirmingPublish(true);
    } catch (caught) { setSlugError(caught instanceof Error ? caught.message : "Unable to update the web address."); }
    finally { setBusy(null); }
  }

  const publishingRef = useRef(false);

  async function publish() {
    if (!selectedForm || !selectedVersion || !definition) return;
    if (publishingRef.current) return;
    publishingRef.current = true;
    const saveFirst = dirty;
    setBusy("publish"); setError(""); setNotice(""); setConfirmingPublish(false);
    try {
      const result = await runPublishFlow({ eventId, formId: selectedForm.id, saveFirst, definition, expectedUpdatedAt: selectedVersion.updatedAt });
      if (result.ok) syncForm(result.form, `Version ${result.form.activeVersion.versionNumber} is published. The public registration link is now available; future edits create a new draft version.`);
      else if (result.stage === "save") setError(`${result.message} Nothing was published.`);
      else {
        if (result.savedForm) syncForm(result.savedForm);
        setError(result.savedForm ? `Your changes are saved as a draft but not published. ${result.message}` : result.message);
      }
    } finally { publishingRef.current = false; setBusy(null); }
  }

  async function unpublish() {
    if (!selectedForm) return;
    setBusy("unpublish"); setError(""); setNotice(""); setConfirmingUnpublish(false);
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/unpublish`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to withdraw this form.");
      syncForm(result.form, "This form is withdrawn: it is no longer offered on the public event page and registration is closed. Registrations already taken keep the exact questions and prices they were submitted under. To offer it again, save a new draft, then publish it. A test is optional.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to withdraw this form."); }
    finally { setBusy(null); }
  }

  async function chooseForm(form: FormView) {
    if (dirty && !(await askConfirm({
      title: `Open ${form.name} and discard draft changes`,
      body: <p>The unsaved changes to the draft of {selectedForm?.name ?? "the current form"} are lost.</p>,
      confirmLabel: `Discard changes and open ${form.name}`,
      cancelLabel: "Keep editing",
      destructive: true,
    }))) return;
    const nextDefinition = structuredClone(form.activeVersion.definition);
    setSelectedFormId(form.id); setSelectedVersionId(form.activeVersion.id); setDefinition(nextDefinition); setDirty(false); setResponses({}); setPreviewAttendees(blankPreviewAttendees(nextDefinition)); setPreviewStepId(firstPreviewStepId(nextDefinition)); setTestIssues([]); setExpandedFieldId(null); closeModuleLibrary(); setNotice(""); setError("");
  }

  async function chooseVersion(version: FormVersionView) {
    if (dirty && !(await askConfirm({
      title: `View version ${version.versionNumber} and discard draft changes`,
      body: <p>The unsaved changes to the current draft are lost.</p>,
      confirmLabel: `Discard changes and view version ${version.versionNumber}`,
      cancelLabel: "Keep editing",
      destructive: true,
    }))) return;
    const nextDefinition = structuredClone(version.definition);
    setSelectedVersionId(version.id); setDefinition(nextDefinition); setDirty(false); setResponses({}); setPreviewAttendees(blankPreviewAttendees(nextDefinition)); setPreviewStepId(firstPreviewStepId(nextDefinition)); setExpandedFieldId(null); closeModuleLibrary(); setNotice(""); setError(""); setTestIssues([]);
  }

  // Restore as draft (#1140): the old version's definition goes through the same draft save as an edit, so validation,
  // price sync, policy checks, MANAGE_FORMS and the expectedUpdatedAt stale-save rule are the server's, unchanged.
  async function restoreVersion(version: FormVersionView) {
    if (!selectedForm || !canRestoreVersion(version)) return;
    const { draft, expectedUpdatedAt } = restoreSaveTarget(selectedForm.versions);
    if (!expectedUpdatedAt) return;
    const confirmation = restoreConfirmation({ versionNumber: version.versionNumber, draftVersionNumber: draft?.versionNumber ?? null, unsavedEdits: dirty });
    if (confirmation && !(await askConfirm({
      title: confirmation.title,
      body: <>{confirmation.lines.map((line) => <p key={line}>{line}</p>)}</>,
      confirmLabel: confirmation.confirmLabel,
      cancelLabel: "Keep as it is",
      destructive: true,
    }))) return;
    setBusy("restore"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: withExplicitSensitiveFlags(version.definition), expectedUpdatedAt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to restore this version.");
      syncForm(result.form, restoreNotice(version.versionNumber));
      // Focus follows the draft's chip; the effect in use-builder-state moves it once the chip is rendered.
      setFocusRequest({ kind: "draft-chip" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to restore this version."); setFocusRequest({ kind: "restore-button", versionId: version.id }); }
    finally { setBusy(null); }
  }
  return { createFromTemplate, updateDraftFromTemplate, dismissTemplateNotice, refreshTemplates, saveDraft, runTest, beginPublish, keepSlug, updateSlug, publish, unpublish, chooseForm, chooseVersion, restoreVersion };
}
