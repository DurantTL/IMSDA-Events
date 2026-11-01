"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExportStatusContext, exportStatusText, type ExportStatus } from "@/components/export-link";
import { ChevronDown } from "lucide-react";

/**
 * One "Actions" menu for a screen's maintenance work: exports, bulk email,
 * recalculations and the like (#743). It is a native disclosure (`<details>`),
 * so it opens and closes with Enter and Space and works before scripts load;
 * the script only closes it on Escape, an outside click, or a choice. It is
 * always an outlined button, so the screen keeps its one filled primary action.
 */
export function ActionsMenu({ label = "Actions", ariaLabel, children }: { label?: string; /** A name that says which row the menu belongs to, e.g. "More actions for Sample club". */ ariaLabel?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // A download started from a menu item reports here, because the menu closes on the click (#1458).
  const [download, setDownload] = useState<ExportStatus>({ phase: "idle", message: "" });
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const close = () => { menu.open = false; };
    const onPointerDown = (event: PointerEvent) => {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.open) {
        close();
        menu.querySelector("summary")?.focus();
      }
    };
    // Tabbing out of the menu closes it (focus moving to something outside it).
    const onFocusOut = (event: FocusEvent) => {
      if (menu.open && event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) close();
    };
    menu.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      menu.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  return (
    <>
    <details className="actions-menu" ref={ref}>
      <summary className="secondary-button actions-menu-trigger" aria-label={ariaLabel}>
        {label} <ChevronDown aria-hidden="true" size={15} />
      </summary>
      <ul
        className="actions-menu-list"
        onClick={() => {
          const menu = ref.current;
          if (!menu) return;
          menu.open = false;
          // A dialog opened by a choice returns focus to a visible element, not a hidden menu item.
          menu.querySelector("summary")?.focus();
        }}
      >
        <ExportStatusContext.Provider value={setDownload}>{children}</ExportStatusContext.Provider>
      </ul>
    </details>
    <span aria-live="polite" className={download.phase === "failed" ? "form-error" : "quiet-copy"} role="status">{exportStatusText(download)}</span>
    </>
  );
}
