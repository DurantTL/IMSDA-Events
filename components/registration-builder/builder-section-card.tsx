// Canvas zone, one step: the section header (title, progress label, review
// toggle, reorder and remove) and the rows of its fields.
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { isPublicReviewSection } from "@/modules/forms/public-registration-steps";
import { BuilderFieldRow } from "./builder-field-row";
import { BuilderFieldList } from "./builder-field-list";
import { useLoadedBuilder } from "./builder-context";

export function BuilderSectionCard({ section, sectionIndex }: { section: RegistrationFormDefinition["sections"][number]; sectionIndex: number }) {
  const { definition, dragging, setDragging, canEdit, updateSection, moveSection, dropSection, dropField, setReviewSection, openRemoveSection } = useLoadedBuilder();
  return (
    <section
          className={dragging?.kind === "section" && dragging.sectionIndex === sectionIndex ? "panel builder-section dragging" : "panel builder-section"}
          data-testid={`builder-section-${sectionIndex}`}
          onDragOver={(event) => { if (dragging) event.preventDefault(); }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging?.kind === "section") dropSection(sectionIndex);
            if (dragging?.kind === "field") dropField(sectionIndex, section.fields.length);
          }}
        >
          <div className="builder-section-head">
            <span className="section-number">{sectionIndex + 1}</span>
            <div className="builder-section-copy">
              <span className="builder-step-link">Public step {sectionIndex + 1}{isPublicReviewSection(definition, section) ? " · Final review" : ""}</span>
              <input autoComplete="off" name="builder-rb-field-5" aria-label={`Section ${sectionIndex + 1} title`} disabled={!canEdit} value={section.title} maxLength={120} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} />
              <textarea autoComplete="off" name="builder-rb-note-6" aria-label={`Section ${sectionIndex + 1} description`} className="section-description-input" rows={2} disabled={!canEdit} value={section.description} maxLength={500} placeholder="Optional section description" onChange={(event) => updateSection(sectionIndex, { description: event.target.value })} />
              <div className="builder-step-settings">
                <label>Progress label<input autoComplete="off" name="builder-rb-field-7" aria-label={`Step ${sectionIndex + 1} progress label`} disabled={!canEdit} value={section.stepLabel ?? section.title.slice(0, 40)} maxLength={40} onChange={(event) => updateSection(sectionIndex, { stepLabel: event.target.value })} /></label>
                <label className="builder-review-toggle"><input disabled={!canEdit} type="checkbox" checked={isPublicReviewSection(definition, section)} onChange={(event) => setReviewSection(sectionIndex, event.target.checked)} /> Final review and payment step</label>
              </div>
            </div>
            {canEdit && <div className="section-actions">
              <button className="drag-handle" type="button" draggable={!isPublicReviewSection(definition, section)} disabled={isPublicReviewSection(definition, section)} aria-label={`Drag section ${section.title}`} title={isPublicReviewSection(definition, section) ? "The final review step stays last" : "Drag section"} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragging({ kind: "section", sectionIndex }); }} onDragEnd={() => setDragging(null)}><GripVertical size={15} /><span>Drag</span></button>
              <button type="button" aria-label={`Move section ${section.title} up`} disabled={sectionIndex === 0 || isPublicReviewSection(definition, section)} onClick={() => moveSection(sectionIndex, -1)}><ArrowUp size={14} /><span>Up</span></button>
              <button type="button" aria-label={`Move section ${section.title} down`} disabled={sectionIndex === definition.sections.length - 1 || isPublicReviewSection(definition, definition.sections[sectionIndex + 1]!)} onClick={() => moveSection(sectionIndex, 1)}><ArrowDown size={14} /><span>Down</span></button>
              <button className="danger" type="button" aria-label={`Remove ${section.title}`} onClick={() => openRemoveSection(sectionIndex)}><Trash2 size={14} /><span>Remove</span></button>
            </div>}
          </div>
          <div className="builder-fields">{section.fields.map((field, fieldIndex) => <BuilderFieldRow key={field.id} section={section} field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} />)}</div>
          <BuilderFieldList section={section} sectionIndex={sectionIndex} />
    </section>
  );
}
