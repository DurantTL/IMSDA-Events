"use client";

import { usePathname } from "next/navigation";
import { ChevronDown, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavigationLink } from "@/components/navigation-link";
import type { AccountNavItem } from "@/components/account-section-nav";
import { isAccountNavItemActive } from "@/components/account-nav-model";

/** Receives only the account destinations the server has already allowed. */
export function AccountWorkspaceMenu({ items }: { items: AccountNavItem[] }) {
  const pathname = usePathname();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <div className="account-workspace-menu">
      <details ref={details} onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
      }} onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          event.preventDefault();
          details.current.open = false;
          details.current.querySelector("summary")?.focus();
        }
      }}>
        <summary><UserRound aria-hidden="true" size={18} /> Your account <ChevronDown aria-hidden="true" size={16} /></summary>
        <nav aria-label="Your account destinations">
          <ul>
            {items.map((item) => <li key={item.href}>
              <NavigationLink href={item.href} prefetch={false} aria-current={isAccountNavItemActive(pathname, item) ? "page" : undefined} onClick={() => { if (details.current) details.current.open = false; }}>
                {item.href === "/account" ? "Account overview" : item.label}
              </NavigationLink>
            </li>)}
          </ul>
        </nav>
      </details>
    </div>
  );
}
