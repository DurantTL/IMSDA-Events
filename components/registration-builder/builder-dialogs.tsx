// Modal dialogs: withdraw, web-address sync, publish, replace-the-draft and the
// remove field/section reviews.
import { ShieldCheck, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormSlugDialog } from "@/components/form-slug-dialog";
import { removalAnswerNote } from "@/modules/forms/field-answer-counts";
import { useBuilder } from "./builder-context";
import { BuilderSaveQuestionDialog } from "./builder-save-question";

export function BuilderDialogs() {
  const { selectedForm, selectedVersion, busy, confirmingPublish, setConfirmingPublish, dirty, editsCreateDraft, confirmingUnpublish, setConfirmingUnpublish, draftTemplateTarget, setDraftTemplateTarget, templates, draftTemplateError, setDraftTemplateError, slugPrompt, setSlugPrompt, slugError, setSlugError, publishDialogRef, removeFieldTarget, setRemoveFieldTarget, removeSectionTarget, setRemoveSectionTarget, removalAnswerCounts, removalAnswerCountsLoading, resetRemovalAnswerCounts, confirmRemoveField, confirmRemoveSection, updateDraftFromTemplate, keepSlug, updateSlug, publish, unpublish, eventSlug, information } = useBuilder();
  return (
    <>
    {confirmingUnpublish && selectedForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmingUnpublish(false); }}><section className="modal-card confirm-import-modal" role="dialog" aria-modal="true" aria-labelledby="unpublish-form-title" tabIndex={-1}><div className="modal-head"><div><p className="eyebrow">Withdraw registration form</p><h2 id="unpublish-form-title">Stop offering {selectedForm.name}?</h2></div><button className="icon-button modal-close-button" type="button" aria-label="Close dialog" onClick={() => setConfirmingUnpublish(false)}><X size={18} /></button></div><div className="boundary-callout"><ShieldCheck size={19} /><span><strong>Registrations already taken are not changed</strong><small>They reference the exact version they were submitted under, including its questions and prices.</small></span></div><p className="confirm-copy">The form disappears from the public event page and stops accepting new registrations. Publishing it again later creates a new version.</p><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setConfirmingUnpublish(false)}>Keep it published</button><button className="primary-button lifecycle-danger-button" type="button" disabled={busy !== null} onClick={unpublish}>{busy === "unpublish" ? "Withdrawing…" : `Withdraw ${selectedForm.name}`}</button></div></section></div>}

    {selectedForm && <FormSlugDialog open={slugPrompt !== null} eventSlug={eventSlug} currentSlug={selectedForm.slug} offeredSlug={slugPrompt?.offeredSlug ?? ""} error={slugError} busy={busy === "slug"} onKeep={keepSlug} onUpdate={updateSlug} onCancel={() => { setSlugPrompt(null); setSlugError(""); }} />}

    {confirmingPublish && selectedForm && selectedVersion && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmingPublish(false); }}><section className="modal-card confirm-import-modal" ref={publishDialogRef} role="dialog" aria-modal="true" aria-labelledby="publish-form-title" tabIndex={-1}><div className="modal-head"><div><p className="eyebrow">{information ? "Publish information form" : "Publish registration form"}</p><h2 id="publish-form-title">{dirty ? "Save and publish your changes?" : `Publish version ${selectedVersion.versionNumber}?`}</h2></div><button className="icon-button modal-close-button" type="button" aria-label="Close dialog" onClick={() => setConfirmingPublish(false)}><X size={18} /></button></div><div className="boundary-callout"><ShieldCheck size={19} />{information
              ? <span><strong>This version becomes the one people answer</strong><small>Publishing does not open the form. Open it in Form settings when you want it to accept answers.</small></span>
              : <span><strong>This form will be ready for the public event page</strong><small>The event must also be published in Event settings before visitors can register.</small></span>}</div>{dirty && <p className="confirm-copy">Your unsaved changes will be saved{editsCreateDraft ? " as a new draft version" : ""} and then published.</p>}<p className="confirm-copy">{dirty ? "" : "This version is saved as the public version. "}{information ? "Later edits create a new draft, so answers already received always keep the exact questions they were given." : "Later edits create a new draft, so existing registrations always retain the exact questions and prices they submitted."}</p><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setConfirmingPublish(false)}>Review again</button><button className="primary-button" type="button" disabled={busy !== null} onClick={publish}>{busy === "publish" ? "Publishing…" : dirty ? "Save and publish" : "Publish form"}</button></div></section></div>}

    <ConfirmDialog
      busy={busy === "draft-template"}
      busyLabel="Updating the draft…"
      cancelLabel="Keep my draft"
      confirmLabel={draftTemplateTarget ? `Replace the draft with ${draftTemplateTarget.name}` : "Replace the draft"}
      destructive
      error={draftTemplateError}
      onCancel={() => { if (busy === null) { setDraftTemplateTarget(null); setDraftTemplateError(""); } }}
      onConfirm={updateDraftFromTemplate}
      open={draftTemplateTarget !== null}
      title={draftTemplateTarget && selectedForm ? `Replace the draft of ${selectedForm.name} with ${draftTemplateTarget.name}?` : "Replace the draft?"}
    >
      <ul>
        <li>This replaces any unpublished draft changes, including edits you have not saved. Test submissions run against the old draft are removed.</li>
        <li>The live form is unchanged until you publish the new draft.</li>
        <li>Registrations already received keep their answers.</li>
        {(templates.find((template) => template.key === draftTemplateTarget?.key)?.placeholderAcknowledgments ?? 0) > 0 && <li>This template has acknowledgment wording that still says &ldquo;Replace this with the statement people acknowledge.&rdquo; Write the real statement before you publish; a form with that placeholder cannot be published.</li>}
      </ul>
    </ConfirmDialog>
    <ConfirmDialog
      busy={false}
      confirmLabel={removeFieldTarget ? `Remove "${removeFieldTarget.field.label}"` : "Remove field"}
      destructive
      error=""
      onCancel={() => { setRemoveFieldTarget(null); resetRemovalAnswerCounts(); }}
      onConfirm={confirmRemoveField}
      open={removeFieldTarget !== null}
      title={removeFieldTarget ? `Remove "${removeFieldTarget.field.label}"?` : "Remove field?"}
    >
      {removeFieldTarget && <p>
        This field is removed from the draft.{" "}
        {removalAnswerCountsLoading
          ? "Checking already-submitted answers…"
          : removalAnswerNote("field", [removeFieldTarget.field.key], removalAnswerCounts)}
      </p>}
    </ConfirmDialog>

    <ConfirmDialog
      busy={false}
      confirmLabel={removeSectionTarget ? `Remove "${removeSectionTarget.section.title}"` : "Remove section"}
      destructive
      error=""
      onCancel={() => { setRemoveSectionTarget(null); resetRemovalAnswerCounts(); }}
      onConfirm={confirmRemoveSection}
      open={removeSectionTarget !== null}
      title={removeSectionTarget ? `Remove "${removeSectionTarget.section.title}"?` : "Remove section?"}
    >
      {removeSectionTarget && <p>
        This section and its {removeSectionTarget.section.fields.length} field{removeSectionTarget.section.fields.length === 1 ? "" : "s"} are removed from the draft.{" "}
        {removalAnswerCountsLoading
          ? "Checking already-submitted answers…"
          : removalAnswerNote("section", removeSectionTarget.section.fields.map((field) => field.key), removalAnswerCounts)}
      </p>}
    </ConfirmDialog>
    <BuilderSaveQuestionDialog />
    </>
  );
}
