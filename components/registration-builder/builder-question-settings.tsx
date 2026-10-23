// The Question settings tab (#1132): the selected question's basic settings
// first (label, placeholder, help text, Required, and whether it is asked once
// or of each person), then everything else under Advanced. Nothing here
// re-implements a setting: it composes the existing field-settings pieces.
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { fieldTypeLabels } from "./builder-types";
import type { ToolbarAction } from "./builder-canvas";
import { BuilderFieldSettings, BuilderLabelInput, BuilderRequiredToggle, scopeChangePatch } from "./builder-field-settings";
import { BuilderHelpTextInput, BuilderPlaceholderInput } from "./builder-field-advanced";
import { useLoadedBuilder } from "./builder-context";
import { InformationFieldIssues } from "./builder-information-issues";
import type { RegistrationFormField } from "@/modules/forms/definition";

export type QuestionSelection = { sectionIndex: number; fieldIndex: number; field: RegistrationFormField };

export const LABEL_INPUT_ID = "fb-setting-label";

/**
 * `onAction` shows Move up, Move down, Duplicate and Remove inside the panel (#1139). On a tablet or desktop the question's own
 * toolbar on the canvas has them, so this group is hidden there; at phone width the canvas is covered by the full-screen
 * inspector and this group is the way to reach them. Real buttons, so they work with a keyboard and a finger, never on hover.
 */
export function BuilderQuestionSettings({ selection, onAction }: { selection: QuestionSelection | null; onAction?: (action: ToolbarAction, sectionIndex: number, fieldIndex: number) => void }) {
  const { definition, canEdit, allFields, updateField, information } = useLoadedBuilder();
  if (!selection) {
    return <p className="fb-empty">Select a question on the form to change its settings.</p>;
  }
  const { field, sectionIndex, fieldIndex } = selection;
  const section = definition.sections[sectionIndex]!;
  return (
    <div className="fb-question-settings builder-section" key={field.id}>
      <p className="fb-selected-heading"><strong>{field.label || "Untitled question"}</strong><span className="fb-chip">{fieldTypeLabels[field.type]}</span></p>
      <InformationFieldIssues fieldId={field.id} />
      <div className="fb-basic-settings">
        <BuilderLabelInput field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} inputId={LABEL_INPUT_ID} />
        <BuilderPlaceholderInput field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} className="" />
        <BuilderHelpTextInput field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} className="" />
        <div className="fb-option-row">
          <BuilderRequiredToggle field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} className="fb-option" />
          {!information && <fieldset className="fb-scope" disabled={!canEdit}>
            <legend>Who answers it</legend>
            {(["REGISTRATION", "ATTENDEE"] as const).map((scope) => (
              <label className="fb-option" key={scope}>
                <input
                  type="radio"
                  name={`fb-scope-${field.id}`}
                  value={scope}
                  checked={field.scope === scope}
                  onChange={() => updateField(sectionIndex, fieldIndex, scopeChangePatch(field, scope, allFields))}
                /> {scope === "ATTENDEE" ? "Asked of each person" : "Asked once"}
              </label>
            ))}
          </fieldset>}
        </div>
      </div>
      {canEdit && onAction && (
        <div className="fb-inspector-actions" role="group" aria-label={`Question actions for ${field.label || "Untitled question"}`}>
          <button type="button" className="fb-tool" data-fb-action="up" data-field-id={field.id} aria-disabled={fieldIndex === 0 ? "true" : undefined} onClick={() => { if (fieldIndex > 0) onAction("up", sectionIndex, fieldIndex); }}><ArrowUp size={15} aria-hidden="true" /><span>Move up</span></button>
          <button type="button" className="fb-tool" data-fb-action="down" data-field-id={field.id} aria-disabled={fieldIndex === section.fields.length - 1 ? "true" : undefined} onClick={() => { if (fieldIndex < section.fields.length - 1) onAction("down", sectionIndex, fieldIndex); }}><ArrowDown size={15} aria-hidden="true" /><span>Move down</span></button>
          <button type="button" className="fb-tool" onClick={() => onAction("duplicate", sectionIndex, fieldIndex)}><Copy size={15} aria-hidden="true" /><span>Duplicate</span></button>
          <button type="button" className="fb-tool danger" onClick={() => onAction("remove", sectionIndex, fieldIndex)}><Trash2 size={15} aria-hidden="true" /><span>Remove</span></button>
        </div>
      )}
      <details className="fb-advanced">
        <summary>Advanced</summary>
        <div className="fb-advanced-body">
          <BuilderFieldSettings section={section} field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} variant="panel" />
        </div>
      </details>
    </div>
  );
}
