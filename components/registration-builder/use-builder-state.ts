// Owns the builder's authoritative draft and every piece of local UI state.
// There is exactly one copy of the unsaved definition; zones read it through
// the builder context and change it only through the edit and action hooks.
import { useEffect, useMemo, useRef, useState } from "react";
import { emptyHistory, type EditHistory } from "./edit-history";
import { focusTargetId, type FocusRequest } from "./version-history";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { localCalendarDate, type RegistrationFormDefinition } from "@/modules/forms/definition";
import type { PublicRegistrationStepId } from "@/modules/forms/public-registration-steps";
import { duplicatePublicFormGroups } from "@/modules/forms/duplicate-public-forms";
import { type PreviewValue, type DragState, moduleCategories, type PreviewAttendee, blankPreviewAttendees, firstPreviewStepId, type BuilderWorkspaceProps } from "./builder-types";

export function useBuilderState({ initialForms, templates: initialTemplates = [], focusTarget = null }: Pick<BuilderWorkspaceProps, "initialForms"> & Partial<Pick<BuilderWorkspaceProps, "focusTarget" | "templates">>) {
  const [forms, setForms] = useState(initialForms);
  // The picker's templates; refreshed after a save as template so a second save names the current version (#1065).
  const [templates, setTemplates] = useState(initialTemplates);
  // A setup warning (#617) links here with the form and field to fix: open that form.
  const focusedForm = focusTarget ? initialForms.find((form) => form.id === focusTarget.formId) : undefined;
  const [selectedFormId, setSelectedFormId] = useState(focusedForm?.id ?? initialForms[0]?.id ?? "");
  const selectedForm = forms.find((form) => form.id === selectedFormId) ?? null;
  // Published forms the public can't tell apart (#720): same public title and description.
  const duplicatePublishedGroups = useMemo(() => duplicatePublicFormGroups(forms.flatMap((form) => {
    const live = form.versions.find((version) => version.status === "PUBLISHED");
    return live ? [{ id: form.id, name: form.name, title: live.definition.title, description: live.definition.description }] : [];
  })), [forms]);
  const [selectedVersionId, setSelectedVersionId] = useState(selectedForm?.activeVersion.id ?? "");
  const selectedVersion = selectedForm?.versions.find((version) => version.id === selectedVersionId) ?? selectedForm?.activeVersion ?? null;
  const [definition, setDefinition] = useState<RegistrationFormDefinition | null>(selectedVersion?.definition ?? null);
  // Undo and redo steps for the unsaved draft (#1134); cleared whenever the draft is replaced wholesale.
  const [history, setHistory] = useState<EditHistory<RegistrationFormDefinition>>(() => emptyHistory(selectedVersion?.definition ?? null));
  const [responses, setResponses] = useState<Record<string, PreviewValue>>({});
  const [previewAttendees, setPreviewAttendees] = useState<PreviewAttendee[]>(() => blankPreviewAttendees(selectedVersion?.definition ?? null));
  const [dirty, setDirty] = useState(false);
  // Fields whose key still follows their label (#1132): a new question's key is made from its label as it is typed,
  // until the key is edited by hand or the draft is saved or another version is opened (dirty goes back to false),
  // after which a key never changes on its own.
  const [autoKeyFieldIds, setAutoKeyFieldIds] = useState<ReadonlySet<string>>(() => new Set());
  const [seenDirty, setSeenDirty] = useState(false);
  if (seenDirty !== dirty) {
    setSeenDirty(dirty);
    if (!dirty) setAutoKeyFieldIds(new Set());
  }
  const [busy, setBusy] = useState<"create" | "save" | "test" | "publish" | "unpublish" | "slug" | "draft-template" | "dismiss-notice" | "save-template" | "restore" | null>(null);
  const [notice, setNotice] = useState("");
  // Fields the builder just turned into a choice field that defaulted to radio cards (FB-9).
  const [autoRadioFieldIds, setAutoRadioFieldIds] = useState<ReadonlySet<string>>(() => new Set());
  // Field ids whose choice-size hint the builder dismissed this session. The
  // hint is only a suggestion, so dismissing it just hides it.
  const [dismissedChoiceHintIds, setDismissedChoiceHintIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState("");
  const [testIssues, setTestIssues] = useState<Array<{ fieldId: string | null; key: string; message: string; attendeeIndex?: number | null; path?: string }>>([]);
  const [showTemplates, setShowTemplates] = useState(initialForms.length === 0);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  // "Update draft from a template" (#1056): the picker, then a confirmation naming the chosen template.
  const [showDraftTemplates, setShowDraftTemplates] = useState(false);
  const [draftTemplateTarget, setDraftTemplateTarget] = useState<{ key: string; name: string; versionId?: string | null } | null>(null);
  // "Save as template" (#1065), system administrators only.
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [draftTemplateError, setDraftTemplateError] = useState("");
  // The address the server offers when a renamed, never-published form's
  // slug no longer matches its title; null while no prompt is open.
  const [slugPrompt, setSlugPrompt] = useState<{ offeredSlug: string } | null>(null);
  const [slugError, setSlugError] = useState("");
  const publishDialogRef = useAccessibleDialog<HTMLElement>(
    confirmingPublish,
    () => {
      if (!busy) setConfirmingPublish(false);
    },
  );
  const [dragging, setDragging] = useState<DragState>(null);
  const focusedFieldId = focusedForm && focusTarget && focusedForm.activeVersion.definition.sections.some((section) => section.fields.some((field) => field.id === focusTarget.fieldId)) ? focusTarget.fieldId : null;
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(focusedFieldId);
  // Scroll the linked field's fee input into view and focus it, once, after the first paint.
  useEffect(() => {
    if (!focusedFieldId) return;
    const input = document.getElementById(`registration-fee-${focusedFieldId}`);
    if (!input) return;
    input.scrollIntoView({ block: "center" });
    input.focus();
  }, [focusedFieldId]);
  // Where focus goes once the next render has the element (#1140): the draft chip after a restore, or the Restore
  // button that was activated after a failed one (it is disabled while busy, so focus can only return after).
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const handledFocusRequest = useRef<FocusRequest | null>(null);
  useEffect(() => {
    if (!focusRequest || busy !== null || handledFocusRequest.current === focusRequest) return;
    const element = document.getElementById(focusTargetId(focusRequest));
    if (!element) return;
    element.focus();
    handledFocusRequest.current = focusRequest;
  }, [focusRequest, busy, selectedVersionId]);
  const [openModuleSection, setOpenModuleSection] = useState<number | null>(null);
  const [moduleQuery, setModuleQuery] = useState("");
  const [moduleCategory, setModuleCategory] = useState<typeof moduleCategories[number]>("All");
  const [pricingPreviewDate, setPricingPreviewDate] = useState(localCalendarDate());
  const [previewStepId, setPreviewStepId] = useState<PublicRegistrationStepId>(
    () => selectedVersion?.definition
      ? firstPreviewStepId(selectedVersion.definition)
      : "__review",
  );
  const previewRef = useRef<HTMLElement>(null);
  useUnsavedChangesGuard(
    dirty,
    "This registration form has unsaved changes. Leave and discard the draft edits?",
  );

  function closeModuleLibrary() {
    setOpenModuleSection(null);
    setModuleQuery("");
    setModuleCategory("All");
  }
  return { history, setHistory, setFocusRequest, autoKeyFieldIds, setAutoKeyFieldIds, templates,setTemplates, showSaveTemplate, setShowSaveTemplate, forms, setForms, selectedFormId, setSelectedFormId, selectedForm, duplicatePublishedGroups, selectedVersionId, setSelectedVersionId, selectedVersion, definition, setDefinition, responses, setResponses, previewAttendees, setPreviewAttendees, dirty, setDirty, busy, setBusy, notice, setNotice, autoRadioFieldIds, setAutoRadioFieldIds, dismissedChoiceHintIds, setDismissedChoiceHintIds, error, setError, testIssues, setTestIssues, showTemplates, setShowTemplates, confirmingPublish, setConfirmingPublish, confirmingUnpublish, setConfirmingUnpublish, showDraftTemplates, setShowDraftTemplates, draftTemplateTarget, setDraftTemplateTarget, draftTemplateError, setDraftTemplateError, slugPrompt, setSlugPrompt, slugError, setSlugError, publishDialogRef, dragging, setDragging, expandedFieldId, setExpandedFieldId, openModuleSection, setOpenModuleSection, moduleQuery, setModuleQuery, moduleCategory, setModuleCategory, pricingPreviewDate, setPricingPreviewDate, previewStepId, setPreviewStepId, previewRef, closeModuleLibrary };
}

export type BuilderState = ReturnType<typeof useBuilderState>;
