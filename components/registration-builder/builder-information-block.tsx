// The settings for an Information block (#284): the heading is the question's label, so this edits the text and the optional
// highlighted note. Both are written in the site's safe formatting (bold, italic, links, lists); there is no image or video.
import { INFORMATION_NOTE_MAX, INFORMATION_TEXT_MAX, type InformationConfig, type RegistrationFormField } from "@/modules/forms/definition";
import { useLoadedBuilder } from "./builder-context";
import styles from "./builder-information-block.module.css";

type FieldTarget = { field: RegistrationFormField; sectionIndex: number; fieldIndex: number };

/** The patch when a field's type changes to or from an Information block: it starts with text, and leaving the type drops it. */
export function informationTypePatch(field: RegistrationFormField, nextType: RegistrationFormField["type"], placeholderText: string): Partial<RegistrationFormField> {
  if (nextType === "INFORMATION") {
    return {
      information: field.information ?? { text: placeholderText },
      required: false,
      scope: "REGISTRATION",
      options: [],
      optionSource: undefined,
      optionLabels: undefined,
      optionDescriptions: undefined,
      minSelections: undefined,
      maxSelections: undefined,
      availabilityMode: undefined,
      choiceLimits: undefined,
      priceCents: undefined,
      choicePricesCents: undefined,
      creditCentsPerUnit: undefined,
      capUnitsAtAttendeeCount: undefined,
      latePricing: undefined,
      pricingWindows: undefined,
      basePricingLabel: undefined,
      ageBounds: undefined,
      autoDate: undefined,
      optionalWhen: undefined,
      placeholder: undefined,
      acknowledgment: undefined,
      signature: undefined,
    };
  }
  return field.information ? { information: undefined } : {};
}

export function BuilderInformationSettings({ field, sectionIndex, fieldIndex }: FieldTarget) {
  const { canEdit, updateField } = useLoadedBuilder();
  const config: InformationConfig = field.information ?? { text: "" };
  const textId = `information_text_${field.id}`;
  const noteId = `information_note_${field.id}`;
  const textHelpId = `${textId}_help`;
  const noteHelpId = `${noteId}_help`;
  // An empty or all-space note is dropped, not stored (the schema trims it and needs a character).
  const change = (patch: Partial<InformationConfig>) => {
    const next = { ...config, ...patch };
    const note = next.note?.trim();
    updateField(sectionIndex, fieldIndex, { information: { text: next.text, ...(note ? { note: next.note } : {}) } });
  };
  return (
    <section className={`field-full ${styles.settings}`} data-testid={`information-settings-${field.key}`}>
      <label htmlFor={textId}>Text</label>
      <textarea id={textId} name="builder-information-text" autoComplete="off" disabled={!canEdit} rows={5} maxLength={INFORMATION_TEXT_MAX} value={config.text} aria-describedby={textHelpId} onChange={(event) => change({ text: event.target.value })} />
      <p className={`field-help ${styles.help}`} id={textHelpId}>{config.text.length.toLocaleString("en-US")} of {INFORMATION_TEXT_MAX.toLocaleString("en-US")} characters. You can use **bold**, *italic*, [links](https://example.org) and lists.</p>
      <label htmlFor={noteId}>Highlighted note (optional)</label>
      <textarea id={noteId} name="builder-information-note" autoComplete="off" disabled={!canEdit} rows={3} maxLength={INFORMATION_NOTE_MAX} value={config.note ?? ""} aria-describedby={noteHelpId} onChange={(event) => change({ note: event.target.value })} />
      <p className={`field-help ${styles.help}`} id={noteHelpId}>Shown in a highlighted box under the text, for the one thing people must not miss.</p>
      <p className={`field-help ${styles.help}`}>An information block is only shown. It is never answered, priced, counted or exported, and it follows the same show-when rules as a question.</p>
    </section>
  );
}
