"use client";

import type { ChangeEvent } from "react";
import { categoryOnPublicFilter, type CalendarCategoryChoices } from "@/modules/calendar/filter-groups";

/** The words after a category that sits on no public calendar button (#1611). */
export const notOnPublicFilterLabel = "Not on a public filter";
/** The value of the "Choose a category" row of a select that has no current category to show (the bulk bar). */
export const chooseCategoryValue = "__choose__";

/**
 * Staff pick a calendar category from a list (#1611): the six homepage tiles' categories, then Schools, Meetings and Office
 * closure, then "No category". A saved value that is not in the list is still shown and kept, marked "Not on a public
 * filter" when no public button lists it, so saving it unchanged is allowed. Works controlled (`value`) or not (`defaultValue`).
 */
export function CalendarCategorySelect({
  choices,
  defaultValue,
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  choices: CalendarCategoryChoices;
  defaultValue?: string;
  /** An accessible name when the select has no visible label around it. */
  label?: string;
  name?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  /** Adds a first "Choose a category" row, for a select that starts with nothing chosen. */
  placeholder?: string;
  value?: string;
}) {
  const raw = (value ?? defaultValue ?? "").trim();
  // A saved "PATHFINDERS" is the listed "Pathfinders": select that option instead of adding a duplicate.
  const listedOption = choices.options.find((option) => option.trim().toLowerCase() === raw.toLowerCase());
  const current = listedOption ?? raw;
  const extra = current && current !== chooseCategoryValue && !listedOption ? current : null;
  return (
    <select aria-label={label} defaultValue={value === undefined ? current : undefined} name={name} onChange={onChange} value={value === undefined ? undefined : current}>
      {placeholder && <option value={chooseCategoryValue}>{placeholder}</option>}
      {choices.options.map((option) => <option key={option} value={option}>{option}</option>)}
      {extra && <option value={extra}>{categoryOnPublicFilter(extra, choices.matched) ? extra : `${extra} (${notOnPublicFilterLabel})`}</option>}
      <option value="">No category</option>
    </select>
  );
}
