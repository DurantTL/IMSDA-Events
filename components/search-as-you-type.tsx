"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ChangeEvent, FormEvent, FormHTMLAttributes, KeyboardEvent, ReactNode, RefObject } from "react";

/**
 * The one search-as-you-type behavior (#1431). A search box updates its list a short pause after the last keystroke, no
 * Enter needed; Enter still applies at once and a plain GET form still works without script. Server lists keep their
 * state in the URL (`useSearchAsYouType`, `SearchAsYouTypeForm`); client and fetch lists use `useDebouncedSearch` and
 * `createTicket`. Every search input under app/ and components/ must go through this module or be on the reviewed
 * allowlist in tests/search-as-you-type-guard-1431.test.ts.
 */

/** Pause after the last keystroke before a list updates. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Set a field to the URL's value unless its owner is typing in it (#723). The fields are uncontrolled, so after
 * same-page navigation (a nav link, Back) they would otherwise keep showing the old query.
 */
export function syncFieldValue(
  field: { value: string } | null,
  value: string,
  activeElement: unknown,
) {
  if (!field || field === activeElement || field.value === value) return;
  field.value = value;
}

/**
 * The address a search lands on, built the way a native GET submit builds it: from the form's own fields only, so
 * script and no-script send the same thing and a stale param the form never had cannot ride along. Non-empty values
 * are set (trimmed), empty ones left out, and a field with several values (checkboxes) is appended once per value.
 * `ignoreValues` (a select's "all" value, such as status "ALL") count as empty. `keepParams` is an explicit opt-in for
 * a form that must carry a param it has no field for. `resetParams` (the page) are dropped so a changed term goes back
 * to page 1. Returns the bare path when no params remain.
 */
export function searchAsYouTypeHref(
  pathname: string,
  currentSearch: string,
  fields: Iterable<[string, FormDataEntryValue]>,
  { resetParams = ["page"], keepParams = [], ignoreValues = {} }: { resetParams?: string[]; keepParams?: Iterable<string>; ignoreValues?: Record<string, string> } = {},
) {
  const params = new URLSearchParams();
  const current = new URLSearchParams(currentSearch);
  for (const name of keepParams) for (const value of current.getAll(name)) params.append(name, value);
  const grouped = new Map<string, string[]>();
  for (const [name, raw] of fields) {
    if (typeof raw !== "string") continue;
    const list = grouped.get(name) ?? [];
    list.push(raw.trim());
    grouped.set(name, list);
  }
  for (const [name, values] of grouped) {
    const filled = values.filter((value) => value !== "" && value !== ignoreValues[name]);
    if (filled.length <= 1) {
      if (filled.length === 0) params.delete(name);
      else params.set(name, filled[0]!);
    } else {
      params.delete(name);
      for (const value of filled) params.append(name, value);
    }
  }
  for (const name of resetParams) params.delete(name);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** True when `href` is the address the browser is already on (same path, same params in any order). */
export function isCurrentAddress(href: string) {
  const parse = (address: string) => {
    const url = new URL(address, window.location.origin);
    return `${url.pathname}?${[...url.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort().join("&")}`;
  };
  return parse(href) === parse(`${window.location.pathname}${window.location.search}`);
}

/** A counter for stale answers: only the newest ticket is current, so an older fetch never overwrites a newer one. */
export function createTicket() {
  let latest = 0;
  return {
    next: () => ++latest,
    isCurrent: (ticket: number) => ticket === latest,
    invalidate: () => {
      latest += 1;
    },
  };
}

/** A stable ticket counter for a component's fetch-based search. */
export function useSearchTicket() {
  const [ticket] = useState(createTicket);
  return ticket;
}

/** The value after it has stopped changing for `delayMs`, for client-filtered lists and fetches. */
export function useDebouncedSearch(value: string, delayMs: number = SEARCH_DEBOUNCE_MS) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);
  return settled;
}

/** How a filter change reaches the address: a typed search replaces (one entry per search), a toggle or select pushes (Back undoes it). */
export type AddressMode = "push" | "replace";

/** The mode for a change to `target`: typed text replaces, anything else (select, checkbox, radio, button) pushes. */
export function addressModeFor(target: EventTarget | null): AddressMode {
  return isTypedField(target) ? "replace" : "push";
}

