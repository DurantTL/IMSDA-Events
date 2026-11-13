"use client";

import { GuardedLink } from "@/components/guarded-link";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ArrowRightLeft, CalendarPlus, CircleUserRound, Eye, ShieldCheck, Users, UserRound, X } from "lucide-react";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { SignOutButton } from "@/components/sign-out-button";
import styles from "./staff-account-menu.module.css";
import type { WorkspaceSwitchOption } from "@/modules/access/workspace-contexts";

/** The one profile page for every account (#543): profile, two-step and passkeys. */
export const PROFILE_HREF = "/profile";

/**
 * The staff account popover (#543): name and email, Edit profile (the
 * event-independent `/profile` page, where two-step and passkeys live), the
 * workspace switcher (#1565, #108: only the workspaces this person holds, with no
 * second sign-in; see `staffWorkspaceOptions`), and Sign out. It is a disclosure, not an ARIA menu, drawn as a small labelled
 * dialog (#1566): a visible title and a Close button, focus moves in on open and stays in (Tab loops), Escape or Close puts
 * it back on the trigger, an outside press closes it, and a long list scrolls inside it (dvh) with Close always in view.
 */
export function StaffAccountMenu({
  attendeePreviewHref,
  createEventHref,
  defaultOpen = false,
  displayName,
  email,
  photoUrl = null,
  workspaces = [],
}: {
  attendeePreviewHref: string;
  /** Create event (#966): given only to system administrators, the only people who can open that page. */
  createEventHref?: string;
  /** Render the menu already open (used by render tests). */
  defaultOpen?: boolean;
  displayName: string;
  email: string;
  /** The person's profile photo thumbnail (#1640); without one the usual icon shows. */
  photoUrl?: string | null;
  /** The workspaces this person holds (`staffWorkspaceOptions`); the switcher shows when there is more than one. */
  workspaces?: readonly WorkspaceSwitchOption[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const titleId = useId();
  const close = () => setOpen(false);
  // Escape, Tab containment, first focus and focus return are the shared dialog behavior (use-accessible-dialog).
  const popoverRef: RefObject<HTMLDivElement | null> = useAccessibleDialog<HTMLDivElement>(open, close, {
    initialFocus: () => popoverRef.current?.querySelector<HTMLElement>("a[href], button:not([data-account-close])") ?? null,
    returnFocus: (opener) => triggerRef.current ?? opener,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        aria-controls="staff-account-menu"
        aria-expanded={open}
        aria-label="Staff account"
        className={`avatar ${styles.trigger}`}
        onClick={() => setOpen(!open)}
        ref={triggerRef}
        type="button"
      >
        {photoUrl
          // eslint-disable-next-line @next/next/no-img-element -- a signed-in route, not a static asset
          ? <img alt="" className={styles.photo} height={36} src={photoUrl} width={36} />
          : <CircleUserRound aria-hidden="true" size={19} />}
      </button>
      {open && (
        <div aria-labelledby={titleId} aria-modal="true" className={`header-popover account-popover ${styles.popover}`} id="staff-account-menu" ref={popoverRef} role="dialog" tabIndex={-1}>
          <div className={styles.head}>
            <h2 id={titleId}>Your account</h2>
            <button className={`secondary-button ${styles.close}`} data-account-close type="button" onClick={() => { close(); }}><X aria-hidden="true" size={18} /><span>Close</span></button>
          </div>
          {photoUrl ? (
            <div className={styles.identity}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in route, not a static asset */}
              <img alt="" className={styles.photoLarge} height={48} src={photoUrl} width={48} />
              <div><strong>{displayName}</strong><p>{email}</p></div>
            </div>
          ) : <><strong>{displayName}</strong><p>{email}</p></>}
          <small>Database-backed staff session</small>
          <GuardedLink className="account-system-link" href={PROFILE_HREF} onNavigate={close}>
            <UserRound aria-hidden="true" size={17} />
            Edit profile
          </GuardedLink>
          {workspaces.length > 1 && (
            <div role="group" aria-label="Switch workspace" className={styles.workspaces}>
              <small className={styles.heading}>Switch workspace</small>
              {workspaces.map((workspace) => workspace.method === "post" ? (
                <form action={workspace.href} className="account-switch-form" key={workspace.kind} method="post">
                  <button className="account-system-link account-switch-button" type="submit">
                    <ArrowRightLeft aria-hidden="true" size={17} />
                    {workspace.label}
                  </button>
                </form>
              ) : (
                <GuardedLink
                  aria-current={workspace.current ? "true" : undefined}
                  className="account-system-link"
                  href={workspace.href}
                  key={workspace.kind}
                  onNavigate={close}
                >
                  {workspace.kind === "system_admin" ? <ShieldCheck aria-hidden="true" size={17} /> : <Users aria-hidden="true" size={17} />}
                  {workspace.label}
                </GuardedLink>
              ))}
            </div>
          )}
          {createEventHref && (
            <GuardedLink className="account-system-link" href={createEventHref} onNavigate={close}>
              <CalendarPlus aria-hidden="true" size={17} />
              Create event
            </GuardedLink>
          )}
          <GuardedLink className="account-system-link" href={attendeePreviewHref} onNavigate={close}>
            <Eye aria-hidden="true" size={17} />
            Preview attendee experience
          </GuardedLink>
          <SignOutButton />
        </div>
      )}
    </div>
  );
}
