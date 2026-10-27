"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  CALENDAR_INTRO_ATTRIBUTE,
  CALENDAR_INTRO_MS,
  CALENDAR_SELECTION_STORAGE,
  CALENDAR_SLIDE_MS,
  calendarDateFromHref,
  calendarFlipDelta,
  calendarFlipId,
  calendarSelectedKey,
  calendarSlideDirection,
  parseCalendarSelection,
  serializeCalendarSelection,
  type CalendarRect,
  type CalendarSelection,
} from "@/components/calendar-motion-helpers";

const MONTH = ".calendar-month";
const KEYED = "[data-calendar-key]";
const SNAPSHOT_TTL_MS = 5000;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function readStoredSelection(): CalendarSelection | null {
  try {
    return parseCalendarSelection(sessionStorage.getItem(CALENDAR_SELECTION_STORAGE));
  } catch {
    return null;
  }
}

function writeStoredSelection(selection: CalendarSelection | null) {
  try {
    if (selection) sessionStorage.setItem(CALENDAR_SELECTION_STORAGE, serializeCalendarSelection(selection));
    else sessionStorage.removeItem(CALENDAR_SELECTION_STORAGE);
  } catch {
    // Storage can be blocked; the highlight then simply lasts until the next page change.
  }
}

function keyedElements(month: Element, key: string) {
  return [...month.querySelectorAll<HTMLElement>(KEYED)].filter((element) => element.dataset.calendarKey === key);
}

function setLinked(key: string | null) {
  const month = document.querySelector(MONTH);
  if (!month) return;
  month.querySelectorAll(".is-linked").forEach((element) => element.classList.remove("is-linked"));
  if (key) keyedElements(month, key).forEach((element) => element.classList.add("is-linked"));
  if (key) month.setAttribute("data-calendar-active", "");
  else month.removeAttribute("data-calendar-active");
}

function applySelected(key: string | null) {
  const month = document.querySelector(MONTH);
  if (!month) return;
  month.querySelectorAll(".is-selected-event").forEach((element) => element.classList.remove("is-selected-event"));
  if (key) keyedElements(month, key).forEach((element) => element.classList.add("is-selected-event"));
}

