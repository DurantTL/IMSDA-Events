import { fieldPriceWindows, hasAttendeeTypePrices, type FieldPriceWindow, type RegistrationFormField } from "@/modules/forms/definition";

/**
 * Editing helpers for a field's price windows (#1509), shared by the form
 * builder and its tests. One window is stored as `latePricing` (the shape every
 * form saved before windows existed uses); two or three as `pricingWindows`.
 * `priceWindowsPatch` is the only place that picks the storage shape.
 */

export const MAX_PRICE_WINDOWS = 3;

type WindowFields = Pick<RegistrationFormField, "latePricing" | "pricingWindows" | "basePricingLabel">;

const DEFAULT_WINDOW_LABELS = ["Late registration pricing", "Later registration pricing", "Last registration pricing"];

/** The patch that stores `windows` (and the label for the starting price) on a field, in the canonical shape. */
export function priceWindowsPatch(windows: FieldPriceWindow[], basePricingLabel: string | undefined): WindowFields {
  const baseLabel = windows.length > 0 && basePricingLabel !== undefined && basePricingLabel.trim() !== "" ? basePricingLabel : undefined;
  return {
    latePricing: windows.length === 1 ? windows[0] : undefined,
    pricingWindows: windows.length >= 2 ? windows.slice(0, MAX_PRICE_WINDOWS) : undefined,
    basePricingLabel: baseLabel,
  };
}

/** The calendar date after `date` (YYYY-MM-DD), in UTC so no timezone moves it. */
export function dayAfter(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

/**
 * The window "Add window" appends: it starts the day after the last window
 * (or on `today` for the first), and begins at the price in force just before
 * it so adding a window changes nothing until its price is edited.
 */
export function nextPriceWindow(field: Pick<RegistrationFormField, "priceCents" | "latePricing" | "pricingWindows">, today: string, choiceMode: boolean): FieldPriceWindow {
  const windows = fieldPriceWindows(field);
  const last = windows.at(-1);
  const startsOn = last ? dayAfter(last.startsOn) : today;
  const label = DEFAULT_WINDOW_LABELS[Math.min(windows.length, DEFAULT_WINDOW_LABELS.length - 1)]!;
  if (choiceMode) return { startsOn, label };
  const priceCents = [...windows].reverse().find((window) => window.priceCents !== undefined)?.priceCents ?? field.priceCents;
  return { startsOn, label, ...(priceCents !== undefined ? { priceCents } : {}) };
}

/** `windows` with one window replaced by `patch`. */
export function updatePriceWindow(windows: FieldPriceWindow[], index: number, patch: Partial<FieldPriceWindow>): FieldPriceWindow[] {
  return windows.map((window, windowIndex) => windowIndex === index ? { ...window, ...patch } : window);
}

/** The windows with each choice not in `options` dropped from every window's choice-price map (a rename or removal of choices). */
export function pruneWindowChoicePrices(windows: FieldPriceWindow[], options: readonly string[]): FieldPriceWindow[] {
  return windows.map((window) => {
    const kept = Object.fromEntries(Object.entries(window.choicePricesCents ?? {}).filter(([choice]) => options.includes(choice)));
    return { ...window, choicePricesCents: Object.keys(kept).length > 0 ? kept : undefined };
  });
}

type TypePriceFields = Pick<RegistrationFormField, "attendeeTypePricesCents" | "latePricing" | "pricingWindows" | "basePricingLabel">;

/**
 * "Prices by attendee type" (#1509) turned off, or no longer allowed (the question moved to the whole registration):
 * the starting map and every window's map are dropped. Empty for a field that never used it, so nothing else changes.
 */
export function clearAttendeeTypePricesPatch(field: TypePriceFields): Partial<TypePriceFields> {
  if (!hasAttendeeTypePrices(field)) return {};
  const windows = fieldPriceWindows(field).map((window) => ({ ...window, attendeeTypePricesCents: undefined }));
  return { attendeeTypePricesCents: undefined, ...priceWindowsPatch(windows, field.basePricingLabel) };
}

/**
 * The patch that sets (or, with `cents` undefined, clears) one attendee type's price in the starting prices
 * (`windowIndex` null) or in one window. An emptied map stays `{}` at the start, so the option stays on, and goes
 * away in a window.
 */
export function setAttendeeTypePricePatch(field: TypePriceFields, windowIndex: number | null, code: string, cents: number | undefined): Partial<TypePriceFields> {
  const apply = (map: Record<string, number> | undefined) => {
    const next = { ...(map ?? {}) };
    if (cents === undefined) delete next[code]; else next[code] = cents;
    return next;
  };
  if (windowIndex === null) return { attendeeTypePricesCents: apply(field.attendeeTypePricesCents) };
  const windows = fieldPriceWindows(field);
  const next = apply(windows[windowIndex]?.attendeeTypePricesCents);
  return priceWindowsPatch(updatePriceWindow(windows, windowIndex, { attendeeTypePricesCents: Object.keys(next).length > 0 ? next : undefined }), field.basePricingLabel);
}