/**
 * The address after setting (or, with null or "", removing) the named params, keeping every other param, the path and
 * the hash. Returns null when nothing would change. Pure, so it is unit tested.
 */
export function addressWith(
  location: { pathname: string; search: string; hash?: string },
  updates: Record<string, string | null | undefined>,
) {
  const params = new URLSearchParams(location.search);
  for (const [name, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") params.delete(name);
    else params.set(name, value);
  }
  const query = params.toString();
  const next = `${location.pathname}${query ? `?${query}` : ""}${location.hash ?? ""}`;
  const current = new URLSearchParams(location.search).toString();
  return query === current ? null : next;
}

/**
 * Write filters of a list that filters in the browser into the address (rule B2, #1456) with the native history API,
 * which Next keeps in sync with `useSearchParams` without a server round trip. Other params (`?year=`) stay. Nothing
 * happens when the address already says it.
 */
export function writeAddressParams(updates: Record<string, string | null | undefined>, mode: AddressMode) {
  try {
    const next = addressWith(window.location, updates);
    if (next === null) return;
    // A null state lets Next copy its own state onto the entry.
    if (mode === "push") window.history.pushState(null, "", next);
    else window.history.replaceState(null, "", next);
  } catch {
    // A page without a usable address bar (a preview) simply keeps its address.
  }
}

/** One param of the address as it is now, or null when absent (or on the server). */
export function readAddressParam(name: string) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/**
 * A client-list filter kept in the address (rule B2, #1456): `value` starts as the server's reading of the address, `set`
 * updates the list and the address together (default push, so Back undoes a toggle), and Back or Forward puts `value`
 * back. `fallback` is what an absent param means.
 */
export function useAddressParam(name: string, initial: string, fallback = "") {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const restore = () => setValue(readAddressParam(name) ?? fallback);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [name, fallback]);
  const set = useCallback((next: string, mode: AddressMode = "push") => {
    setValue(next);
    writeAddressParams({ [name]: next === fallback ? null : next }, mode);
  }, [name, fallback]);
  return [value, set] as const;
}

/**
 * Several client-list filters (selects) kept in the address, for a list that filters in the browser (rule B2, #1456).
 * `parse` reads a whole address into valid values (use a module-level function); a value equal to its default is left out
 * of the address. `set` updates the list and the address together (default push), and a shared link, reload or Back
 * puts the values back.
 */
export function useAddressParams<T extends Record<string, string>>(defaults: T, parse: (params: URLSearchParams) => T) {
  const [values, setValues] = useState(defaults);
  useEffect(() => {
    const restore = () => setValues(parse(new URLSearchParams(window.location.search)));
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [parse]);
  const set = useCallback((patch: Partial<T>, mode: AddressMode = "push") => {
    setValues((current) => ({ ...current, ...patch }));
    const updates: Record<string, string | null> = {};
    for (const [name, value] of Object.entries(patch)) updates[name] = value === defaults[name] ? null : (value as string);
    writeAddressParams(updates, mode);
  }, [defaults]);
  return [values, set] as const;
}

/** Router navigation for a list's filters: `push` for a select, checkbox or button, `replace` for typed text. */
export function useListNavigation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = useCallback((href: string, mode: AddressMode) => {
    startTransition(() => (mode === "push" ? router.push(href, { scroll: false }) : router.replace(href, { scroll: false })));
  }, [router]);
  return { go, pending };
}

/**
 * Search-as-you-type for a list filtered in the browser (#1431). The box shows every keystroke (`value`), while the list
 * filters on `term`, which settles a short pause after the last keystroke. Enter applies at once, and clearing the box
 * shows the full list at once. Spread `inputProps` on the `<input>`; filter, page and count from `term`; reset the
 * list's page when `term` changes. The input is never remounted, so focus and the cursor stay put.
 */
