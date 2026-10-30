"use client";

import { X } from "lucide-react";

/**
 * The one clear button for a `.search-field` box (#1347): a 44px-wide tap area, drawn only while there is text. It hands
 * focus back to the box's input after `onClear` so typing can start again at once.
 */
export function SearchClearButton({ visible, onClear, label = "Clear search" }: { visible: boolean; onClear: () => void; label?: string }) {
  if (!visible) return null;
  return (
    <button
      aria-label={label}
      className="search-field-clear"
      onClick={(event) => {
        const box = event.currentTarget.closest(".search-field");
        onClear();
        box?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
      }}
      // Keeps focus where it is, so a combobox's blur does not close its list before the click lands.
      onMouseDown={(event) => event.preventDefault()}
      type="button"
    >
      <X aria-hidden="true" size={16} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Mousedown on a `<div>` or `<span>` search box (its icon or padding) focuses the input, as a label would. */
export function focusSearchInput(event: React.MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (target.closest("input, button")) return;
  event.preventDefault();
  event.currentTarget.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
}
