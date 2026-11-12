// The settings for an Information block (#284): the heading is the question's label, so this edits the text and the optional
// highlighted note. Both are written in the site's safe formatting (bold, italic, links, lists); there is no image or video.
import { INFORMATION_NOTE_MAX, INFORMATION_TEXT_MAX, type InformationConfig, type RegistrationFormField } from "@/modules/forms/definition";
import { useLoadedBuilder } from "./builder-context";

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
  // An empty note is dropped, not stored as an empty string.
  const change = (patch: Partial<InformationConfig>) => {
    const next = { ...config, ...patch };
    updateField(sectionIndex, fieldIndex, { information: { text: next.text, ...(next.note ? { note: next.note } : {}) } });
  };
  return (
    <section className="field-full" data-testid={`information-settings-${field.key}`}>
      <div className="field-settings">
        <label className="field-full" htmlFor={textId}>
          Text
          <textarea id={textId} disabled={!canEdit} rows={5} maxLength={INFORMATION_TEXT_MAX} value={config.text} onChange={(event) => change({ text: event.target.value })} />
          <small>{config.text.length.toLocaleString("en-US")} of {INFORMATION_TEXT_MAX.toLocaleString("en-US")} characters. You can use **bold**, *italic*, [links](https://example.org) and lists.</small>
        </label>
        <label className="field-full" htmlFor={noteId}>
          Highlighted note (optional)
          <textarea id={noteId} disabled={!canEdit} rows={3} maxLength={INFORMATION_NOTE_MAX} value={config.note ?? ""} onChange={(event) => change({ note: event.target.value })} />
          <small>Shown in a highlighted box under the text, for the one thing people must not miss.</small>
        </label>
      </div>
      <small>An information block is only shown. It is never answered, priced, counted or exported, and it follows the same show-when rules as a question.</small>
    </section>
  );
}
