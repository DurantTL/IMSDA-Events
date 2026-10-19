"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";
import { pushOpenDialog, removeOpenDialog } from "@/components/use-accessible-dialog";
import { makeBackgroundInert, usePhoneViewport } from "@/components/use-attendee-sheet";
import {
  filterSearchableChoices,
  nounFromLabel,
  PICKER_SEARCH_ATTRIBUTES,
  pickerViewportBox,
  resultCountLabel,
  trappedTabIndex,
} from "@/modules/forms/searchable-choice";

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  id: string;
  value: string;
  options: readonly SearchableSelectOption[];
  required?: boolean;
  placeholder?: string;
  describedBy?: string;
  invalid?: boolean;
  /** On a phone, open the list as a full-screen picker instead of an inline list (#1046). */
  sheet?: boolean;
  /** Names the field in the phone picker's heading, for example "Pathfinder club". */
  label?: string;
  /** What the options are called in the announced result count ("12 clubs"). */
  noun?: { singular: string; plural: string };
  onChange: (value: string) => void;
};

export function SearchableSelect(props: SearchableSelectProps) {
  const phone = usePhoneViewport();
  return props.sheet && phone ? <PhonePicker {...props} /> : <InlineCombobox {...props} />;
}

/**
 * Phone: the field is a button-like trigger; tapping it opens a full-screen
 * dialog (search box, Close, list). The dialog follows the visual viewport, so
 * the list ends at the top of the on-screen keyboard and nothing behind shows.
 */
