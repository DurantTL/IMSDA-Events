"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent, FormHTMLAttributes, ReactNode, RefObject } from "react";

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
 * The address a search lands on: the current URL's params with the form's fields laid over them. Non-empty values are
 * set (trimmed), empty ones deleted (so are the `ownedParams`, the names of every control in the form), and a field with several values (checkboxes) is deleted then appended. The
 * `ignoreValues` (a select's "all" value, such as status "ALL") count as empty. The `resetParams` (the page) are dropped so a changed term goes back to page 1; every other param is kept. Returns the
 * bare path when no params remain.
 */
export function searchAsYouTypeHref(
  pathname: string,
  currentSearch: string,
  fields: Iterable<[string, FormDataEntryValue]>,
  { resetParams = ["page"], ownedParams = [], ignoreValues = {} }: { resetParams?: string[]; ownedParams?: Iterable<string>; ignoreValues?: Record<string, string> } = {},
) {
  const params = new URLSearchParams(currentSearch);
  // A control the form owns but left out of the data (an unchecked checkbox) must clear its param too.
  for (const name of ownedParams) params.delete(name);
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

/** A debounced call with cancel and flush, free of React so it can be tested with fake timers. */
export function createDebouncer(fn: () => void, delayMs: number = SEARCH_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel,
    flush() {
      if (!timer) return;
      cancel();
      fn();
    },
    isPending: () => timer !== null,
  };
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
}: { delayMs?: number; resetParams?: string[]; pathname?: string; ignoreValues?: Record<string, string> } = {}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const applyNow = () => {
    const form = formRef.current;
    if (!form) return;
    const path = pathname ?? window.location.pathname;
    const ownedParams = Array.from(form.elements, (element) => (element as HTMLInputElement).name).filter(Boolean);
    const href = searchAsYouTypeHref(path, window.location.search, new FormData(form).entries(), { resetParams, ownedParams, ignoreValues });
    // Re-searching the same words must not stack a navigation.
    if (href === `${window.location.pathname}${window.location.search}`) return;
    startTransition(() => router.replace(href, { scroll: false }));
  };
  const debouncer = useDebouncedCallback(applyNow, delayMs);

  return {
    formProps: {
      ref: formRef,
      "aria-busy": pending,
      onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        debouncer.cancel();
        applyNow();
      },
      onChange(event: FormEvent<HTMLFormElement>) {
        if (isTypedField(event.target)) debouncer.schedule();
        else if ((event.target as HTMLElement).tagName !== "INPUT" || (event.target as HTMLInputElement).type !== "hidden") {
          debouncer.cancel();
          applyNow();
        }
      },
    },
    inputProps: { onChange: () => debouncer.schedule() },
    formRef,
    pending,
    apply: () => {
      debouncer.cancel();
      applyNow();
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
        if (element !== active) element.checked = params.getAll(element.name).includes(element.value);
      } else if (element instanceof HTMLSelectElement && !params.has(element.name)) {
        // Left out of the URL means the select's default: `data-default-value`, else its "" option.
        const fallback = element.dataset.defaultValue ?? "";
        if (Array.from(element.options).some((option) => option.value === fallback)) syncFieldValue(element, fallback, active);
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
