// Everything that talks to the server or swaps the draft wholesale: create
// from a template, save, test, publish, withdraw, slug sync, and switching form
// or version. The save order and the messages are unchanged from the original
// single-file builder.
import {  } from "lucide-react";
import { withExplicitSensitiveFlags } from "@/modules/forms/field-flags";
import { recordTemplateCleanupCreated } from "@/components/template-cleanup-checklist";
import { type FormVersionView, type FormView, blankPreviewAttendees, firstPreviewStepId, type BuilderWorkspaceProps } from "./builder-types";
import type { useConfirm } from "@/components/use-confirm";
import type { BuilderState } from "./use-builder-state";
import type { BuilderDerived } from "./use-builder-derived";

export function useBuilderActions({ eventId, eventSlug }: Pick<BuilderWorkspaceProps, "eventId" | "eventSlug">, state: BuilderState, derived: BuilderDerived, askConfirm: ReturnType<typeof useConfirm>["confirm"]) {
  const { setForms, setSelectedFormId, selectedForm, setSelectedVersionId, selectedVersion, definition, setDefinition, responses, setResponses, previewAttendees, setPreviewAttendees, dirty, setDirty, setBusy, setNotice, setError, setTestIssues, setShowTemplates, setConfirmingPublish, setConfirmingUnpublish, setShowDraftTemplates, draftTemplateTarget, setDraftTemplateTarget, setDraftTemplateError, slugPrompt, setSlugPrompt, setSlugError, setExpandedFieldId, setPreviewStepId, closeModuleLibrary } = state;
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

  async function createFromTemplate(templateKey: string) {
    setBusy("create"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/events/${eventId}/forms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateKey }) });
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
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/draft-from-template`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateKey: draftTemplateTarget.key }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to update the draft from this template.");
      syncForm(result.form, `The draft now matches the ${draftTemplateTarget.name} template. The published form is unchanged until you publish this draft. A test is optional.`);
      setDraftTemplateTarget(null); setShowDraftTemplates(false);
    } catch (caught) { setDraftTemplateError(caught instanceof Error ? caught.message : "Unable to update the draft from this template."); }
    finally { setBusy(null); }
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

  async function publish() {
    if (!selectedForm) return;
    setBusy("publish"); setError(""); setNotice(""); setConfirmingPublish(false);
    try {
      const response = await fetch(`/api/events/${eventId}/forms/${selectedForm.id}/publish`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to publish this form.");
      syncForm(result.form, `Version ${result.form.activeVersion.versionNumber} is published. The public registration link is now available; future edits create a new draft version.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish this form."); }
    finally { setBusy(null); }
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
  return { createFromTemplate, updateDraftFromTemplate, saveDraft, runTest, beginPublish, keepSlug, updateSlug, publish, unpublish, chooseForm, chooseVersion };
}
