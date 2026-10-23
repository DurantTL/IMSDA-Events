// The information-mode versions of the builder's server actions (#1149): Save draft, one-click Publish, Restore as
// draft, the form settings and open or close. Each calls the information-forms API through information-mode.ts and
// hands the result back to the builder the same way the registration actions do. Nothing here touches the registration
// endpoints.
import { useRef } from "react";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import type { useConfirm } from "@/components/use-confirm";
import { restoreConfirmation, restoreNotice, restoreSaveTarget, canRestoreVersion } from "./version-history";
import {
  informationFormToView, informationIssuesFromResponse, mergeSettingsForm, noInformationIssues, runInformationPublishFlow, saveInformationDraftRequest,
  saveInformationSettingsRequest, setInformationStatusRequest, type InformationFillAccess,
} from "./information-mode";
import type { FormVersionView, FormView } from "./builder-types";
import type { BuilderState } from "./use-builder-state";
import type { BuilderDerived } from "./use-builder-derived";

export function useInformationActions(
  state: BuilderState,
  derived: BuilderDerived,
  askConfirm: ReturnType<typeof useConfirm>["confirm"],
  syncForm: (form: FormView, message?: string, preserveTestResponses?: boolean) => void,
) {
  const { information, selectedForm, selectedVersion, definition, dirty, setBusy, setError, setNotice, setForms, setConfirmingPublish, setFocusRequest, setInformationIssues } = state;
  const { editsCreateDraft } = derived;
  const publishingRef = useRef(false);

  function refused(message: string, body: unknown, sent: RegistrationFormDefinition) {
    const issues = informationIssuesFromResponse(body, sent);
    const places = issues.form.length + Object.keys(issues.sections).length + Object.keys(issues.fields).length;
    // One summary goes to the existing error live region; the details sit beside each section or question without announcing again.
    setError(places > 1 ? `${message} ${places} places need changes; each is marked on the form.` : message);
    setInformationIssues(issues);
  }

  async function saveDraft() {
    if (!information || !selectedForm || !selectedVersion || !definition) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      const saved = await saveInformationDraftRequest(information, selectedForm.id, definition, selectedVersion.updatedAt);
      if (!saved.ok) { refused(saved.message, saved.body, definition); return; }
      setInformationIssues(noInformationIssues);
      const view = informationFormToView(saved.value);
      syncForm(view, editsCreateDraft ? `Version ${view.activeVersion.versionNumber} was saved as a new draft. The ${selectedVersion.status === "PUBLISHED" ? "published version stays live" : "earlier version stays as it was"} until you publish this draft.` : "Draft saved.");
    } finally { setBusy(null); }
  }

  async function publish() {
    if (!information || !selectedForm || !selectedVersion || !definition) return;
    if (publishingRef.current) return;
    publishingRef.current = true;
    setBusy("publish"); setError(""); setNotice(""); setConfirmingPublish(false);
    try {
      const result = await runInformationPublishFlow({ config: information, formId: selectedForm.id, saveFirst: dirty, definition, expectedUpdatedAt: selectedVersion.updatedAt });
      if (result.ok) {
        setInformationIssues(noInformationIssues);
        const opening = result.form.information?.status === "OPEN" ? "" : " Open the form in Form settings when you want it to accept answers.";
        syncForm(result.form, `Version ${result.form.activeVersion.versionNumber} is published.${opening} Later edits create a new draft version.`);
      } else if (result.stage === "save") {
        refused(`${result.message} Nothing was published.`, result.body, definition);
      } else {
        if (result.savedForm) syncForm(result.savedForm);
        refused(result.savedForm ? `Your changes are saved as a draft but not published. ${result.message}` : result.message, result.body, definition);
      }
    } finally { publishingRef.current = false; setBusy(null); }
  }

  // Restore as draft (#1140), through the same draft save as an edit, so the server's refusal check, stale-save rule and permissions apply.
  async function restoreVersion(version: FormVersionView) {
    if (!information || !selectedForm || !canRestoreVersion(version)) return;
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
      const saved = await saveInformationDraftRequest(information, selectedForm.id, version.definition, expectedUpdatedAt);
      if (!saved.ok) {
        refused(saved.message, saved.body, version.definition);
        setFocusRequest({ kind: "restore-button", versionId: version.id });
        return;
      }
      setInformationIssues(noInformationIssues);
      syncForm(informationFormToView(saved.value), restoreNotice(version.versionNumber));
      setFocusRequest({ kind: "draft-chip" });
    } finally { setBusy(null); }
  }

  /** Replaces the form's own record without touching the editor's draft, unsaved edits or history. */
  function applySettingsForm(view: FormView) {
    setForms((current) => current.map((form) => (form.id === view.id ? mergeSettingsForm(form, view) : form)));
  }

  async function saveSettings(settings: { fillAccess?: InformationFillAccess; opensAt?: string | null; closesAt?: string | null }) {
    if (!information || !selectedForm) return false;
    setBusy("settings"); setError(""); setNotice("");
    try {
      const saved = await saveInformationSettingsRequest(information, selectedForm.id, settings);
      if (!saved.ok) { setError(saved.message); return false; }
      applySettingsForm(informationFormToView(saved.value));
      setNotice("Form settings saved.");
      return true;
    } finally { setBusy(null); }
  }

  async function setStatus(status: "OPEN" | "CLOSED") {
    if (!information || !selectedForm) return;
    setBusy("status"); setError(""); setNotice("");
    try {
      const saved = await setInformationStatusRequest(information, selectedForm.id, status);
      if (!saved.ok) { setError(saved.message); return; }
      applySettingsForm(informationFormToView(saved.value));
      setNotice(status === "OPEN" ? "The form is open for answers." : "The form is closed. It no longer accepts answers.");
    } finally { setBusy(null); }
  }

  return { saveInformationDraft: saveDraft, publishInformation: publish, restoreInformationVersion: restoreVersion, saveInformationSettings: saveSettings, setInformationStatus: setStatus };
}