function PhonePicker({
  id,
  value,
  options,
  required = false,
  placeholder = "Search choices…",
  describedBy,
  invalid = false,
  label,
  noun,
  onChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const listId = `${id}_choices`;
  const headingId = `${id}_picker_heading`;
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? value;
  const filteredOptions = useMemo(() => filterSearchableChoices(options, query), [options, query]);
  const countText = resultCountLabel(filteredOptions.length, noun ?? nounFromLabel(label));

  function openPicker() {
    // The search always starts empty, even when a value is already chosen.
    setQuery("");
    setActiveIndex(-1);
    setOpen(true);
  }

  function choose(nextValue: string) {
    const option = options.find((candidate) => candidate.value === nextValue);
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  // Return focus to the field when the picker closes (Safari does not focus a tapped button, so do it here).
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  // While open: the page behind is inert and does not scroll, the search box has focus,
  // and the dialog covers exactly the visual viewport (iOS shrinks it for the keyboard).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const hadSheetClass = document.documentElement.classList.contains("has-attendee-sheet");
    const restoreInert = makeBackgroundInert(dialog);
    // Register as the top dialog so an attendee sheet's own Tab trap steps aside.
    const dialogToken = pushOpenDialog();
    searchRef.current?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    function fit() {
      const box = pickerViewportBox(viewport);
      if (!dialog || !box) return;
      dialog.style.setProperty("--picker-top", `${box.top}px`);
      dialog.style.setProperty("--picker-height", `${box.height}px`);
    }
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      removeOpenDialog(dialogToken);
      restoreInert();
      // An attendee sheet under this picker still needs the page locked.
      if (hadSheetClass) document.documentElement.classList.add("has-attendee-sheet");
    };
  }, [open]);

  // Keep the arrowed option in view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${listId}_${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      // The picker takes the Escape; it must not also close an attendee sheet around it.
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const stops = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("input, button:not([disabled]):not([role='option'])"),
    );
    const next = trappedTabIndex(stops.indexOf(document.activeElement as HTMLElement), stops.length, event.shiftKey);
    if (next !== null) {
      event.preventDefault();
      stops[next]?.focus();
    }
  }

  return (
    <div className="searchable-select is-phone-trigger">
      <div className="searchable-select-control">
        <button
          id={id}
          ref={triggerRef}
          type="button"
          className="searchable-select-trigger"
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={listId}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          data-required={required || undefined}
          aria-describedby={describedBy}
          onClick={openPicker}
        >
          <span className={selected || value ? undefined : "is-placeholder"}>
            {selected || value ? selectedLabel : placeholder}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {value ? (
          <button type="button" className="searchable-select-clear" aria-label={`Clear ${label ?? "selection"}`}
            onClick={() => {
              onChange("");
              triggerRef.current?.focus({ preventScroll: true });
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open && createPortal(
        <div
          className="searchable-select-picker"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          onKeyDown={onDialogKeyDown}
        >
          <div className="searchable-select-picker-bar">
            <h2 id={headingId}>{label ?? "Choose an option"}</h2>
            <button type="button" className="searchable-select-picker-close" onClick={() => setOpen(false)}>
              <X size={18} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
          <div className="searchable-select-picker-search">
            <Search size={16} aria-hidden="true" />
            <input
              {...PICKER_SEARCH_ATTRIBUTES}
              ref={searchRef}
              type="search"
              role="combobox"
              value={query}
              placeholder="Search…"
              aria-autocomplete="list"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={
                activeIndex >= 0 && filteredOptions[activeIndex] ? `${listId}_${activeIndex}` : undefined
              }
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.min(index + 1, Math.max(0, filteredOptions.length - 1)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(0, index - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const option = filteredOptions[activeIndex];
                  if (option) choose(option.value);
                }
              }}
            />
          </div>
          <p className="searchable-select-picker-count" role="status" aria-live="polite">{countText}</p>
          <div className="searchable-select-options" id={listId} role="listbox" aria-labelledby={headingId}>
            {filteredOptions.length === 0 ? (
              <p>No matching choices. Try another search.</p>
            ) : filteredOptions.map((option, index) => (
              <button
                id={`${listId}_${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                className={index === activeIndex ? "is-active" : ""}
                disabled={option.disabled}
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {option.value === value && <small>Selected</small>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function InlineCombobox({
  id,
  value,
  options,
  required = false,
  placeholder = "Search choices…",
  describedBy,
  invalid = false,
  onChange,
}: SearchableSelectProps) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listId = `${id}_choices`;
  const selectedLabel = options.find((option) => option.value === value)?.label
    ?? value;
  const filteredOptions = useMemo(
    () => filterSearchableChoices(options, query ?? ""),
    [options, query],
  );

  function choose(nextValue: string) {
    const option = options.find((candidate) => candidate.value === nextValue);
    if (!option || option.disabled) return;
    onChange(option.value);
    setQuery(null);
    setOpen(false);
  }

  function close() {
    setOpen(false);
    setQuery(null);
  }

  return (
    <div
      className="searchable-select"
      ref={wrapperRef}
      onBlur={(event) => {
        if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
          close();
        }
      }}
    >
      <div className="searchable-select-control">
        <Search size={16} aria-hidden="true" />
        <input
          id={id}
          type="search"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          required={required}
          value={query ?? selectedLabel}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && activeIndex >= 0 && filteredOptions[activeIndex]
              ? `${listId}_${activeIndex}`
              : undefined
          }
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onFocus={(event) => {
            setOpen(true);
            setActiveIndex(-1);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(true);
            setActiveIndex(-1);
            if (value && nextQuery !== value) onChange("");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(
                index + 1,
                Math.max(0, filteredOptions.length - 1),
              ));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              const option = filteredOptions[activeIndex];
              if (option) choose(option.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              // An open list takes the Escape; it must not also close an attendee sheet around it.
              if (open) event.stopPropagation();
              close();
            }
          }}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </div>
      {open && (
        <div className="searchable-select-options" id={listId} role="listbox">
          {filteredOptions.length === 0 ? (
            <p>No matching choices. Try another search.</p>
          ) : filteredOptions.map((option, index) => (
            <button
              id={`${listId}_${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={index === activeIndex ? "is-active" : ""}
              disabled={option.disabled}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value && <small>Selected</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
