"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { visibleBottomBarTop } from "@/components/fixed-bottom-bars";
import { comboboxKeyResult, comboboxPopoverPlacement, filterHonorsByWordPrefix, type ComboboxPlacement } from "@/modules/honors/honor-search";

export type HonorComboboxOption = { id: string; name: string };

/** The visible box the list may use: the window, narrowed by the keyboard and by any scrolling or clipping parent (a dialog). */
function visibleBounds(from: HTMLElement) {
  const viewport = window.visualViewport;
  let top = viewport ? viewport.offsetTop : 0;
  let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const barTop = visibleBottomBarTop();
  if (barTop !== null) bottom = Math.min(bottom, barTop);
  for (let node = from.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (window.getComputedStyle(node).overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

/**
 * The type-to-search honor picker (#819), used wherever a honor is chosen (and, with `noun`, a class on the class tracking page, #827). An
 * ARIA 1.2 editable combobox with a listbox popup: typing filters by the start
 * of any word in the name; Arrow Up/Down move through the matches, Enter
 * chooses, Escape closes the list (and never closes a dialog around it).
 * `allLabel` adds an "All honors" choice with the empty value, for filters.
 * `name` posts the chosen id with a plain form; `onChange` reports it.
 *
 * The list is a floating popover anchored under the input (CSS `position:
 * absolute`), so opening it never moves anything else on the page. It is as wide
 * as the input, scrolls inside itself, and flips above the input (and shrinks)
 * when there is not room below inside the window or the dialog around it.
 */
export function HonorCombobox({
  options,
  value,
  onChange,
  label,
  allLabel,
  name,
  required = false,
  describedBy,
  placeholder,
  noun = "honor",
  nounPlural = `${noun}s`,
}: {
  options: readonly HonorComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  allLabel?: string;
  name?: string;
  required?: boolean;
  describedBy?: string;
  placeholder?: string;
  /** What is being chosen, in the words the page uses. Honors by default; the class tracking page passes "class" (#827). */
  noun?: string;
  nounPlural?: string;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const selectedName = value ? options.find((option) => option.id === value)?.name ?? "" : (allLabel ?? "");
  const [open, setOpen] = useState(false);
  // While the list is open the field shows what was typed; closed, it shows the choice.
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // `lift` is how far above the wrapper's bottom edge the list sits when it flips above the field.
  const [placement, setPlacement] = useState<ComboboxPlacement & { lift: number }>({ side: "below", maxHeight: 224, lift: 48 });

  const query = typed ?? "";
  const matches = useMemo(() => filterHonorsByWordPrefix(options, query), [options, query]);
  const choices: HonorComboboxOption[] = useMemo(
    () => (allLabel !== undefined && query.trim() === "" ? [{ id: "", name: allLabel }, ...matches] : [...matches]),
    [allLabel, matches, query],
  );
  const safeActive = Math.min(active, Math.max(choices.length - 1, 0));

  // Place the floating list each time it opens or its matches change, and again if the window,
  // the on-screen keyboard or any scrolling box moves the field.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const input = inputRef.current;
      const list = listRef.current;
      if (!input || !list) return;
      const rect = input.getBoundingClientRect();
      const bounds = visibleBounds(input);
      const next = {
        ...comboboxPopoverPlacement({
          anchorTop: rect.top,
          anchorBottom: rect.bottom,
          boundsTop: bounds.top,
          boundsBottom: bounds.bottom,
          contentHeight: list.scrollHeight,
        }),
        lift: input.offsetHeight + 4,
      };
      setPlacement((current) => (current.side === next.side && current.maxHeight === next.maxHeight && current.lift === next.lift ? current : next));
    }
    // Re-measure at most once per frame, and not for the list's own scrolling.
    let pending = 0;
    function schedule(event?: Event) {
      if (event && event.target === listRef.current) return;
      if (pending === 0) pending = window.requestAnimationFrame(() => { pending = 0; place(); });
    }
    place();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (pending !== 0) window.cancelAnimationFrame(pending);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [open, choices.length]);

  // Keep the active match in view inside the list as the arrow keys move through it.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[id="${baseId}-opt-${safeActive}"]`);
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [open, safeActive, baseId]);

  function choose(choice: HonorComboboxOption | undefined) {
    if (!choice) return;
    onChange(choice.id);
    setTyped(null);
    setOpen(false);
  }

  function close() {
    setOpen(false);
    setTyped(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const result = comboboxKeyResult(event.key, { open, active: safeActive, count: choices.length });
    if (result.handled) {
      // Handled keys stay here: Enter must not submit a form around the field, Escape must not close a dialog around it.
      event.preventDefault();
      event.stopPropagation();
    }
    if (result.choose) { choose(choices[result.active]); return; }
    if (!result.open && event.key === "Tab") { close(); return; }
    setOpen(result.open);
    setActive(result.active);
    if (!result.open && event.key === "Escape" && result.handled) setTyped(null);
  }

  return (
    <div className="honor-combobox">
      <label htmlFor={`${baseId}-input`}>{label}</label>
      <input
        aria-activedescendant={open && choices.length > 0 ? optionId(safeActive) : undefined}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-describedby={describedBy}
        aria-expanded={open}
        autoComplete="off"
        id={`${baseId}-input`}
        ref={inputRef}
        onBlur={close}
        onChange={(event) => { setTyped(event.target.value); setOpen(true); setActive(0); }}
        onClick={() => setOpen(true)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? `Type to search ${nounPlural}`}
        required={required && !value}
        role="combobox"
        type="text"
        value={typed ?? selectedName}
      />
      {name && <input name={name} type="hidden" value={value} />}
      <ul
        aria-label={`${label} matches`}
        className="honor-combobox-list"
        data-placement={placement.side}
        hidden={!open}
        id={listId}
        // Keep focus in the input when the list's own scrollbar or padding is pressed.
        onMouseDown={(event) => event.preventDefault()}
        ref={listRef}
        role="listbox"
        style={placement.side === "above" ? { maxHeight: placement.maxHeight, top: "auto", bottom: placement.lift } : { maxHeight: placement.maxHeight }}
      >
        {choices.map((choice, index) => (
          <li
            aria-selected={index === safeActive}
            className={index === safeActive ? "active" : undefined}
            id={optionId(index)}
            key={choice.id || "all"}
            // mousedown, not click: the input's blur would otherwise close the list first.
            onMouseDown={(event) => { event.preventDefault(); choose(choice); }}
            role="option"
          >
            {choice.name}
          </li>
        ))}
        {choices.length === 0 && <li className="honor-combobox-empty" role="presentation">No {noun} matches</li>}
      </ul>
      <span aria-live="polite" className="sr-only" role="status">
        {open ? `${matches.length} ${matches.length === 1 ? `${noun} matches` : `${nounPlural} match`}` : ""}
      </span>
    </div>
  );
}
