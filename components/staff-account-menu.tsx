"use client";

import { GuardedLink } from "@/components/guarded-link";
import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, CalendarPlus, CircleUserRound, Eye, ShieldCheck, Users, UserRound } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import type { WorkspaceSwitchOption } from "@/modules/access/workspace-contexts";

/** The one profile page for every account (#543): profile, two-step and passkeys. */
export const PROFILE_HREF = "/profile";

/**
 * The staff account popover (#543): name and email, Edit profile (the
 * event-independent `/profile` page, where two-step and passkeys live), the
 * workspace switcher (#1565, #108: only the workspaces this person holds, with no
 * second sign-in; see `staffWorkspaceOptions`), and Sign out. It is a disclosure, not an ARIA menu: Escape and outside clicks
 * close it, and Escape returns focus to the trigger.
 */
export function StaffAccountMenu({
  attendeePreviewHref,
  createEventHref,
  defaultOpen = false,
  displayName,
  email,
  workspaces = [],
}: {
  attendeePreviewHref: string;
  /** Create event (#966): given only to system administrators, the only people who can open that page. */
  createEventHref?: string;
  /** Render the menu already open (used by render tests). */
  defaultOpen?: boolean;
  displayName: string;
  email: string;
  /** The workspaces this person holds (`staffWorkspaceOptions`); the switcher shows when there is more than one. */
  workspaces?: readonly WorkspaceSwitchOption[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        aria-controls="staff-account-menu"
        aria-expanded={open}
        aria-label="Staff account"
        className="avatar"
        onClick={() => setOpen(!open)}
        ref={triggerRef}
        type="button"
      >
        <CircleUserRound aria-hidden="true" size={19} />
      </button>
      {open && (
        <div aria-label="Staff account menu" className="header-popover account-popover" id="staff-account-menu" role="group">
          <strong>{displayName}</strong><p>{email}</p><small>Database-backed staff session</small>
          <GuardedLink className="account-system-link" href={PROFILE_HREF} onNavigate={close}>
            <UserRound aria-hidden="true" size={17} />
            Edit profile
          </GuardedLink>
          {workspaces.length > 1 && (
            <div role="group" aria-label="Switch workspace" className="account-workspaces">
              <small className="account-workspaces-heading">Switch workspace</small>
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
