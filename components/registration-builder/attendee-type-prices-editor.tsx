"use client";

// Prices by attendee type (#1509): charge each kind of attendee (Adult, Child, ...) its own price for a
// per-person question. Off by default; a blank box means "the usual price for that date", so turning the
// option on changes nothing until a price is typed. The prices live on the question (starting price) and on
// each price window, and the engine merges them like choice prices (`resolveFieldPrices`).
import { attendeeTypePricesRefusal, fieldPriceWindows, hasAttendeeTypePrices, type RegistrationFormField } from "@/modules/forms/definition";
import { clearAttendeeTypePricesPatch, setAttendeeTypePricePatch } from "@/modules/forms/price-windows";
import { useLoadedBuilder } from "./builder-context";
import styles from "./attendee-type-prices-editor.module.css";

type EditorTarget = { field: RegistrationFormField; sectionIndex: number; fieldIndex: number };

/** Whether the question can offer the option: a per-person, non-choice priced question (the form's own check needs an attendee-type question too). */
export function canPriceByAttendeeType(field: RegistrationFormField) {
  return attendeeTypePricesRefusal(field) === undefined;
}

export function AttendeeTypePricesEditor({ field, sectionIndex, fieldIndex }: EditorTarget) {
  const { canEdit, updateField, allFields } = useLoadedBuilder();
  const selector = allFields.find((candidate) => candidate.optionSource === "ATTENDEE_TYPES");
  const on = hasAttendeeTypePrices(field);
  if (!canPriceByAttendeeType(field) || (!selector && !on)) return null;

  const windows = fieldPriceWindows(field);
  const configured = selector?.options ?? [];
  const stored = new Set([field.attendeeTypePricesCents, ...windows.map((window) => window.attendeeTypePricesCents)].flatMap((map) => Object.keys(map ?? {})));
  const retired = [...stored].filter((code) => !configured.includes(code));

  const money = (cents: number | undefined) => (cents === undefined ? "" : cents / 100);
  const set = (windowIndex: number | null, code: string, value: string) => updateField(sectionIndex, fieldIndex, setAttendeeTypePricePatch(field, windowIndex, code, value === "" ? undefined : Math.round(Number(value) * 100)));

  return (
    <div className={`field-full ${styles.editor}`} role="group" aria-label={`Prices by attendee type for ${field.label}`}>
      <label className={styles.toggle}>
        <input
          disabled={!canEdit || !selector}
          type="checkbox"
          checked={on}
          onChange={(event) => updateField(sectionIndex, fieldIndex, event.target.checked ? { attendeeTypePricesCents: {} } : clearAttendeeTypePricesPatch(field))}
        />
        Charge a different price for each type of attendee
      </label>
      {!selector && <small className={styles.help}>This form needs an attendee-type question first.</small>}
      {on && (
        <>
          <p className={styles.help}>
            Leave a box blank to charge the usual price. A price for a type carries into later price windows until a window sets a new one for that type.
          </p>
          {configured.length === 0 && <small className={styles.help}>No active attendee types are set up for this event yet.</small>}
          {[...configured, ...retired].map((code) => {
            const name = selector?.optionLabels?.[code] ?? code;
            const isRetired = !configured.includes(code);
            return (
              <fieldset className={styles.typeRow} key={code}>
                <legend>{isRetired ? `${name} (no longer an active type)` : name}</legend>
                <label>
                  {field.basePricingLabel || "Standard price"}
                  <span className="money-input"><b>$</b>
                    <input aria-label={`${name} price for ${field.label}`} disabled={!canEdit} type="number" min={0} max={100000} step="0.01" placeholder="Usual price" value={money(field.attendeeTypePricesCents?.[code])} onChange={(event) => set(null, code, event.target.value)} />
                  </span>
                </label>
                {windows.map((window, index) => (
                  <label key={index}>
                    {window.label}
                    <span className="money-input"><b>$</b>
                      <input aria-label={`${name} price in price window ${index + 1} for ${field.label}`} disabled={!canEdit} type="number" min={0} max={100000} step="0.01" placeholder="Usual price" value={money(window.attendeeTypePricesCents?.[code])} onChange={(event) => set(index, code, event.target.value)} />
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </>
      )}
    </div>
  );
}
