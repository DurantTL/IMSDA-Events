// Field settings zone: the basic settings for one field (label, type, scope,
// required, flags), the choice and acknowledgment editors, and Advanced options.
// Today it opens inline under the field; this is the piece that becomes the
// right-hand settings panel.
import { AcknowledgmentFieldSettings, acknowledgmentTypePatch } from "@/components/acknowledgment-field-settings";
import { formFieldScopes, formFieldTypes, informationFormFieldTypes, directorySourceNoun, isChoiceFieldType, isDirectoryOptionSource, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { hasOfferedChoices, resolveFieldFlags, resolveFieldOffer, sectionTitleLookup } from "@/modules/forms/field-flags";
import { defaultTypeForNewChoiceField, singleChoiceTypeHint } from "@/modules/forms/choice-defaults";
import { creditPatchForKindChange, hasCredit } from "@/modules/forms/credit-fields";
import { pricingPatchForTypeChange } from "@/modules/forms/choice-type-pricing";
import { fieldTypeLabels } from "./builder-types";
import { autoFieldKey } from "./field-keys";
import { BuilderChoiceSettings } from "./builder-choice-settings";
import { BuilderFieldAdvanced } from "./builder-field-advanced";
import { informationFieldTypeAllowed } from "./information-mode";
import { useLoadedBuilder } from "./builder-context";
import { visibilityControllerKeys } from "@/modules/forms/visibility-rule";

type FieldTarget = { field: RegistrationFormField; sectionIndex: number; fieldIndex: number };

/** The patch for changing a field's scope: credits, conditions that would now cross scopes, and directory sources follow (#482). */
export function scopeChangePatch(field: RegistrationFormField, scope: RegistrationFormField["scope"], allFields: RegistrationFormField[]): Partial<RegistrationFormField> {
  // A show-when rule that reaches an attendee answer from a registration-level question cannot work, whichever member does it (#1072).
  const crossesScope = visibilityControllerKeys(field).some((key) => allFields.find((candidate) => candidate.key === key)?.scope === "ATTENDEE");
  return {
    scope,
    ...creditPatchForKindChange(field, { scope }),
    ...(scope === "REGISTRATION" && crossesScope ? { conditional: undefined, conditionalGroup: undefined } : { conditional: field.conditional, conditionalGroup: field.conditionalGroup }),
    optionalWhen: scope === "REGISTRATION" && allFields.find((candidate) => candidate.key === field.optionalWhen?.fieldKey)?.scope === "ATTENDEE" ? undefined : field.optionalWhen,
    // Directory sources apply only to the whole registration (#482).
    ...(scope === "ATTENDEE" && isDirectoryOptionSource(field.optionSource) ? { optionSource: undefined, options: [] } : {}),
  };
}

export function BuilderLabelInput({ field, sectionIndex, fieldIndex, inputId }: FieldTarget & { inputId?: string }) {
  const { canEdit, updateField, allFields, autoKeyFieldIds, setAutoKeyFieldIds } = useLoadedBuilder();
  // A new question's key (still the `new_field_N` placeholder) follows its label as it is typed, until the key is
  // edited by hand or the draft is saved: kept unique, and never a key other code treats specially. Clearing the
  // label keeps it following.
  const following = field.key.startsWith("new_field_") || autoKeyFieldIds.has(field.id);
  const nextKey = (label: string) => following ? autoFieldKey(label, allFields.filter((other) => other.id !== field.id).map((other) => other.key), field.type) : field.key;
  return <label>Label<input id={inputId} autoComplete="off" name="builder-rb-field-8" disabled={!canEdit} value={field.label} maxLength={120} onChange={(event) => { if (following) setAutoKeyFieldIds((current) => current.has(field.id) ? current : new Set(current).add(field.id)); updateField(sectionIndex, fieldIndex, { label: event.target.value, key: nextKey(event.target.value) }); }} /></label>;
}

export function BuilderRequiredToggle({ field, sectionIndex, fieldIndex, className = "required-toggle" }: FieldTarget & { className?: string }) {
  const { canEdit, updateField } = useLoadedBuilder();
  return <label className={className}><input disabled={!canEdit || field.type === "CALCULATED" || field.optionSource === "ATTENDEE_TYPES"} type="checkbox" checked={field.optionSource === "ATTENDEE_TYPES" ? true : field.required} onChange={(event) => updateField(sectionIndex, fieldIndex, { required: event.target.checked, optionalWhen: event.target.checked ? field.optionalWhen : undefined })} /> Required{field.optionSource === "ATTENDEE_TYPES" && <small> — the attendee-type selector is always required</small>}</label>;
}

/**
 * `inline` is the settings block under a field (phones, form templates). `panel` is the editor sidebar (#1132),
 * which shows label, required and scope itself, above this, so they are left out here and nothing is edited twice.
 */
export function BuilderFieldSettings({ section, field, sectionIndex, fieldIndex, variant = "inline" }: { section: RegistrationFormDefinition["sections"][number]; field: RegistrationFormField; sectionIndex: number; fieldIndex: number; variant?: "inline" | "panel" }) {
  const { definition, autoRadioFieldIds, setAutoRadioFieldIds, dismissedChoiceHintIds, setDismissedChoiceHintIds, allFields, policyVersions, canEdit, updateField, eventId, information } = useLoadedBuilder();
  return (
    <div className="field-editor-body">
              <div className="field-settings field-basic-settings">
                {variant === "inline" && <BuilderLabelInput field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} />}
                <label>Field type<select disabled={!canEdit} value={field.type} onChange={(event) => { const requestedType = event.target.value as RegistrationFormField["type"]; const type = defaultTypeForNewChoiceField(field.type, requestedType, field.options.length < 2 ? 2 : field.options.length); if (type !== requestedType) setAutoRadioFieldIds((current) => new Set(current).add(field.id)); const choiceType = isChoiceFieldType(type); const nextOptions = choiceType ? (field.options.length < 2 ? ["Option one", "Option two"] : field.options) : []; updateField(sectionIndex, fieldIndex, { type, required: type === "CALCULATED" ? false : field.required, options: nextOptions, optionDescriptions: choiceType && field.options.length >= 2 ? field.optionDescriptions : undefined, minSelections: type === "RANKED_CHOICE" ? field.minSelections ?? 2 : type === "MULTISELECT" ? field.minSelections ?? 1 : undefined, maxSelections: type === "MULTISELECT" || type === "RANKED_CHOICE" ? field.maxSelections ?? 2 : undefined, availabilityMode: choiceType ? field.availabilityMode : undefined, choiceLimits: choiceType ? field.choiceLimits : undefined, choicePricesCents: choiceType ? field.choicePricesCents : undefined, ...pricingPatchForTypeChange(field, type), ...creditPatchForKindChange(field, { type }), ...acknowledgmentTypePatch(field, type) }); }}>{(information ? informationFormFieldTypes : formFieldTypes).filter((type) => !information || informationFieldTypeAllowed(type)).map((type) => <option key={type} value={type}>{fieldTypeLabels[type]}</option>)}</select></label>
                {variant === "inline" && <label>Applies to<select disabled={!canEdit} value={field.scope} onChange={(event) => updateField(sectionIndex, fieldIndex, scopeChangePatch(field, event.target.value as RegistrationFormField["scope"], allFields))}>{formFieldScopes.filter((scope) => !information || scope === "REGISTRATION").map((scope) => <option key={scope} value={scope}>{scope === "ATTENDEE" ? "Each attendee" : "Registration"}</option>)}</select></label>}
                {variant === "inline" && <BuilderRequiredToggle field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} />}
                {!information && <div className="field-full field-visibility-flags" data-testid={`field-flags-${field.key}`}>
                  {(() => {
                    const paymentKey = definition.payment?.paymentMethodFieldKey;
                    // The same helper the answer filter uses, so the box shows what the filter will do.
                    const offer = resolveFieldOffer(field, { allFields, sectionTitleOf: sectionTitleLookup(definition.sections), paymentMethodFieldKey: paymentKey });
                    const linkedToSensitive = offer.linkedToSensitive && !resolveFieldFlags(field, { sectionTitle: section.title, paymentMethodFieldKey: paymentKey }).sensitive;
                    const canFilter = hasOfferedChoices(field) && field.key !== paymentKey;
                    return <>
                      {canFilter && <label className="required-toggle"><input disabled={!canEdit} type="checkbox" checked={offer.filterable} onChange={(event) => updateField(sectionIndex, fieldIndex, { filterable: event.target.checked })} /> Show as a filter</label>}
                      {canFilter && <small>Staff can find people by this answer on People &amp; registrations.</small>}
                      <label className="required-toggle"><input disabled={!canEdit || linkedToSensitive} type="checkbox" checked={offer.sensitive} onChange={(event) => updateField(sectionIndex, fieldIndex, { sensitive: event.target.checked })} /> Sensitive</label>
                      <small>{linkedToSensitive ? "Treated as sensitive because it is shown by, or controls, a sensitive question." : "Hidden from the check-in book, badges and reports; only staff with sensitive-data access can filter on it. Health, allergy and insurance questions start checked."}</small>
                    </>;
                  })()}
                </div>}
                {!information && (field.type === "SELECT" || field.type === "RADIO") && field.scope === "ATTENDEE" && <label className="required-toggle"><input disabled={!canEdit || (!field.optionSource && allFields.some((candidate) => candidate.optionSource === "ATTENDEE_TYPES"))} type="checkbox" checked={field.optionSource === "ATTENDEE_TYPES"} onChange={(event) => updateField(sectionIndex, fieldIndex, { optionSource: event.target.checked ? "ATTENDEE_TYPES" : undefined, optionLabels: event.target.checked ? field.optionLabels : undefined, required: event.target.checked ? true : field.required, availabilityMode: event.target.checked ? "NONE" : field.availabilityMode, choiceLimits: event.target.checked ? undefined : field.choiceLimits, choicePricesCents: event.target.checked ? undefined : field.choicePricesCents, latePricing: event.target.checked ? undefined : field.latePricing })} /> Source attendee types from event configuration</label>}
                {(field.type === "SELECT" || field.type === "RADIO") && field.scope === "REGISTRATION" && (["CLUBS_DIRECTORY", "CHURCHES_DIRECTORY", "SCHOOLS_DIRECTORY"] as const).map((source) => (
                  <label className="required-toggle" key={source}>
                    <input
                      disabled={!canEdit || (field.optionSource !== source && Boolean(field.optionSource))}
                      type="checkbox"
                      checked={field.optionSource === source}
                      onChange={(event) => updateField(sectionIndex, fieldIndex, {
                        optionSource: event.target.checked ? source : undefined,
                        optionLabels: undefined,
                        optionDescriptions: event.target.checked ? undefined : field.optionDescriptions,
                        availabilityMode: event.target.checked ? "NONE" : field.availabilityMode,
                        choiceLimits: event.target.checked ? undefined : field.choiceLimits,
                        choicePricesCents: event.target.checked ? undefined : field.choicePricesCents,
                        latePricing: event.target.checked ? undefined : field.latePricing,
                      })}
                    /> Source from the {directorySourceNoun(source)} directory
                  </label>
                ))}
              </div>
              {canEdit && field.type === "RADIO" && autoRadioFieldIds.has(field.id) && !field.optionSource && <div className="field-full inline-notice choice-type-hint" data-testid={`new-choice-default-${field.key}`}><span>New short-list choice fields start as radio cards.</span><button className="text-button" type="button" onClick={() => { setAutoRadioFieldIds((current) => { const next = new Set(current); next.delete(field.id); return next; }); setDismissedChoiceHintIds((current) => new Set(current).add(field.id)); updateField(sectionIndex, fieldIndex, { type: "SELECT", ...creditPatchForKindChange(field, { type: "SELECT" }) }); }}>Keep dropdown</button></div>}
              {canEdit && !dismissedChoiceHintIds.has(field.id) && (() => {
                const hint = singleChoiceTypeHint(field);
                if (!hint) return null;
                return <div className="field-full inline-notice choice-type-hint" data-testid={`choice-type-hint-${field.key}`}><span>{hint.message}</span><button className="text-button" type="button" onClick={() => updateField(sectionIndex, fieldIndex, { type: hint.suggestedType, ...creditPatchForKindChange(field, { type: hint.suggestedType }) })}>{hint.actionLabel}</button><button className="text-button" type="button" aria-label={`Dismiss the choice control suggestion for ${field.label}`} onClick={() => setDismissedChoiceHintIds((current) => new Set(current).add(field.id))}>Keep {fieldTypeLabels[field.type].toLowerCase()}</button></div>;
              })()}
      {isChoiceFieldType(field.type) && <BuilderChoiceSettings field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} />}
              {field.type === "ACKNOWLEDGMENT" && <AcknowledgmentFieldSettings field={field} canEdit={canEdit} policyVersions={policyVersions} allowPolicyVersion={Boolean(eventId)} onChange={(acknowledgment) => updateField(sectionIndex, fieldIndex, { acknowledgment })} />}
              {field.type === "CALCULATED" && !hasCredit(field) && <div className="field-settings field-registration-fee"><label className="field-full">Registration fee (standard price)<span className="money-input"><b>$</b><input id={`registration-fee-${field.id}`} aria-label={`Price for ${field.label}`} disabled={!canEdit} type="number" min={0} max={100000} step="0.01" placeholder="0.00" value={field.priceCents === undefined ? "" : field.priceCents / 100} onChange={(event) => updateField(sectionIndex, fieldIndex, { priceCents: event.target.value === "" ? undefined : Math.round(Number(event.target.value) * 100), latePricing: event.target.value === "" ? undefined : field.latePricing })} /></span></label></div>}
      <BuilderFieldAdvanced field={field} sectionIndex={sectionIndex} fieldIndex={fieldIndex} variant={variant} />
    </div>
  );
}
