"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { DestinationSearch } from "@/components/destination-search";
import { clubPageDestinations, clubRecordSearch, type ClubSearchPage } from "@/components/club-search-model";
import type { SearchDestination } from "@/components/destination-search-model";
import styles from "@/components/club-portal-search.module.css";

/**
 * The club portal masthead's search (#1854): the same combobox as the staff header, over this club's pages, the leader's
 * own clubs and the members the roster would show them. On a phone (640px and narrower) a search icon button opens it on
 * its own row under the masthead, as the staff header does (#1734); wider screens always show the box.
 */
export function ClubPortalSearch({ pages }: { pages: readonly ClubSearchPage[] }) {
  const pathname = usePathname();
  const destinations: SearchDestination[] = useMemo(() => clubPageDestinations(pages), [pages]);
  // The row is open only on the page it was opened on, so a route change closes it without an effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const setOpen = (next: boolean) => setOpenPath(next ? pathname : null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputId = "club-portal-search-input";
  const wrapId = `${inputId}-wrap`;

  // A window wider than the phone (where the box is always shown) closes the row too.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 641px)");
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
        <DestinationSearch destinations={destinations} inputId={inputId} onNavigated={() => setOpen(false)} records={clubRecordSearch} />
      </div>
      <button
        type="button"
        ref={toggleRef}
        className={`secondary-button ${styles.toggle}`}
        aria-label="Search this club's pages, your clubs and members"
        aria-expanded={open}
        aria-controls={wrapId}
        onClick={toggle}
      >
        {open ? <X aria-hidden="true" size={20} /> : <Search aria-hidden="true" size={20} />}
      </button>
    </>
  );
}
