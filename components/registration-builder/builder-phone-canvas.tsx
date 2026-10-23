// The phone builder's question list (#1071): the form shown one step at a time, each question a card with Edit, Move and
// More. Tapping Edit opens that question's settings full screen (the shell's inspector). Nothing needs dragging, and
// nothing here saves: every change is to the draft, saved with Save draft.
import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Copy, EllipsisVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { isPublicReviewSection } from "@/modules/forms/public-registration-steps";
import { fieldTypeLabels } from "./builder-types";
import { deriveFieldChips } from "./field-chips";
import { useLoadedBuilder } from "./builder-context";
import { BuilderSectionHead } from "./builder-section-card";
import { InformationFieldIssues, InformationFormIssues, InformationSectionIssues } from "./builder-information-issues";
import { PhoneSheet } from "./builder-phone-sheet";
import { showWhenSummary } from "./phone-move";
import type { ToolbarAction } from "./builder-canvas";

/** The More menu for one question: Duplicate, Save to library and Remove. A bottom sheet with its own focus trap. */
function QuestionMenu({ fieldId, onClose, onAction }: { fieldId: string; onClose: () => void; onAction: (action: ToolbarAction, sectionIndex: number, fieldIndex: number) => void }) {
  const { definition, setLibraryTarget, information } = useLoadedBuilder();
  const located = definition.sections.flatMap((section, sectionIndex) => section.fields.map((field, fieldIndex) => ({ field, sectionIndex, fieldIndex }))).find((entry) => entry.field.id === fieldId);
  if (!located) return null;
  const { field, sectionIndex, fieldIndex } = located;
  const label = field.label || "Untitled question";
  return (
    <PhoneSheet title={`Actions for “${label}”`} variant="menu" onClose={onClose}>
      <ul className="fb-phone-menu">
        <li><button type="button" className="fb-btn" onClick={() => { onClose(); onAction("duplicate", sectionIndex, fieldIndex); }}><Copy size={16} aria-hidden="true" /> Duplicate</button></li>
        {!information && <li><button type="button" className="fb-btn" onClick={() => { onClose(); setLibraryTarget({ fieldId }); }}><BookmarkPlus size={16} aria-hidden="true" /> Save to library</button></li>}
        <li><button type="button" className="fb-btn fb-phone-danger" onClick={() => { onClose(); onAction("remove", sectionIndex, fieldIndex); }}><Trash2 size={16} aria-hidden="true" /> Remove</button></li>
      </ul>
    </PhoneSheet>
  );
}

