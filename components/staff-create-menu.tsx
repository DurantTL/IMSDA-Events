"use client";

import { Plus } from "lucide-react";
import { useRef } from "react";
import { GuardedLink } from "@/components/guarded-link";
import { createEventHrefFor } from "@/components/system-navigation";
import { withCurrentEvent } from "@/components/staff-navigation";
import styles from "./staff-create-menu.module.css";

/** Entries open existing creation pages; this menu never creates or publishes a record. */
export function StaffCreateMenu({ isSystemAdmin, clubFormsAccess, canManageForms, eventId }: {
  isSystemAdmin: boolean;
  clubFormsAccess: boolean;
  canManageForms: boolean;
  eventId: string;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const eventHref = createEventHrefFor(isSystemAdmin);
  const entries = [
    ...(eventHref ? [{ href: eventHref, label: "Create an event" }] : []),
    ...(clubFormsAccess ? [{ href: "/admin/club-forms", label: "Club form" }] : []),
    ...(eventId && canManageForms ? [
      { href: withCurrentEvent("/registration-builder", eventId), label: "Registration form" },
      { href: withCurrentEvent("/information-forms", eventId), label: "Event information form" },
    ] : []),
  ];
  if (!entries.length) return null;
  return (
    <details ref={menuRef} className={styles.menu} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }}>
      <summary className={`primary-button ${styles.trigger}`}><Plus size={17} aria-hidden="true" />Create</summary>
      <div className={styles.links}>
        {entries.map((entry) => <GuardedLink key={entry.href} href={entry.href} onNavigate={() => {
          const details = menuRef.current;
          if (details) details.open = false;
        }}>{entry.label}</GuardedLink>)}
      </div>
    </details>
  );
}