/** Where every bar and chip sits, relative to the month grid, keyed by event and week (bars) or day (chips). */
function snapshot(month: Element) {
  const origin = month.getBoundingClientRect();
  const rects = new Map<string, CalendarRect>();
  for (const element of month.querySelectorAll<HTMLElement>(KEYED)) {
    const key = element.dataset.calendarKey ?? "";
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const isChip = element.tagName === "LI";
    const scope = isChip ? element.closest(".calendar-day")?.id ?? "" : element.closest(".calendar-week")?.querySelector(".calendar-day")?.id ?? "";
    rects.set(calendarFlipId(isChip ? "chip" : "bar", key, scope), { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
  }
  return rects;
}

/**
 * Motion for the public month calendar (#1206): linked highlight of one event across weeks (hover and keyboard focus alike), a
 * clicked event staying lifted while its day panel is open, a one-time intro, the month slide and the category gap-closing.
 * It only toggles classes and attributes and runs short transform animations; it never touches pointer events, and every
 * animation is skipped when the device asks for reduced motion.
 */
export function CalendarMotion({ month, category, selectedDate }: { month: string; category: string; selectedDate: string }) {
  const selection = useRef<CalendarSelection | null>(null);
  const previousMonth = useRef<string | null>(null);
  const previousCategory = useRef<string | null>(null);
  const flip = useRef<{ at: number; rects: Map<string, CalendarRect> } | null>(null);
  const slideTimer = useRef<number | undefined>(undefined);

  // Intro: bars draw in and today pulses on the first paint of a page load only; afterwards the gate attribute switches it off.
  useEffect(() => {
    const root = document.documentElement;
    const timer = window.setTimeout(() => root.setAttribute(CALENDAR_INTRO_ATTRIBUTE, ""), CALENDAR_INTRO_MS);
    return () => {
      window.clearTimeout(timer);
      root.setAttribute(CALENDAR_INTRO_ATTRIBUTE, "");
    };
  }, []);

  // Pointer and keyboard focus light up every bar of one event; a click remembers it for the day panel it opens.
  useEffect(() => {
    const keyOf = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest<HTMLElement>(`${MONTH} ${KEYED}`) : null;
      return element?.dataset.calendarKey ?? null;
    };
    const over = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === "touch") return;
      const key = keyOf(event.target);
      if (key) setLinked(key);
    };
    const out = (event: Event) => {
      if (keyOf(event.target)) setLinked(null);
    };
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const element = target?.closest<HTMLElement>(`${MONTH} ${KEYED}`);
      const date = calendarDateFromHref(element?.closest("a")?.getAttribute("href") ?? element?.querySelector("a")?.getAttribute("href"));
      const key = element?.dataset.calendarKey;
      if (!element || !key || !date) return;
      selection.current = { key, date };
      writeStoredSelection(selection.current);
      applySelected(key);
    };
    const events: [string, (event: never) => void][] = [["pointerover", over], ["pointerout", out], ["focusin", over], ["focusout", out], ["click", click]];
    for (const [name, handler] of events) document.addEventListener(name, handler as EventListener);
    return () => {
      for (const [name, handler] of events) document.removeEventListener(name, handler as EventListener);
    };
  }, []);

  // Snapshot positions just before a category link navigates (capture phase, so it runs before the router).
  useEffect(() => {
    const capture = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".calendar-categories a")) return;
      const board = document.querySelector(MONTH);
      if (board && !reducedMotion()) flip.current = { at: Date.now(), rects: snapshot(board) };
    };
    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, []);

  // The selected event follows the day panel: it stays while that day is open and clears when the panel closes or changes.
  useLayoutEffect(() => {
    const stored = selection.current ?? readStoredSelection();
    const key = calendarSelectedKey(stored, selectedDate || null);
    if (!key) {
      selection.current = null;
      writeStoredSelection(null);
    } else selection.current = stored;
    applySelected(key);
  }, [month, category, selectedDate]);

  // Month arrows slide the new weeks in; a category change closes up the gaps (skipped when the month also changed).
  useLayoutEffect(() => {
    const board = document.querySelector<HTMLElement>(MONTH);
    const direction = calendarSlideDirection(previousMonth.current, month);
    const categoryChanged = previousCategory.current !== null && previousCategory.current !== category;
    const monthChanged = previousMonth.current !== null && previousMonth.current !== month;
    const firstRun = previousMonth.current === null;
    previousMonth.current = month;
    previousCategory.current = category;
    // Any later change is a soft navigation: the intro must not replay on the new bars.
    if (!firstRun) document.documentElement.setAttribute(CALENDAR_INTRO_ATTRIBUTE, "");
    if (!board || reducedMotion()) {
      flip.current = null;
      return;
    }
    if (direction) {
      flip.current = null;
      board.setAttribute("data-calendar-slide", direction);
      window.clearTimeout(slideTimer.current);
      slideTimer.current = window.setTimeout(() => board.removeAttribute("data-calendar-slide"), CALENDAR_SLIDE_MS);
      return;
    }
    const before = flip.current;
    flip.current = null;
    if (!categoryChanged || monthChanged || !before || Date.now() - before.at > SNAPSHOT_TTL_MS) return;
    const after = snapshot(board);
    for (const element of board.querySelectorAll<HTMLElement>(KEYED)) {
      const key = element.dataset.calendarKey ?? "";
      const isChip = element.tagName === "LI";
      const scope = isChip ? element.closest(".calendar-day")?.id ?? "" : element.closest(".calendar-week")?.querySelector(".calendar-day")?.id ?? "";
      const id = calendarFlipId(isChip ? "chip" : "bar", key, scope);
      const now = after.get(id);
      if (!now || typeof element.animate !== "function") continue;
      const old = before.rects.get(id);
      const delta = old ? calendarFlipDelta(old, now) : null;
      if (old && delta) element.animate([{ transform: `translate(${delta.dx}px, ${delta.dy}px)` }, { transform: "none" }], { duration: 250, easing: "ease-out" });
      else if (!old) element.animate([{ transform: "translateY(6px) scale(0.97)" }, { transform: "none" }], { duration: 250, easing: "ease-out" });
    }
  }, [month, category]);

  useEffect(() => () => window.clearTimeout(slideTimer.current), []);

  return null;
}