export function useClientSearch(initial = "", delayMs: number = SEARCH_DEBOUNCE_MS, addressParam?: string) {
  const [value, setValue] = useState(initial);
  const [term, setTerm] = useState(initial);
  // Kept current by `set`, the only way the box changes, so `applyNow` always reads what is typed.
  const latest = useRef(value);
  const debouncer = useDebouncedCallback(() => setTerm(latest.current), delayMs);
  const set = useCallback((next: string) => {
    setValue(next);
    latest.current = next;
    if (next.trim() === "") {
      debouncer.cancel();
      setTerm(next);
    } else debouncer.schedule();
  }, [debouncer]);
  const applyNow = useCallback(() => {
    debouncer.cancel();
    setTerm(latest.current);
  }, [debouncer]);
  // Rule B2 (#1456): with an `addressParam`, the settled term is written to the address (replace: one history entry per
  // search, not per keystroke), and a shared link, reload or Back puts it back in the box.
  const written = useRef(initial);
  useEffect(() => {
    if (!addressParam || term === written.current) return;
    written.current = term;
    writeAddressParams({ [addressParam]: term.trim() || null }, "replace");
  }, [addressParam, term]);
  useEffect(() => {
    if (!addressParam) return;
    const restore = () => {
      const fromAddress = readAddressParam(addressParam) ?? "";
      if (fromAddress.trim() === latest.current.trim()) return;
      debouncer.cancel();
      latest.current = fromAddress;
      written.current = fromAddress;
      setValue(fromAddress);
      setTerm(fromAddress);
    };
    // A page that did not pass the address's term as `initial` still shows it after load.
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [addressParam, debouncer]);
  return {
    value,
    term,
    setValue: set,
    applyNow,
    pending: value !== term,
    inputProps: {
      value,
      onChange: (event: ChangeEvent<HTMLInputElement>) => set(event.target.value),
      // Leaving the box settles the term first, so a click or Tab never lands on a list that changes under it.
      onBlur: applyNow,
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return;
        // A box outside a form has nothing to submit; inside one, the form's own submit handler runs as before.
        if (!event.currentTarget.form) event.preventDefault();
        applyNow();
      },
    },
  };
}

/** A debounced callback that always runs the latest function, with cancel and flush; the timer is cleared on unmount. */
export function useDebouncedCallback(fn: () => void, delayMs: number = SEARCH_DEBOUNCE_MS) {
  const latest = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = fn;
  });
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, delayMs);
  }, [cancel, delayMs]);
  const flush = useCallback(() => {
    if (!timer.current) return;
    cancel();
    latest.current();
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  return useMemo(() => ({ schedule, cancel, flush }), [schedule, cancel, flush]);
}

const TYPED_INPUT_TYPES = new Set(["search", "text", "email", "tel", "url", "number", ""]);

function isTypedField(target: EventTarget | null) {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TYPED_INPUT_TYPES.has(target.type);
}

/**
 * Search-as-you-type for a plain GET form whose state lives in the URL. Spread `formProps` on the `<form>` (typing in a
 * text box applies after the pause; a select, checkbox or radio applies at once; submit applies at once and only
 * cancels the browser's own submit when script is running). Use `apply` and `cancel` for a Clear control.
 */
export function useSearchAsYouType({
  delayMs = SEARCH_DEBOUNCE_MS,
  resetParams = ["page"],
  pathname,
  ignoreValues,
  keepParams,
}: { delayMs?: number; resetParams?: string[]; pathname?: string; ignoreValues?: Record<string, string>; keepParams?: string[] } = {}) {
  const { go, pending } = useListNavigation();
  const formRef = useRef<HTMLFormElement>(null);

  // Typed text replaces (one history entry per search); a select, checkbox, radio or submit pushes, so Back steps
  // through filter changes (rule B2, #1456).
  const applyNow = (mode: AddressMode = "replace") => {
    const form = formRef.current;
    if (!form) return;
    const path = pathname ?? window.location.pathname;
    // A select's `data-default-value` is what leaving it out of the address means, so choosing it adds nothing (`dir=asc`).
    const defaults: Record<string, string> = {};
    for (const select of Array.from(form.querySelectorAll<HTMLSelectElement>("select[data-default-value]"))) {
      if (select.name) defaults[select.name] = select.dataset.defaultValue ?? "";
    }
    const href = searchAsYouTypeHref(path, window.location.search, new FormData(form).entries(), { resetParams, keepParams, ignoreValues: { ...defaults, ...ignoreValues } });
    // Re-searching the same words must not stack a navigation.
    if (isCurrentAddress(href)) return;
    go(href, mode);
  };
  const debouncer = useDebouncedCallback(() => applyNow("replace"), delayMs);

  return {
    formProps: {
      ref: formRef,
      "aria-busy": pending,
      onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        debouncer.cancel();
        applyNow("push");
      },
      onChange(event: FormEvent<HTMLFormElement>) {
        if (isTypedField(event.target)) debouncer.schedule();
        else if ((event.target as HTMLElement).tagName !== "INPUT" || (event.target as HTMLInputElement).type !== "hidden") {
          debouncer.cancel();
          applyNow(addressModeFor(event.target));
        }
      },
    },
    inputProps: { onChange: () => debouncer.schedule() },
    formRef,
    pending,
    apply: () => {
      debouncer.cancel();
      applyNow("replace");
    },
    cancel: () => debouncer.cancel(),
  };
}

