// Focus handling for the phone builder's full-screen sidebar (#1071), the same pattern as the #1046 picker and the Move
// screen: while it covers the page the page behind is inert, Tab stays inside, Escape closes it, and focus goes back to
// the control that opened it (or, when that control is gone, to `fallback`). Closing only hides it: nothing is saved.
import { useEffect, useRef, type RefObject } from "react";
import { dialogKeyDown, pushOpenDialog, removeOpenDialog } from "@/components/use-accessible-dialog";
import { makeBackgroundInert } from "@/components/use-attendee-sheet";
import { pickerViewportBox, trappedTabIndex } from "@/modules/forms/searchable-choice";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

/** The elements Tab can reach inside `root` right now: not hidden and taking up room (so nothing in a closed fold). */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((candidate) => (
    !candidate.hidden && candidate.getClientRects().length > 0 && candidate.getAttribute("role") !== "separator"
  ));
}

/** Tab inside the sheet: also loops when focus is on the sheet itself, and Shift+Tab from outside lands on the last stop. */
function phoneNextStop(stops: HTMLElement[], active: Element | null, backwards: boolean, element: HTMLElement): HTMLElement | null {
  const next = trappedTabIndex(stops.indexOf(active as HTMLElement), stops.length, backwards);
  if (next !== null) return stops[next] ?? null;
  return element.contains(active) ? null : (stops[0] ?? element);
}

export function usePhoneModal({ active, ref, onClose, fallback, fit = true }: {
  active: boolean;
  ref: RefObject<HTMLElement | null>;
  onClose: () => void;
  fallback?: () => void;
  /** Cover exactly the visual viewport (--picker-top and --picker-height on the element), so the sheet ends at the keyboard. */
  fit?: boolean;
}) {
  const closeRef = useRef(onClose);
  const fallbackRef = useRef(fallback);
  useEffect(() => { closeRef.current = onClose; fallbackRef.current = fallback; });

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const element = root;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const hadSheetClass = document.documentElement.classList.contains("has-attendee-sheet");
    const restoreInert = makeBackgroundInert(element);
    const token = pushOpenDialog();
    // Focus lands in the sheet, on the sheet itself, so the keyboard does not open and a screen reader announces its name.
    if (!element.contains(document.activeElement)) element.focus({ preventScroll: true });

    // Escape, Tab and the top-of-stack check are the shared dialog core; only the tab stops and where Tab goes differ.
    function onKeyDown(event: KeyboardEvent) {
      dialogKeyDown(event, {
        token,
        dialog: element,
        stops: () => tabStops(element),
        // An open menu or picker inside takes its own Escape first; they stop it.
        skipHandled: "escape",
        onEscape: () => closeRef.current(),
        nextStop: phoneNextStop,
      });
    }
    const viewport = window.visualViewport;
    function fitToViewport() {
      const box = pickerViewportBox(viewport);
      if (!box) return;
      element.style.setProperty("--picker-top", `${box.top}px`);
      element.style.setProperty("--picker-height", `${box.height}px`);
    }
    if (fit) {
      fitToViewport();
      viewport?.addEventListener("resize", fitToViewport);
      viewport?.addEventListener("scroll", fitToViewport);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      viewport?.removeEventListener("resize", fitToViewport);
      viewport?.removeEventListener("scroll", fitToViewport);
      element.style.removeProperty("--picker-top");
      element.style.removeProperty("--picker-height");
      removeOpenDialog(token);
      restoreInert();
      if (hadSheetClass) document.documentElement.classList.add("has-attendee-sheet");
      if (opener?.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
      else fallbackRef.current?.();
    };
  }, [active, ref, fit]);
}
