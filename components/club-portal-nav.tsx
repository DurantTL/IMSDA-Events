"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { isAccountNavItemActive, type AccountNavItem } from "@/components/account-section-nav";

/**
 * The club shell's primary navigation (#1165): the first destinations as
 * links and a More disclosure for the rest. More is a button that opens a
 * list of links: Escape closes it and returns focus to the button, Tab out
 * or a click elsewhere closes it, and when the current page is one of its
 * links the button names it, so the location stays visible while closed.
 * The links only mirror what the server already allowed for this role.
 */
export function ClubPortalNav({
  primary,
  more,
  label = "Club",
}: {
  primary: AccountNavItem[];
  more: AccountNavItem[];
  label?: string;
}) {
  const pathname = usePathname();
  // Open for one page only: following a link in the list lands on a new pathname, which starts with More closed.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => setOpenFor((current) => ((typeof next === "function" ? next(current === pathname) : next) ? pathname : null));
  const wrapRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const currentMore = more.find((item) => isAccountNavItemActive(pathname, item));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpenFor(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <nav aria-label={label} className="club-primary-nav">
      <ul>
        {primary.map((item) => (
          <li key={item.href}>
            <Link aria-current={isAccountNavItemActive(pathname, item) ? "page" : undefined} href={item.href}>{item.label}</Link>
          </li>
        ))}
        {more.length > 0 && (
          <li
            className="club-more"
            onBlur={(event) => {
              if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                buttonRef.current?.focus();
              }
            }}
            ref={wrapRef}
          >
            <button
              aria-controls={menuId}
              aria-expanded={open}
              className={currentMore ? "club-more-button is-current" : "club-more-button"}
              onClick={() => setOpen((value) => !value)}
              ref={buttonRef}
              type="button"
            >
              <span className="club-more-label">More<ChevronDown aria-hidden="true" size={16} /></span>
              {currentMore && <span className="club-more-current"><span className="club-nav-sr"> (current page: </span>{currentMore.label}<span className="club-nav-sr">)</span></span>}
            </button>
            <ul className="club-more-menu" hidden={!open} id={menuId}>
              {more.map((item) => (
                <li key={item.href}>
                  <Link aria-current={isAccountNavItemActive(pathname, item) ? "page" : undefined} href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </nav>
  );
}
