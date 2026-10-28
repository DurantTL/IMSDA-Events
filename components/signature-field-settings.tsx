"use client";

import { SIGNATURE_PLACEHOLDER_TEXT, SIGNATURE_TEXT_MAX, type RegistrationFormField, type SignatureConfig } from "@/modules/forms/definition";

/**
 * What changes on a field when its type changes to or from a signature (#1265): it starts with placeholder statement text
 * (a form cannot be published until it is reworded) and sheds the choices, price, credit, age range, date automation and
 * placeholder it cannot carry; leaving the type drops the statement.
 */
export function signatureTypePatch(field: RegistrationFormField, nextType: RegistrationFormField["type"]): Partial<RegistrationFormField> {
  if (nextType === "SIGNATURE") {
    return {
      signature: field.signature ?? { text: SIGNATURE_PLACEHOLDER_TEXT },
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
      placeholder: undefined,
    };
  }
  return field.signature ? { signature: undefined } : {};
}

/**
 * The builder's settings for a signature field: the exact statement the typed name signs. Nothing here is evidence; it only
 * decides what the form shows and what each signature will record.
 */
export function SignatureFieldSettings({
  field,
  canEdit,
  onChange,
}: {
  field: RegistrationFormField;
  canEdit: boolean;
  onChange: (config: SignatureConfig) => void;
}) {
  const config: SignatureConfig = field.signature ?? { text: "" };
  const textId = `signature_text_${field.id}`;
  return (
    <section className="field-full acknowledgment-settings" data-testid={`signature-settings-${field.key}`}>
      <div className="field-settings">
        <label className="field-full" htmlFor={textId}>
          Text to be signed
          <textarea
            id={textId}
            disabled={!canEdit}
            rows={5}
            maxLength={SIGNATURE_TEXT_MAX}
            value={config.text}
            onChange={(event) => onChange({ text: event.target.value })}
          />
          <small>{config.text.length.toLocaleString("en-US")} of {SIGNATURE_TEXT_MAX.toLocaleString("en-US")} characters. Recorded exactly as written for everyone who signs; a change takes a new form version.</small>
        </label>
      </div>
      <small>Each signature records the typed name, the text above, the date and time, and the network address. Staff with sensitive-data access can see the record on the registration; it is left out of exports.</small>
    </section>
  );
}
