"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { DestinationSearch } from "@/components/destination-search";
import { clubPageDestinations, clubRecordSearch, type ClubSearchPage } from "@/components/club-search-model";
import type { SearchDestination } from "@/components/destination-search-model";
import styles from "@/components/club-portal-search.module.css";

/**
 * The club banner's search (#1854): the same combobox as the staff header, over this club's pages, the leader's own
 * clubs and the members the roster would show them. An icon button beside the club year opens it as a panel under the
 * banner, at every width, so neither the masthead nor the banner gets taller. The panel closes when focus leaves it
 * (Tab past it, a click elsewhere, another control opening, or Escape handing focus back to the button).
 */
export function ClubPortalSearch({ pages }: { pages: readonly ClubSearchPage[] }) {
  const pathname = usePathname();
  const destinations: SearchDestination[] = useMemo(() => clubPageDestinations(pages), [pages]);
  // The panel is open only on the page it was opened on, so a route change closes it without an effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const setOpen = (next: boolean) => setOpenPath(next ? pathname : null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputId = "club-portal-search-input";
  const wrapId = `${inputId}-wrap`;

  // Escape with nothing left to undo (no typed words, no open list) closes the panel and hands focus back to the button.
  function onKeyDownCapture(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open || event.nativeEvent.isComposing) return;
    const field = event.target;
    if (field instanceof HTMLInputElement && (field.value !== "" || field.getAttribute("aria-expanded") === "true")) return;
    event.preventDefault();
    setOpen(false);
    toggleRef.current?.focus();
  }

  // Focus leaving the panel for anything outside it closes it, so it never covers a control the person moved on to.
  function onBlurCapture(event: React.FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOpen(false);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // The field is already in the page (hidden by the stylesheet until open), so it takes focus once it is shown.
    if (next) requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  }

  return (
    <>
      {/* On the navy banner the focus ring is the gold one (`.on-dark`). */}
      <span className="on-dark">
      <button
        type="button"
        ref={toggleRef}
        className={styles.toggle}
        aria-label="Search this club's pages, your clubs and members"
        aria-expanded={open}
        aria-controls={wrapId}
        // Pressing the button while the field has focus must not blur the field first (that would close, then reopen).
        onMouseDown={(event) => { if (open) event.preventDefault(); }}
        onClick={toggle}
      >
        {open ? <X aria-hidden="true" size={20} /> : <Search aria-hidden="true" size={20} />}
      </button>
      </span>
      <div className={styles.search} id={wrapId} data-open={open ? "true" : "false"} onBlurCapture={onBlurCapture} onKeyDownCapture={onKeyDownCapture}>
        <DestinationSearch destinations={destinations} inputId={inputId} onNavigated={() => setOpen(false)} records={clubRecordSearch} />
      </div>
    </>
  );
}

/** The banner's right-hand group: the club year and the search button, kept together on one line. */
export function ClubBannerTools({ children }: { children: React.ReactNode }) {
  return <div className={styles.tools}>{children}</div>;
}
