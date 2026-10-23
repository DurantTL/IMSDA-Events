// The live form canvas (#1132): the form as respondents see it, with real
// labels and input boxes, same-row fields side by side and steps as headed
// groups. Clicking (or Enter/Space on) a question selects it; the selected
// question shows Move up, Move down, Duplicate and Remove. Phones and form
// templates keep the older section cards (builder-section-card.tsx).
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { directorySourceNoun, isDirectoryOptionSource, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { isPublicReviewSection } from "@/modules/forms/public-registration-steps";
import { fieldTypeLabels, money } from "./builder-types";
import { deriveFieldChips } from "./field-chips";
import { BuilderSectionHead } from "./builder-section-card";
import { useLoadedBuilder } from "./builder-context";
import { buildCanvasRows } from "./canvas-rows";
import type { PaletteEntry } from "./palette-registry";

export type ToolbarAction = "settings" | "up" | "down" | "duplicate" | "remove";

type Section = RegistrationFormDefinition["sections"][number];

const shownChoices = 4;

function ChoicePreview({ field, mark }: { field: RegistrationFormField; mark: "radio" | "check" | "rank" }) {
  const options = field.options.slice(0, shownChoices);
  return (
    <span className="fb-choices">
      {options.map((option, index) => <span className="fb-choice" key={option}><span className={`fb-choice-mark ${mark}`}>{mark === "rank" ? index + 1 : ""}</span>{option}</span>)}
      {field.options.length > shownChoices && <span className="fb-choice fb-choice-more">+{field.options.length - shownChoices} more</span>}
    </span>
  );
}

/** A picture of the control a respondent gets. Never interactive: it is shown inside the button that selects the question. */
export function FieldPreviewControl({ field }: { field: RegistrationFormField }) {
  switch (field.type) {
    case "LONG_TEXT":
      return <span className="fb-input fb-textarea">{field.placeholder}</span>;
    case "DATE":
      return <span className="fb-input">mm/dd/yyyy</span>;
    case "SELECT": {
      const source = field.optionSource;
      const hint = isDirectoryOptionSource(source) ? `Search ${directorySourceNoun(source)}…` : source === "ATTENDEE_TYPES" ? "Attendee type" : "Choose…";
      return <span className="fb-input fb-select">{hint}</span>;
    }
    case "RADIO":
      return field.optionSource === "ATTENDEE_TYPES" ? <span className="fb-input fb-select">Attendee type</span> : <ChoicePreview field={field} mark="radio" />;
    case "MULTISELECT":
      return <ChoicePreview field={field} mark="check" />;
    case "RANKED_CHOICE":
      return <ChoicePreview field={field} mark="rank" />;
    case "CHECKBOX":
      return <span className="fb-choice"><span className="fb-choice-mark check" />{field.placeholder || "Yes, I agree"}</span>;
    case "ACKNOWLEDGMENT":
      return <span className="fb-acknowledgment">{field.acknowledgment?.source === "TEXT" && field.acknowledgment.text ? field.acknowledgment.text : "The agreement wording is shown here."}<span className="fb-choice"><span className="fb-choice-mark check" />I acknowledge this.</span></span>;
    case "CALCULATED":
      return <span className="fb-fee">{field.priceCents === undefined ? "Fee set in the question settings" : `Fee: ${money(field.priceCents)}`}</span>;
    case "ADDRESS":
      return <span className="fb-address"><span className="fb-input">Street address</span><span className="fb-input">City, state, ZIP</span></span>;
    default:
      return <span className="fb-input">{field.placeholder}</span>;
  }
}

function FieldToolbar({ section, field, sectionIndex, fieldIndex, onAction }: { section: Section; field: RegistrationFormField; sectionIndex: number; fieldIndex: number; onAction: (action: ToolbarAction, sectionIndex: number, fieldIndex: number) => void }) {
  const { setDragging } = useLoadedBuilder();
  const first = fieldIndex === 0;
  const last = fieldIndex === section.fields.length - 1;
  // Move buttons use aria-disabled, not disabled, so keyboard focus stays on the button when the field reaches an end of its step.
  const action = (name: ToolbarAction, label: string, icon: ReactNode, extra: { disabled?: boolean; danger?: boolean; ariaLabel: string }) => (
    <button
      type="button"
      className={extra.danger ? "fb-tool danger" : "fb-tool"}
      data-fb-action={name}
      data-field-id={field.id}
      aria-label={extra.ariaLabel}
      aria-disabled={extra.disabled ? "true" : undefined}
      onClick={() => { if (!extra.disabled) onAction(name, sectionIndex, fieldIndex); }}
    >{icon}<span>{label}</span></button>
  );
  return (
    <div className="fb-toolbar" role="group" aria-label={`Actions for ${field.label}`}>
      {action("settings", "Settings", <Settings2 size={15} aria-hidden="true" />, { ariaLabel: `Edit settings for ${field.label}` })}
      {action("up", "Move up", <ArrowUp size={15} aria-hidden="true" />, { ariaLabel: `Move ${field.label} up`, disabled: first })}
      {action("down", "Move down", <ArrowDown size={15} aria-hidden="true" />, { ariaLabel: `Move ${field.label} down`, disabled: last })}
      {action("duplicate", "Duplicate", <Copy size={15} aria-hidden="true" />, { ariaLabel: `Duplicate ${field.label}` })}
      {action("remove", "Remove", <Trash2 size={15} aria-hidden="true" />, { ariaLabel: `Remove ${field.label}`, danger: true })}
      <button
        type="button"
        className="fb-tool fb-drag"
        draggable
        aria-label={`Drag ${field.label} to a new place. Or use Move up and Move down.`}
        title="Drag to move"
        onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", field.id); setDragging({ kind: "field", sectionIndex, fieldIndex }); }}
        onDragEnd={() => setDragging(null)}
      ><GripVertical size={15} aria-hidden="true" /><span>Drag</span></button>
    </div>
  );
}

function CanvasStep({ section, sectionIndex, paletteDrag, onSelect, onAction, onAddToStep, onDropPalette }: {
  section: Section;
  sectionIndex: number;
  paletteDrag: PaletteEntry | null;
  onSelect: (fieldId: string, sectionIndex: number) => void;
  onAction: (action: ToolbarAction, sectionIndex: number, fieldIndex: number) => void;
  onAddToStep: (sectionIndex: number) => void;
  onDropPalette: (sectionIndex: number, index: number) => void;
}) {
  const { definition, expandedFieldId, canEdit, dragging, dropField, dropSection } = useLoadedBuilder();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const review = isPublicReviewSection(definition, section);
  const rows = buildCanvasRows(section.fields);
  const dragActive = Boolean(paletteDrag) || dragging?.kind === "field";

  function dropAt(index: number) {
    setDropIndex(null);
    if (paletteDrag) onDropPalette(sectionIndex, index);
    else if (dragging?.kind === "field") dropField(sectionIndex, index);
  }

  return (
    <section
      className={dragging?.kind === "section" && dragging.sectionIndex === sectionIndex ? "fb-step dragging" : "fb-step"}
      aria-labelledby={`fb-step-title-${section.id}`}
      data-testid={`builder-section-${sectionIndex}`}
      onDragOver={(event) => { if (paletteDrag || dragging) event.preventDefault(); }}
      onDrop={(event) => {
        event.preventDefault();
        if (dragging?.kind === "section") dropSection(sectionIndex);
        else dropAt(section.fields.length);
      }}
    >
      <div className="fb-step-head">
        <span className="fb-step-badge">Step {sectionIndex + 1}</span>
        <h3 id={`fb-step-title-${section.id}`}>{section.title || "Untitled step"}</h3>
        {review && <span className="fb-step-tag">Final review</span>}
        <button type="button" className="fb-link-button" aria-expanded={settingsOpen} aria-controls={`fb-step-settings-${section.id}`} onClick={() => setSettingsOpen((open) => !open)}>
          <Settings2 size={15} aria-hidden="true" /> Step settings
        </button>
      </div>
      {settingsOpen && <div className="fb-step-settings builder-section" id={`fb-step-settings-${section.id}`}><BuilderSectionHead section={section} sectionIndex={sectionIndex} /></div>}
      {section.description && <p className="fb-step-description">{section.description}</p>}
      <div className="fb-rows">
        {rows.map((row) => (
          <div className="fb-row" key={row.key} role={row.groupLabel ? "group" : undefined} aria-label={row.groupLabel ?? undefined}>
            {row.groupLabel && <p className="fb-row-group" aria-hidden="true">{row.groupLabel}</p>}
            <div className="fb-row-cells">
              {row.cells.map(({ field, fieldIndex }) => {
                const selected = expandedFieldId === field.id;
                const chips = deriveFieldChips(field, section.title);
                return (
                  <div
                    className={`fb-cell${selected ? " selected" : ""}${dropIndex === fieldIndex && dragActive ? " drop-before" : ""}${dragging?.kind === "field" && dragging.sectionIndex === sectionIndex && dragging.fieldIndex === fieldIndex ? " dragging" : ""}`}
                    key={field.id}
                    data-testid={`builder-field-${sectionIndex}-${fieldIndex}`}
                    data-option-source={field.optionSource}
                    onDragOver={(event) => { if (dragActive) { event.preventDefault(); event.stopPropagation(); setDropIndex(fieldIndex); } }}
                    onDragLeave={() => setDropIndex((current) => current === fieldIndex ? null : current)}
                    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropAt(fieldIndex); }}
                  >
                    <button
                      type="button"
                      className="fb-field"
                      data-field-id={field.id}
                      aria-current={selected ? "true" : undefined}
                      aria-label={`${field.label || "Untitled question"}, ${fieldTypeLabels[field.type]}, ${chips.map((chip) => chip.label).join(", ")}. ${selected ? "Selected." : "Select to edit."}`}
                      onClick={() => onSelect(field.id, sectionIndex)}
                    >
                      <span className="fb-q-label" aria-hidden="true">{field.label}{field.required && <span className="fb-required"> *</span>}</span>
                      <span className="fb-control" aria-hidden="true"><FieldPreviewControl field={field} /></span>
                      {field.helpText && <span className="fb-field-help" aria-hidden="true">{field.helpText}</span>}
                      {/* Text chips, never colour alone; plain spans inside the button, so they add no tab stops. They are in the button's name above. */}
                      <span className="fb-chips" aria-hidden="true">{chips.map((chip) => <span className={`fb-q-chip fb-q-chip-${chip.kind}`} key={chip.kind}>{chip.label}</span>)}</span>
                    </button>
                    {canEdit && selected && <FieldToolbar section={section} field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} onAction={onAction} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="fb-step-add">
          <button type="button" className="fb-add-button" data-fb-step-add={section.id} aria-label={`Add a question to step ${sectionIndex + 1}, ${section.title}`} onClick={() => onAddToStep(sectionIndex)}>
            <Plus size={20} aria-hidden="true" />
          </button>
          <span aria-hidden="true">Add a question</span>
        </div>
      )}
    </section>
  );
}

export function BuilderCanvas({ paletteDrag, onSelect, onAction, onAddToStep, onDropPalette }: {
  paletteDrag: PaletteEntry | null;
  onSelect: (fieldId: string, sectionIndex: number) => void;
  onAction: (action: ToolbarAction, sectionIndex: number, fieldIndex: number) => void;
  onAddToStep: (sectionIndex: number) => void;
  onDropPalette: (sectionIndex: number, index: number) => void;
}) {
  const { definition, canEdit, replaceDefinition, addSection } = useLoadedBuilder();
  return (
    <section className="fb-canvas" aria-label="The form, as people will see it">
      <div className="fb-form-head">
        <label className="fb-field-label" htmlFor="fb-form-title">Form title</label>
        <input id="fb-form-title" className="fb-title-input" autoComplete="off" name="builder-rb-field-1" disabled={!canEdit} value={definition.title} maxLength={120} onChange={(event) => replaceDefinition({ ...definition, title: event.target.value })} />
        <label className="fb-field-label" htmlFor="fb-form-description">Description</label>
        <textarea id="fb-form-description" autoComplete="off" name="builder-rb-note-2" disabled={!canEdit} value={definition.description} maxLength={500} rows={2} onChange={(event) => replaceDefinition({ ...definition, description: event.target.value })} />
      </div>
      {definition.sections.map((section, sectionIndex) => (
        <CanvasStep key={section.id} section={section} sectionIndex={sectionIndex} paletteDrag={paletteDrag} onSelect={onSelect} onAction={onAction} onAddToStep={onAddToStep} onDropPalette={onDropPalette} />
      ))}
      {canEdit && <button className="add-section-button" type="button" onClick={addSection}><Plus size={17} aria-hidden="true" /> Add another section</button>}
    </section>
  );
}
