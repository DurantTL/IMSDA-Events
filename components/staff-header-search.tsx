"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { DestinationSearch } from "@/components/destination-search";
import type { SearchDestination } from "@/components/destination-search-model";
import styles from "./staff-shell.module.css";

/**
 * The header's search (#1177, with clubs, events and churches from #1837) and, on a phone (800px and narrower), the search icon button that opens the very
 * same search on its own row under the header (#1734). Wide screens always show the box; the button is hidden there.
 */
export function StaffHeaderSearch({ destinations, inputId }: { destinations: readonly SearchDestination[]; inputId: string }) {
  const pathname = usePathname();
  // The row is open only on the page it was opened on, so a route change closes it without an effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const setOpen = (next: boolean) => setOpenPath(next ? pathname : null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wrapId = `${inputId}-wrap`;

  // A window wider than the phone (where the box is always shown) closes the row too.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 801px)");
    const onChange = () => { if (wide.matches) setOpenPath(null); };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  // Escape with nothing left to undo (no typed words, no open list) closes the row and hands focus back to the button.
  function onKeyDownCapture(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open || event.nativeEvent.isComposing) return;
    const field = event.target;
    if (field instanceof HTMLInputElement && (field.value !== "" || field.getAttribute("aria-expanded") === "true")) return;
    event.preventDefault();
    setOpen(false);
    toggleRef.current?.focus();
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // The field is already in the page (hidden by the stylesheet until open), so it takes focus once it is shown.
    if (next) requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  }

  return (
    <>
      <div className={styles.search} id={wrapId} data-open={open ? "true" : "false"} onKeyDownCapture={onKeyDownCapture}>
        <DestinationSearch destinations={destinations} inputId={inputId} onNavigated={() => setOpen(false)} records />
      </div>
      <button
        type="button"
        ref={toggleRef}
        className={`secondary-button ${styles.searchToggle}`}
        aria-label="Search pages, clubs, events and churches"
        aria-expanded={open}
        aria-controls={wrapId}
        onClick={toggle}
      >
        {open ? <X aria-hidden="true" size={20} /> : <Search aria-hidden="true" size={20} />}
      </button>
    </>
  );
}
