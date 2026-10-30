"use client";

import { useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Open dialogs, outermost first. A confirmation opened over an editor dialog
 * (#743) must own Escape and Tab while it is up, so only the top one reacts.
 */
const openDialogs: symbol[] = [];

/** Registers an open dialog; returns its token. */
export function pushOpenDialog() {
  const token = Symbol("dialog");
  openDialogs.push(token);
  return token;
}

export function removeOpenDialog(token: symbol) {
  const at = openDialogs.indexOf(token);
  if (at !== -1) openDialogs.splice(at, 1);
}

/** Only the top-most open dialog answers Escape and Tab. */
export function isTopDialog(token: symbol) {
  return openDialogs.at(-1) === token;
}

export function openDialogCount() {
  return openDialogs.length;
}

type StopFinder = (stops: HTMLElement[], active: Element | null, backwards: boolean, dialog: HTMLElement) => HTMLElement | null;

/** Where Tab should go to keep focus inside `dialog`, or null to let the browser move it. */
const defaultNextStop: StopFinder = (stops, active, backwards, dialog) => {
  // Focus can fall to the page when a focused button is disabled (e.g. while saving): pull it back in.
  if (!dialog.contains(active)) return stops[0] ?? dialog;
  if (stops.length === 0) return dialog;
  const first = stops[0];
  const last = stops.at(-1)!;
  // Focus resting on the dialog itself (its own initial focus) must not let Shift+Tab leave through the top.
  if (backwards && (active === first || active === dialog)) return last;
  if (!backwards && active === last) return first;
  return null;
};

/**
 * The key handling every modal shares: only the top-most open dialog reacts, Escape closes it, and Tab stays inside.
 * `useAccessibleDialog` and the phone builder's `usePhoneModal` both run it; `stops` and `nextStop` let a caller say
 * what counts as a tab stop and where Tab goes next.
 */
export function dialogKeyDown(event: KeyboardEvent, { token, dialog, stops, onEscape, skipHandled, nextStop = defaultNextStop }: {
  token: symbol;
  dialog: HTMLElement;
  stops: () => HTMLElement[];
  onEscape: () => void;
  skipHandled?: "escape" | "all";
  nextStop?: StopFinder;
}) {
  if (!isTopDialog(token)) return;
  if (event.key === "Escape") {
    // Something inside (an open menu or picker) already took this Escape.
    if (skipHandled && event.defaultPrevented) return;
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== "Tab") return;
  if (skipHandled === "all" && event.defaultPrevented) return;
  const target = nextStop(stops(), document.activeElement, event.shiftKey, dialog);
  if (!target) return;
  event.preventDefault();
  target.focus();
}

export type AccessibleDialogOptions = {
  /**
   * Where focus lands when the dialog opens. Default: the first focusable element, else the dialog itself.
   * "dialog" focuses the container (so a phone keyboard stays closed); a function returns the element to focus, and
   * falls back to the default when it returns nothing. Both focus without scrolling.
   */
  initialFocus?: "dialog" | (() => HTMLElement | null | undefined);
  /**
   * Read when the dialog closes: given the element that was focused when it opened, returns the element to give focus
   * back to, or nothing to leave focus where it is. Default: the element that was focused when it opened.
   */
  returnFocus?: (opener: HTMLElement | null) => HTMLElement | null | undefined;
  /** Ignore Escape (or Escape and Tab) that something inside the dialog already handled and prevented. Default: react to all. */
  skipHandled?: "escape" | "all";
};

export function useAccessibleDialog<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  options: AccessibleDialogOptions = {},
) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const optionsRef = useRef(options);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const dialogElement = dialog;
    const token = pushOpenDialog();

    const focusableElements = () => Array.from(
      dialogElement.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => !element.hidden && element.offsetParent !== null);

    window.requestAnimationFrame(() => {
      const initial = optionsRef.current.initialFocus;
      if (initial === "dialog") {
        dialogElement.focus({ preventScroll: true });
        return;
      }
      const chosen = typeof initial === "function" ? initial() : null;
      if (chosen) {
        chosen.focus({ preventScroll: true });
        return;
      }
      const firstFocusable = focusableElements()[0];
      if (firstFocusable) firstFocusable.focus();
      else dialogElement.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      dialogKeyDown(event, {
        token,
        dialog: dialogElement,
        stops: focusableElements,
        onEscape: () => closeRef.current(),
        skipHandled: optionsRef.current.skipHandled,
      });
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      removeOpenDialog(token);
      const giveBack = optionsRef.current.returnFocus;
      if (giveBack) giveBack(previouslyFocused)?.focus({ preventScroll: true });
      else previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  return dialogRef;
}
