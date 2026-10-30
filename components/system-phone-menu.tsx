"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutDashboard, ShieldCheck, X } from "lucide-react";
import { DestinationSearch } from "@/components/destination-search";
import type { SearchDestination } from "@/components/destination-search-model";
import { GuardedLink } from "@/components/guarded-link";
import { desktopBreakpointQuery, isPlainClick } from "@/components/more-launcher-model";
import { guardedNavigate } from "@/components/unsaved-changes-registry";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import {
  systemMenuReturnsFocus,
  systemMenuStillAllowed,
  type SystemMenuCloseReason,
  type SystemMenuGroup,
  type WorkContextSwitch,
} from "@/components/work-context-model";

/**
 * The phone System menu (#1180). On a global System page the phone's bottom bar
 * is not the selected event's tabs: it names the System scope and opens a sheet
 * of the same authorized destinations the desktop System sidebar lists. The
 * sheet scrolls inside the available height, its Close control stays in view,
 * focus is visible, and focus returns to the opener when it closes. Links and
 * context switches run the unsaved-changes guard first. The shell only draws
 * this for a system administrator and the groups arrive already filtered; every
 * page keeps its own server authorization, and a role removed while the sheet
 * is open closes it on the next render.
 */

/** The page behind the sheet is inert while it is open, as in the More sheet. The bottom bar stays live for the opener. */
function setBackgroundInert(inert: boolean) {
  for (const element of document.querySelectorAll<HTMLElement>(".app-shell > .sidebar, .app-shell > .workspace")) {
    element.inert = inert;
  }
}

export function SystemPhoneMenu({
  isSystemAdmin,
  groups,
  switches,
  destinations = [],
}: {
  isSystemAdmin: boolean;
  /** The scope-aware destination search (#1177), kept at the top of the sheet as in the More sheet. */
  destinations?: readonly SearchDestination[];
  groups: readonly SystemMenuGroup[];
  /** The other contexts to switch into; get links are guarded, the post handoff submits its form after the guard. */
  switches: readonly WorkContextSwitch[];
}) {
  const allowed = systemMenuStillAllowed({ isSystemAdmin });
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedOn, setOpenedOn] = useState(pathname);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  // Why the sheet last closed, read when it has: focus goes back to the opener except after "navigate". A close nobody
  // asked for (a role removed, another page) leaves focus alone.
  const closeReason = useRef<SystemMenuCloseReason>("navigate");
  const titleId = useId();
  const sheetId = useId();

  const close = useCallback((reason: SystemMenuCloseReason) => {
    setBackgroundInert(false);
    closeReason.current = reason;
    setOpen(false);
  }, []);

  // A followed link or Back/Forward to another page closes the sheet. So does a role removed while it is
  // open (revalidated on the next render); the effect below then lifts `inert` as `showing` turns false.
  if (open && (openedOn !== pathname || !allowed)) setOpen(false);
  const showing = open && allowed;
  // Focus trap, Escape and focus return are the shared dialog's. Focus starts on the sheet itself, not the search field,
  // so a phone's keyboard stays closed.
  const sheetRef = useAccessibleDialog<HTMLDivElement>(showing, () => close("escape"), {
    initialFocus: "dialog",
    returnFocus: () => (systemMenuReturnsFocus(closeReason.current) ? triggerRef.current : null),
  });

  useEffect(() => {
    if (!showing) return;
    setBackgroundInert(true);
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (sheetRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      close("outside");
    }
    function onPopState() {
      close("navigate");
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("popstate", onPopState);
    // Rotating past the phone breakpoint hides the bar and sheet, so close it and lift `inert`.
    const desktop = typeof window.matchMedia === "function" ? window.matchMedia(desktopBreakpointQuery) : null;
    function onDesktop(event: MediaQueryListEvent) {
      if (event.matches) close("outside");
    }
    desktop?.addEventListener("change", onDesktop);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("popstate", onPopState);
      desktop?.removeEventListener("change", onDesktop);
      setBackgroundInert(false);
    };
  }, [showing, close, sheetRef]);

  if (!allowed) return null;

  return (
    <>
      <nav className="mobile-nav mobile-nav-system" aria-label="Mobile navigation">
        {/* A link, like the More tab: it falls back to the System home and its full task directory, and keeps the
            navigation bar a bar of links rather than an action bar. */}
        <GuardedLink
          ref={triggerRef}
          href="/admin"
          className={showing ? "mobile-nav-system-trigger active" : "mobile-nav-system-trigger"}
          aria-haspopup="dialog"
          aria-expanded={showing}
          aria-controls={showing ? sheetId : undefined}
          onClick={(event) => {
            if (!isPlainClick(event.nativeEvent)) return;
            event.preventDefault();
            if (showing) close("close");
            else { setOpenedOn(pathname); closeReason.current = "navigate"; setOpen(true); }
          }}
        >
          <ShieldCheck aria-hidden="true" size={22} />
          <span>System menu</span>
          <small>All events</small>
        </GuardedLink>
        {switches.filter((entry) => entry.method === "get").map((entry) => (
          <GuardedLink key={entry.kind} href={entry.href}>
            <LayoutDashboard aria-hidden="true" size={22} />
            <span>{entry.label}</span>
          </GuardedLink>
        ))}
      </nav>
      {showing && createPortal(
        <>
          <div className="system-menu-scrim" aria-hidden="true" />
          <div
            className="system-menu"
            id={sheetId}
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <div className="system-menu-head">
              <div>
                <h2 id={titleId}>System administration</h2>
                <p>All events. The selected event is kept for when you go back.</p>
              </div>
              <button type="button" className="system-menu-close" onClick={() => close("close")}>
                <X aria-hidden="true" size={18} />
                <span>Close</span>
              </button>
            </div>
            <div className="system-menu-body">
              {destinations.length > 0 && (
                <div className="system-menu-search">
                  <DestinationSearch destinations={destinations} escapeBubbles onNavigated={() => close("navigate")} />
                </div>
              )}
              {groups.map((group) => (
                <section className="system-menu-group" aria-labelledby={`${sheetId}-${group.key}`} key={group.key}>
                  <h3 id={`${sheetId}-${group.key}`}>{group.label}</h3>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.key}>
                        <GuardedLink
                          className={item.active ? "system-menu-item active" : "system-menu-item"}
                          href={item.href}
                          aria-current={item.active ? "page" : undefined}
                          onNavigate={() => close("navigate")}
                        >
                          {item.label}
                        </GuardedLink>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {switches.length > 0 && (
                <section className="system-menu-group" aria-labelledby={`${sheetId}-switch`}>
                  <h3 id={`${sheetId}-switch`}>Switch context</h3>
                  <ul>
                    {switches.map((entry) => (
                      <li key={entry.kind}>
                        {entry.method === "get" ? (
                          <GuardedLink className="system-menu-item" href={entry.href} onNavigate={() => close("navigate")}>{entry.label}</GuardedLink>
                        ) : (
                          <form action={entry.href} method="post" onSubmit={(event) => {
                            // The handoff is a form post; the guard asks first when a form has unsaved edits.
                            const form = event.currentTarget;
                            event.preventDefault();
                            guardedNavigate(() => form.submit());
                          }}>
                            <button type="submit" className="system-menu-item">{entry.label}</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
