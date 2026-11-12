"use client";

// Price windows (#1509): the editor for a field's dated prices. Staff can set an
// optional label for the starting price and up to three dated windows, each with a
// label and a price (or per-choice prices, set in the choice table). One window is
// saved as `latePricing`, so a form with a single late price is stored exactly as
// it was before; two or three are saved as `pricingWindows`.
import type { ReactNode } from "react";
import { fieldPriceWindows, localCalendarDate, type FieldPriceWindow, type RegistrationFormField } from "@/modules/forms/definition";
import { MAX_PRICE_WINDOWS, nextPriceWindow, priceWindowsPatch, updatePriceWindow } from "@/modules/forms/price-windows";
import { useLoadedBuilder } from "./builder-context";
import styles from "./price-windows-editor.module.css";

type EditorTarget = { field: RegistrationFormField; sectionIndex: number; fieldIndex: number };

/** The label for window `index`'s inputs: the single window keeps the "Late pricing" wording, several are numbered. */
function windowNames(field: RegistrationFormField, index: number, count: number) {
  return count === 1
    ? { starts: `Late pricing starts for ${field.label}`, price: `Late price for ${field.label}`, label: `Late pricing label for ${field.label}` }
    : { starts: `Price window ${index + 1} starts for ${field.label}`, price: `Price window ${index + 1} price for ${field.label}`, label: `Price window ${index + 1} label for ${field.label}` };
}

