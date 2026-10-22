"use client";

// Registration form builder. This file only wires the pieces together: it
// builds the builder model (state, edits and actions, see use-builder-model.ts)
// and lays out the zones, each of which reads the model from BuilderContext.
// Zones: top bar (builder-top-bar), field list (builder-field-list), canvas
// (builder-section-card and its field rows), field settings
// (builder-field-settings) and preview (builder-preview).

import { useConfirm } from "@/components/use-confirm";
import { EmptyState } from "@/components/empty-state";
import { PUBLIC_DRAFT_STAFF_HELP } from "@/modules/forms/public-draft";
import { CopyPlus, FileClock, Plus } from "lucide-react";
import { RegistrationFormNotificationsPanel } from "@/components/registration-form-notifications-panel";
import { DangerZone, DangerZoneItem } from "@/components/danger-zone";
import { TemplateCleanupChecklistPanel } from "@/components/template-cleanup-checklist-panel";
import type { BuilderWorkspaceProps } from "@/components/registration-builder/builder-types";
import { BuilderPageIntro, BuilderEditorHead } from "@/components/registration-builder/builder-top-bar";
import { BuilderDraftTemplatePanel, BuilderNewTemplatePanel } from "@/components/registration-builder/builder-template-panels";
import { BuilderNotices } from "@/components/registration-builder/builder-notices";
import { BuilderFormList } from "@/components/registration-builder/builder-form-list";
import { BuilderRosterSettings, BuilderConfirmationEditor } from "@/components/registration-builder/builder-form-settings";
import { BuilderPaymentSettings } from "@/components/registration-builder/builder-payment-settings";
import { BuilderSectionCard } from "@/components/registration-builder/builder-section-card";
import { BuilderPreview } from "@/components/registration-builder/builder-preview";
import { BuilderDialogs } from "@/components/registration-builder/builder-dialogs";
import { BuilderContext } from "@/components/registration-builder/builder-context";
import { useBuilderModel } from "@/components/registration-builder/use-builder-model";

export function RegistrationBuilderWorkspace(props: BuilderWorkspaceProps) {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const model = useBuilderModel(props, askConfirm);
  const { forms, selectedForm, selectedVersion, definition, busy, showTemplates, setShowTemplates, setConfirmingUnpublish, publishedVersion, canEdit, addSection, eventId, canEditNotifications } = model;
  return <BuilderContext.Provider value={model}><section className="page-stack builder-workspace">{confirmDialog}
    <BuilderPageIntro />
    <BuilderDraftTemplatePanel />
    <BuilderNewTemplatePanel />
    <BuilderNotices />
    {forms.length === 0 ? <EmptyState action={{ label: "Choose a template", onClick: () => setShowTemplates(true) }} canCreate={canEdit && !showTemplates} className="panel builder-empty" hint={canEdit ? undefined : "Ask an event administrator with form access to create the first form."} icon={<CopyPlus size={32} />} title="No registration form yet">Without a form, nobody can register for this event. Choose “Blank form” or a tested local template to begin. Nothing will be published publicly or sent to an external service.</EmptyState> : <div className="builder-layout">
      <BuilderFormList />
      {selectedForm && selectedVersion && definition && <>
        <div className="builder-canvas"><BuilderEditorHead />
        {canEdit && <TemplateCleanupChecklistPanel key={selectedForm.id} formId={selectedForm.id} definition={definition} />}
        <BuilderRosterSettings />
        <p className="builder-draft-note"><small>{PUBLIC_DRAFT_STAFF_HELP}</small></p>
        {definition.sections.map((section, sectionIndex) => <BuilderSectionCard key={section.id} section={section} sectionIndex={sectionIndex} />)}
        {canEdit && <button className="add-section-button" type="button" onClick={addSection}><Plus size={17} /> Add another section</button>}
        <BuilderPaymentSettings />
        {canEditNotifications && selectedForm && <RegistrationFormNotificationsPanel key={selectedForm.id} eventId={eventId} formId={selectedForm.id} />}
        <BuilderConfirmationEditor />
        {publishedVersion && selectedForm && (
          <DangerZone className="builder-danger-zone" heading="Withdraw this form">
            <DangerZoneItem title="Withdraw from public page">
              <p>The form disappears from the public event page and stops accepting new registrations. Registrations already taken keep the version they were submitted under. Publishing again later creates a new version.</p>
              <button className="secondary-button danger-outline-button" type="button" disabled={busy !== null} onClick={() => setConfirmingUnpublish(true)}><FileClock size={15} aria-hidden="true" /> Withdraw {selectedForm.name}…</button>
            </DangerZoneItem>
          </DangerZone>
        )}
        </div>
        <BuilderPreview />
      </>}
    </div>}
    <BuilderDialogs />
  </section></BuilderContext.Provider>;
}