/**
 * Keep an uncontrolled field showing the URL's value after Back or a link, without ever overwriting the field the user
 * is typing in.
 */
export function useSyncSearchField(formRef: RefObject<HTMLFormElement | null>, name: string, value: string) {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    syncFieldValue(form.elements.namedItem(name) as HTMLInputElement | null, value, document.activeElement);
  }, [formRef, name, value]);
}

/**
 * A GET form with search-as-you-type for a Server Component page. It renders the same `<form method="get">` the page had,
 * so Enter and no-script still submit it. Its text boxes and selects follow the URL after Back or a link.
 */
export function SearchAsYouTypeForm({
  action,
  children,
  delayMs,
  resetParams,
  ...rest
}: Omit<FormHTMLAttributes<HTMLFormElement>, "method" | "action" | "onSubmit" | "onChange" | "onClick"> & {
  action: string;
  children?: ReactNode;
  delayMs?: number;
  resetParams?: string[];
}) {
  const { formProps, cancel } = useSearchAsYouType({ delayMs, resetParams, pathname: action });
  const lastSearch = useRef<string | null>(null);

  // After navigation (Back, a link) show the URL's values (text, selects, checkboxes), except in the control being used.
  useEffect(() => {
    const search = window.location.search;
    if (lastSearch.current === null) {
      lastSearch.current = search;
      return;
    }
    if (lastSearch.current === search) return;
    lastSearch.current = search;
    const form = formProps.ref.current;
    if (!form) return;
    const params = new URLSearchParams(search);
    const active = document.activeElement;
    for (const element of Array.from(form.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement) || !element.name) continue;
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        // Links write a comma list (`statuses=A,B`), a form one value per box; absent means the box's default.
        const chosen = params.getAll(element.name).flatMap((value) => value.split(",").map((part) => part.trim()));
        if (element !== active) element.checked = params.has(element.name) ? chosen.includes(element.value) : element.hasAttribute("data-default-checked");
      } else if (element instanceof HTMLSelectElement && !params.has(element.name)) {
        // Left out of the URL means the select's default: `data-default-value`, else its "" option, else the option
        // marked selected when it first rendered.
        const options = Array.from(element.options);
        const fallback = options.find((option) => option.value === element.dataset.defaultValue)
          ?? options.find((option) => option.value === "")
          ?? options.find((option) => option.defaultSelected);
        if (fallback) syncFieldValue(element, fallback.value, active);
      } else if (element instanceof HTMLSelectElement || TYPED_INPUT_TYPES.has((element as HTMLInputElement).type)) {
        syncFieldValue(element, params.get(element.name) ?? "", active);
      }
    }
  });

  return (
    // A Clear or other link inside the form drops a search still waiting on its pause, so it cannot put the old words back.
    <form {...rest} {...formProps} action={action} method="get" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) cancel(); }}>
      {children}
    </form>
  );
}

/** The result count for screen readers, announced politely once a search settles (#1431). */
export function SearchResultStatus({ message }: { message: string }) {
  return <p className="sr-only" role="status" aria-live="polite">{message}</p>;
}

/**
 * A `<details>` that holds a search form (#1431). The server opens it when a filter is active, but once it is open it
 * stays open: clearing the box as you type removes the filter, and a closing panel would take the focused box with it.
 */
export function SearchDisclosure({ open, children, ...props }: { open: boolean; children?: ReactNode; className?: string; "data-testid"?: string }) {
  const [isOpen, setIsOpen] = useState(open);
  const [lastOpen, setLastOpen] = useState(open);
  // Opens again when the server newly opens it; never closes on its own.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setIsOpen(true);
  }
  return (
    <details {...props} onToggle={(event) => setIsOpen(event.currentTarget.open)} open={isOpen}>
      {children}
    </details>
  );
}