export function BuilderPhoneCanvas({ activeStepIndex, onStepChange, onEdit, onMove, onAddToStep, onAction }: {
  activeStepIndex: number;
  onStepChange: (sectionIndex: number) => void;
  onEdit: (fieldId: string, sectionIndex: number) => void;
  onMove: (fieldId: string) => void;
  onAddToStep: (sectionIndex: number) => void;
  onAction: (action: ToolbarAction, sectionIndex: number, fieldIndex: number) => void;
}) {
  const { definition, expandedFieldId, canEdit, replaceDefinition, addSection, information, allFields } = useLoadedBuilder();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [stepSettingsOpen, setStepSettingsOpen] = useState(false);
  const activeButton = useRef<HTMLButtonElement>(null);
  const sectionIndex = Math.min(Math.max(activeStepIndex, 0), definition.sections.length - 1);
  const section = definition.sections[sectionIndex]!;
  const review = isPublicReviewSection(definition, section);

  // The chosen step pill stays in view when the steps scroll sideways.
  useEffect(() => { activeButton.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [sectionIndex]);

  return (
    <section className="fb-canvas fb-phone-canvas" aria-label="The form's questions">
      <div className="fb-form-head">
        <label className="fb-field-label" htmlFor="fb-form-title">Form title</label>
        <input id="fb-form-title" className="fb-title-input" autoComplete="off" name="builder-rb-field-1" disabled={!canEdit} value={definition.title} maxLength={120} onChange={(event) => replaceDefinition({ ...definition, title: event.target.value })} />
        <label className="fb-field-label" htmlFor="fb-form-description">Description</label>
        <textarea id="fb-form-description" autoComplete="off" name="builder-rb-note-2" disabled={!canEdit} value={definition.description} maxLength={500} rows={2} onChange={(event) => replaceDefinition({ ...definition, description: event.target.value })} />
        <InformationFormIssues />
      </div>
      <nav className="fb-phone-steps-nav" aria-label="Steps">
        {definition.sections.map((candidate, index) => (
          <button
            key={candidate.id}
            ref={index === sectionIndex ? activeButton : undefined}
            type="button"
            className="fb-phone-step-pill"
            aria-current={index === sectionIndex ? "step" : undefined}
            onClick={() => { setStepSettingsOpen(false); onStepChange(index); }}
          >{index + 1} · {candidate.title || "Untitled step"}</button>
        ))}
      </nav>
      <div className="fb-step fb-phone-step" data-testid={`builder-section-${sectionIndex}`}>
        <div className="fb-step-head">
          <span className="fb-step-badge">Step {sectionIndex + 1} of {definition.sections.length}</span>
          <h3 id={`fb-step-title-${section.id}`}>{section.title || "Untitled step"}</h3>
          {review && <span className="fb-step-tag">Final review</span>}
          <button type="button" className="fb-link-button" aria-expanded={stepSettingsOpen} aria-controls={`fb-step-settings-${section.id}`} onClick={() => setStepSettingsOpen((open) => !open)}>
            <Settings2 size={15} aria-hidden="true" /> Step settings
          </button>
        </div>
        {stepSettingsOpen && <div className="fb-step-settings builder-section" id={`fb-step-settings-${section.id}`}><BuilderSectionHead section={section} sectionIndex={sectionIndex} /></div>}
        <InformationSectionIssues sectionId={section.id} />
        {section.description && <p className="fb-step-description">{section.description}</p>}
        <ul className="fb-phone-list" aria-labelledby={`fb-step-title-${section.id}`}>
          {section.fields.map((field, fieldIndex) => {
            const label = field.label || "Untitled question";
            const chips = deriveFieldChips(field, section.title, { information: Boolean(information) }).map((chip) => chip.label);
            const rule = showWhenSummary(field, allFields);
            const selected = expandedFieldId === field.id;
            return (
              <li className={`fb-phone-card${selected ? " selected" : ""}`} key={field.id} data-testid={`builder-field-${sectionIndex}-${fieldIndex}`} data-option-source={field.optionSource} data-field-id={field.id}>
                <p className="fb-phone-card-label">{label}{field.required && <span className="fb-required" aria-hidden="true"> *</span>}</p>
                <p className="fb-phone-card-meta">{[fieldTypeLabels[field.type], ...chips].join(" · ")}</p>
                {rule && <p className="fb-phone-card-rule">Shown when: {rule}</p>}
                <InformationFieldIssues fieldId={field.id} />
                <div className="fb-phone-card-actions">
                  <button type="button" className="fb-btn outline" data-fb-phone-edit={field.id} aria-label={`${canEdit ? "Edit" : "View settings for"} ${label}`} onClick={() => onEdit(field.id, sectionIndex)}>{canEdit ? "Edit" : "View"}</button>
                  {canEdit && <button type="button" className="fb-btn outline" aria-label={`Move ${label}`} onClick={() => onMove(field.id)}>Move</button>}
                  {canEdit && <button type="button" className="fb-btn fb-phone-more" aria-haspopup="dialog" aria-label={`More actions for ${label}`} onClick={() => setMenuFor(field.id)}><EllipsisVertical size={18} aria-hidden="true" /></button>}
                </div>
              </li>
            );
          })}
        </ul>
        {canEdit && (
          <button type="button" className="fb-btn outline fb-phone-add" data-fb-step-add={section.id} aria-label={`Add question to step ${sectionIndex + 1}, ${section.title}`} onClick={() => onAddToStep(sectionIndex)}>
            <Plus size={18} aria-hidden="true" /> Add question
          </button>
        )}
      </div>
      {canEdit && <button className="add-section-button" type="button" onClick={addSection}><Plus size={17} aria-hidden="true" /> Add another section</button>}
      {menuFor && <QuestionMenu fieldId={menuFor} onClose={() => setMenuFor(null)} onAction={onAction} />}
    </section>
  );
}