export function PriceWindowsEditor({ field, sectionIndex, fieldIndex, mode }: EditorTarget & { mode: "price" | "choice" }) {
  const { canEdit, updateField } = useLoadedBuilder();
  const windows = fieldPriceWindows(field);
  const choiceMode = mode === "choice";
  const save = (nextWindows: FieldPriceWindow[], basePricingLabel = field.basePricingLabel) => updateField(sectionIndex, fieldIndex, priceWindowsPatch(nextWindows, basePricingLabel));
  const addWindow = () => save([...windows, nextPriceWindow(field, localCalendarDate(), choiceMode)]);
  const hasChoicePrice = field.priceCents !== undefined || Boolean(field.choicePricesCents) || windows.some((window) => Object.keys(window.choicePricesCents ?? {}).length > 0);

  return (
    <div className={`field-full ${styles.editor}`} role="group" aria-label={`Price windows for ${field.label}`}>
      <label className={styles.toggle}>
        <input
          disabled={!canEdit || (!choiceMode && field.priceCents === undefined)}
          type="checkbox"
          checked={windows.length > 0}
          onChange={(event) => save(event.target.checked ? [nextPriceWindow(field, localCalendarDate(), choiceMode)] : [])}
        />
        {choiceMode ? "Use different prices starting on a date" : "Use a different price starting on a date"}
      </label>
      {!choiceMode && field.priceCents === undefined && <small className={styles.help}>Set the standard price first.</small>}
      {windows.length > 0 && (
        <>
          <p className={styles.help}>Each window charges from its start date until the next window starts. Up to {MAX_PRICE_WINDOWS} windows, for example early, regular and late.</p>
          <label className={styles.field}>
            Label for the starting price (optional)
            <input
              autoComplete="off"
              name="builder-pw-base"
              aria-label={`Starting price label for ${field.label}`}
              disabled={!canEdit}
              value={field.basePricingLabel ?? ""}
              maxLength={80}
              placeholder="Early registration pricing"
              onChange={(event) => save(windows, event.target.value)}
            />
          </label>
          {windows.map((window, index) => {
            const names = windowNames(field, index, windows.length);
            const earlierPrice = [...windows.slice(0, index)].reverse().find((earlier) => earlier.priceCents !== undefined)?.priceCents ?? field.priceCents ?? 0;
            return (
              <fieldset className={styles.window} key={index}>
                <legend>{windows.length === 1 ? "Late pricing" : `Window ${index + 1}`}</legend>
                <label className={styles.field}>
                  Starts
                  <input aria-label={names.starts} disabled={!canEdit} type="date" value={window.startsOn} onChange={(event) => save(updatePriceWindow(windows, index, { startsOn: event.target.value }))} />
                </label>
                <label className={styles.field}>
                  Pricing label
                  <input autoComplete="off" name="builder-pw-label" aria-label={names.label} disabled={!canEdit} value={window.label} maxLength={80} onChange={(event) => save(updatePriceWindow(windows, index, { label: event.target.value }))} />
                </label>
                {!choiceMode && (
                  <label className={styles.field}>
                    Price
                    <span className="money-input"><b>$</b>
                      <input aria-label={names.price} disabled={!canEdit} type="number" min={0} max={100000} step="0.01" value={(window.priceCents ?? earlierPrice) / 100} onChange={(event) => save(updatePriceWindow(windows, index, { priceCents: Math.round(Number(event.target.value) * 100) }))} />
                    </span>
                  </label>
                )}
                <div className={styles.actions}>
                  <button className="text-button" type="button" disabled={!canEdit} aria-label={`Remove price window ${index + 1} for ${field.label}`} onClick={() => save(windows.filter((_, windowIndex) => windowIndex !== index))}>Remove</button>
                </div>
              </fieldset>
            );
          })}
          {choiceMode && !hasChoicePrice && <small className={styles.warning} role="status">Enter at least one choice price below before saving; late pricing needs a price to change.</small>}
          {windows.length < MAX_PRICE_WINDOWS && (
            <div className={styles.actions}>
              <button className="text-button" type="button" disabled={!canEdit} aria-label={`Add a price window for ${field.label}`} onClick={addWindow}>Add window</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One choice's prices when a field has two or three windows: the standard price
 * and one price per window, each labelled. A blank window price keeps the
 * latest earlier price, exactly as the engine charges it.
 */
export function WindowedChoiceRow({ field, sectionIndex, fieldIndex, option, limitInput }: EditorTarget & { option: string; limitInput: ReactNode }) {
  const { canEdit, updateField } = useLoadedBuilder();
  const windows = fieldPriceWindows(field);
  const setBase = (value: string) => {
    const choicePricesCents = { ...(field.choicePricesCents ?? {}) };
    if (value !== "") choicePricesCents[option] = Math.round(Number(value) * 100); else delete choicePricesCents[option];
    updateField(sectionIndex, fieldIndex, { choicePricesCents: Object.keys(choicePricesCents).length > 0 ? choicePricesCents : undefined });
  };
  const setWindow = (index: number, value: string) => {
    const choicePricesCents = { ...(windows[index]?.choicePricesCents ?? {}) };
    if (value !== "") choicePricesCents[option] = Math.round(Number(value) * 100); else delete choicePricesCents[option];
    updateField(sectionIndex, fieldIndex, priceWindowsPatch(updatePriceWindow(windows, index, { choicePricesCents: Object.keys(choicePricesCents).length > 0 ? choicePricesCents : undefined }), field.basePricingLabel));
  };
  return (
    <div className={styles.choiceRow}>
      <span className={styles.choiceName}>{option}</span>
      <div className={styles.choicePrices}>
        {limitInput}
        <label>
          {field.basePricingLabel || "Standard"}
          <span className="money-input"><b>$</b>
            <input aria-label={`Price for ${option}`} disabled={!canEdit} type="number" min={0} max={100000} step="0.01" placeholder="0.00" value={field.choicePricesCents?.[option] === undefined ? "" : field.choicePricesCents[option] / 100} onChange={(event) => setBase(event.target.value)} />
          </span>
        </label>
        {windows.map((window, index) => (
          <label key={index}>
            {window.label}
            <span className="money-input"><b>$</b>
              <input aria-label={`Price window ${index + 1} price for ${option}`} disabled={!canEdit} type="number" min={0} max={100000} step="0.01" placeholder="Same" value={window.choicePricesCents?.[option] === undefined ? "" : window.choicePricesCents[option] / 100} onChange={(event) => setWindow(index, event.target.value)} />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
