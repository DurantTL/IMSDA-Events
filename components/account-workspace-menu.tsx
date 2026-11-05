"use client";

import { usePathname } from "next/navigation";
import { ChevronDown, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavigationLink } from "@/components/navigation-link";
import type { AccountNavItem } from "@/components/account-section-nav";
import { isAccountNavItemActive } from "@/components/account-nav-model";
import { useAccountWorkspaceItems } from "@/components/account-workspace-menu-context";
import mastheadStyles from "@/components/club-portal-masthead-view.module.css";
import styles from "@/components/account-workspace-menu.module.css";

/**
 * The "Your account" drop-down, rendered inside the club and coordinator masthead row (#1555). It shows only the account
 * destinations the portal layout already allowed (read from `AccountWorkspaceMenuProvider`, or passed as `items`), and
 * nothing when there are none.
 */
export function AccountWorkspaceMenu({ items }: { items?: AccountNavItem[] }) {
  const fromLayout = useAccountWorkspaceItems();
  const list = items ?? fromLayout;
  const pathname = usePathname();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  if (list.length === 0) return null;
  return (
    <details
      className={`account-workspace-menu ${styles.menu}`}
      data-account-workspace-menu=""
      ref={details}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          event.preventDefault();
          details.current.open = false;
          details.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className={`${mastheadStyles.action} ${styles.trigger}`}><UserRound aria-hidden="true" size={16} />Your account<ChevronDown aria-hidden="true" size={16} /></summary>
      <nav aria-label="Your account destinations" className={styles.panel}>
        <ul className={styles.list}>
          {list.map((item) => <li key={item.href}>
            <NavigationLink className={styles.link} href={item.href} prefetch={false} aria-current={isAccountNavItemActive(pathname, item) ? "page" : undefined} onClick={() => { if (details.current) details.current.open = false; }}>
              {item.href === "/account" ? "Account overview" : item.label}
            </NavigationLink>
          </li>)}
        </ul>
      </nav>
    </details>
  );
}
