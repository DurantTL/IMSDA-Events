"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { DestinationSearch } from "@/components/destination-search";
import type { SearchDestination } from "@/components/destination-search-model";
import styles from "./staff-shell.module.css";

/**
 * The header's "Find a page or task" (#1177) and, on a phone (800px and narrower), the search icon button that opens the very
 * same search on its own row under the header (#1734). Wide screens always show the box; the button is hidden there.
 */
export function StaffHeaderSearch({ destinations, inputId }: { destinations: readonly SearchDestination[]; inputId: string }) {
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    // The field is already in the page (hidden by the stylesheet until open), so it takes focus once it is shown.
    if (next) requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  }

  return (
    <>
      <div className={styles.search} data-open={open ? "true" : "false"}>
        <DestinationSearch destinations={destinations} inputId={inputId} onNavigated={() => setOpen(false)} />
      </div>
      <button
        type="button"
        className={`secondary-button ${styles.searchToggle}`}
        aria-label="Find a page or task"
        aria-expanded={open}
        aria-controls={inputId}
        onClick={toggle}
      >
        {open ? <X aria-hidden="true" size={20} /> : <Search aria-hidden="true" size={20} />}
      </button>
    </>
  );
}
