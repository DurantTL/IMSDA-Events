"use client";

import { usePathname } from "next/navigation";
import { useId, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Search, X } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { isPlainClick } from "@/components/more-launcher-model";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { filterClubsByNameChurchOrCity } from "@/modules/club-reports/area-summary-domain";
import { coordinatorClubHref, switchClubHref, type SwitchableClub } from "@/modules/club-rosters/area-club-switch";
import styles from "./area-club-switcher.module.css";

/**
 * "Switch club" on a coordinator's club pages (#1759): a button that opens a sheet (phone) or dialog with a search over
 * the active clubs, each a link to the same tab on that club. The list is the coordinator's club list; the current club
 * is marked, not hidden. Escape and Close return focus to the button; following a link closes it.
 */
export function AreaClubSwitcher({ clubs, currentId, ownClubIds = [] }: { clubs: readonly SwitchableClub[]; currentId: string; ownClubIds?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`secondary-button ${styles.trigger}`}
        onClick={() => setOpen(true)}
        ref={buttonRef}
        type="button"
      >
        <ArrowLeftRight aria-hidden="true" size={16} /> Switch club
      </button>
      {open && <SwitcherDialog clubs={clubs} currentId={currentId} own={ownClubIds} onClose={() => setOpen(false)} returnTo={buttonRef} />}
    </>
  );
}

function SwitcherDialog({ clubs, currentId, own, onClose, returnTo }: { clubs: readonly SwitchableClub[]; currentId: string; own: readonly string[]; onClose: () => void; returnTo: RefObject<HTMLElement | null> }) {
  const pathname = usePathname();
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const followed = useRef(false);
  const [query, setQuery] = useState("");
  const dialogRef: RefObject<HTMLDivElement | null> = useAccessibleDialog<HTMLDivElement>(true, onClose, {
    initialFocus: () => inputRef.current,
    returnFocus: (opener) => (followed.current ? null : returnTo.current ?? opener),
  });
  const shown = useMemo(
    () => filterClubsByNameChurchOrCity(clubs.map((club) => ({ ...club, sponsoringChurch: club.church })), query),
    [clubs, query],
  );
  return createPortal(
    <>
      <div aria-hidden="true" className={styles.scrim} onClick={onClose} />
      <div aria-labelledby={titleId} aria-modal="true" className={styles.dialog} ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className={styles.head}>
          <h2 id={titleId}>Switch club</h2>
          <button className={`secondary-button ${styles.close}`} onClick={onClose} type="button"><X aria-hidden="true" size={18} /><span>Close</span></button>
        </div>
        <div className={styles.search}>
          <label htmlFor={inputId}>Search clubs</label>
          <div className={`search-field ${styles.box}`}>
            <Search aria-hidden="true" size={16} />
            <input
              autoComplete="off"
              id={inputId}
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Club or church"
              ref={inputRef}
              type="search"
              value={query}
            />
          </div>
          <p className={styles.count} role="status">{shown.length} of {clubs.length} {clubs.length === 1 ? "club" : "clubs"}</p>
        </div>
        <div className={styles.body}>
          {shown.length === 0 ? (
            <p className={styles.empty}>No club or church matches “{query.trim()}”.</p>
          ) : (
            <ul>
              {shown.map((club) => {
                const current = club.id === currentId;
                return (
                  <li key={club.id}>
                    <Link
                      aria-current={current ? "true" : undefined}
                      className={styles.item}
                      href={own.includes(club.id) ? coordinatorClubHref(club.id, new Set(own)) : switchClubHref(pathname, club.id)}
                      onClick={(event) => {
                        if (!isPlainClick(event.nativeEvent)) return;
                        followed.current = true;
                        onClose();
                      }}
                      prefetch={false}
                    >
                      <span translate="no">{club.name}</span>
                      {club.church && <small translate="no">{club.church}</small>}
                      {current && <small>Current club</small>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
