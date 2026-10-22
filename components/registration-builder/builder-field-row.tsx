// Canvas zone, one field: its summary row, drag handle and actions menu. The
// field's settings open beneath it.
import { ActionsMenu } from "@/components/actions-menu";
import { ArrowDown, ArrowUp, ChevronRight, Copy, GripVertical, Trash2 } from "lucide-react";
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import { fieldTypeLabels } from "./builder-types";
import { BuilderFieldSettings } from "./builder-field-settings";
import { useLoadedBuilder } from "./builder-context";

export function BuilderFieldRow({ section, field, sectionIndex, fieldIndex }: { section: RegistrationFormDefinition["sections"][number]; field: RegistrationFormField; sectionIndex: number; fieldIndex: number }) {
  const { dragging, setDragging, expandedFieldId, setExpandedFieldId, canEdit, moveField, dropField, duplicateField, openRemoveField } = useLoadedBuilder();
  return (
    <article
            className={dragging?.kind === "field" && dragging.sectionIndex === sectionIndex && dragging.fieldIndex === fieldIndex ? "builder-field-card dragging" : "builder-field-card"}
             data-testid={`builder-field-${sectionIndex}-${fieldIndex}`}
             data-option-source={field.optionSource}
            onDragOver={(event) => { if (dragging?.kind === "field") event.preventDefault(); }}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropField(sectionIndex, fieldIndex); }}
          >
            <div className="field-module-row">
              {canEdit ? <button className="drag-handle field-drag-handle" type="button" draggable aria-label={`Drag field ${field.label}`} title="Drag field" onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragging({ kind: "field", sectionIndex, fieldIndex }); }} onDragEnd={() => setDragging(null)}><GripVertical size={16} /></button> : <GripVertical className="field-grip" size={17} />}
              <button className="field-module-summary" type="button" aria-expanded={expandedFieldId === field.id} aria-label={`${expandedFieldId === field.id ? "Close settings for" : "Edit"} ${field.label}`} onClick={() => setExpandedFieldId((current) => current === field.id ? null : field.id)}><span className="field-type-mark">{fieldTypeLabels[field.type].slice(0, 1)}</span><span><strong>{field.label}</strong><small>{fieldTypeLabels[field.type]} · {field.scope === "ATTENDEE" ? "Each attendee" : "Registration"}{field.required ? " · Required" : ""}</small></span><ChevronRight className={expandedFieldId === field.id ? "expanded" : ""} size={16} /></button>
              {canEdit && <div className="field-actions-menu"><ActionsMenu label="Actions" ariaLabel={`Actions for ${field.label}`}>
                <li><button type="button" aria-label={`Duplicate ${field.label}`} onClick={() => duplicateField(sectionIndex, fieldIndex)}><Copy size={14} aria-hidden="true" /> Copy</button></li>
                <li><button type="button" aria-label={`Move ${field.label} up`} disabled={fieldIndex === 0} onClick={() => moveField(sectionIndex, fieldIndex, -1)}><ArrowUp size={14} aria-hidden="true" /> Move up</button></li>
                <li><button type="button" aria-label={`Move ${field.label} down`} disabled={fieldIndex === section.fields.length - 1} onClick={() => moveField(sectionIndex, fieldIndex, 1)}><ArrowDown size={14} aria-hidden="true" /> Move down</button></li>
                <li className="actions-menu-divider"><button className="actions-menu-danger" type="button" aria-label={`Remove ${field.label}`} onClick={() => openRemoveField(sectionIndex, fieldIndex)}><Trash2 size={14} aria-hidden="true" /> Remove</button></li>
              </ActionsMenu></div>}
            </div>
      {expandedFieldId === field.id && <BuilderFieldSettings section={section} field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} />}
    </article>
  );
}
