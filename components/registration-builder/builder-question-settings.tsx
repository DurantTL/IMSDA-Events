// The Question settings tab (#1132): the selected question's basic settings
// first (label, placeholder, help text, Required, and whether it is asked once
// or of each person), then everything else under Advanced. Nothing here
// re-implements a setting: it composes the existing field-settings pieces.
import { fieldTypeLabels } from "./builder-types";
import { BuilderFieldSettings, BuilderLabelInput, BuilderRequiredToggle, scopeChangePatch } from "./builder-field-settings";
import { BuilderHelpTextInput, BuilderPlaceholderInput } from "./builder-field-advanced";
import { useLoadedBuilder } from "./builder-context";
import type { RegistrationFormField } from "@/modules/forms/definition";

export type QuestionSelection = { sectionIndex: number; fieldIndex: number; field: RegistrationFormField };

export const LABEL_INPUT_ID = "fb-setting-label";

export function BuilderQuestionSettings({ selection }: { selection: QuestionSelection | null }) {
  const { definition, canEdit, allFields, updateField } = useLoadedBuilder();
  if (!selection) {
    return <p className="fb-empty">Select a question on the form to change its settings.</p>;
  }
  const { field, sectionIndex, fieldIndex } = selection;
  const section = definition.sections[sectionIndex]!;
  return (
    <div className="fb-question-settings builder-section" key={field.id}>
      <p className="fb-selected-heading"><strong>{field.label || "Untitled question"}</strong><span className="fb-chip">{fieldTypeLabels[field.type]}</span></p>
      <div className="fb-basic-settings">
        <BuilderLabelInput field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} inputId={LABEL_INPUT_ID} />
        <BuilderPlaceholderInput field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} className="" />
        <BuilderHelpTextInput field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} className="" />
        <div className="fb-option-row">
          <BuilderRequiredToggle field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} className="fb-option" />
          <fieldset className="fb-scope" disabled={!canEdit}>
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
          </fieldset>
        </div>
      </div>
      <details className="fb-advanced">
        <summary>Advanced</summary>
        <div className="fb-advanced-body">
          <BuilderFieldSettings section={section} field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} variant="panel" />
        </div>
      </details>
    </div>
  );
}
