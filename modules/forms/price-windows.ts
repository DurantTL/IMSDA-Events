import { fieldPriceWindows, type FieldPriceWindow, type RegistrationFormField } from "@/modules/forms/definition";

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
