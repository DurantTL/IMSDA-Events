"use client";

import { CalendarDays, ShieldCheck, Tent } from "lucide-react";
import { adminRoleSwitchHref } from "@/components/admin-role-switcher";
import { handleGuardedLinkClick } from "@/components/link-guard";
import { withCurrentEvent } from "@/components/staff-navigation";
import { staffWorkspaceRoles, type StaffWorkspace } from "@/components/staff-workspace-model";
import type { AdminRole, AdminRoleCounts } from "@/modules/access/admin-roles-domain";
import styles from "./staff-workspace-switcher.module.css";

const choices = [
  { workspace: "events", label: "Events", icon: CalendarDays },
  { workspace: "clubs", label: "Clubs", icon: Tent },
  { workspace: "system", label: "System", icon: ShieldCheck },
] as const;

export function StaffWorkspaceSwitcher({ held, counts, active, eventId, hasEvents }: {
  held: readonly AdminRole[];
  counts: AdminRoleCounts;
  active: StaffWorkspace;
  eventId: string;
  hasEvents: boolean;
}) {
  const visible = choices.filter((choice) => held.includes(staffWorkspaceRoles[choice.workspace]) || (choice.workspace === "events" && hasEvents));
  if (!visible.length) return null;
  return (
    <nav className={styles.switcher} aria-label="Workspace selection">
      <p className={styles.heading}>Workspace</p>
      {visible.map(({ workspace, label, icon: Icon }) => {
        const role = staffWorkspaceRoles[workspace];
        const href = held.includes(role) ? adminRoleSwitchHref(role) : withCurrentEvent("/overview", eventId);
        const count = counts[role];
        return (
          <a key={workspace} href={href} className={styles.choice} aria-current={workspace === active ? "true" : undefined} title={`${label} workspace`}
            onClick={(event) => handleGuardedLinkClick({ event, run: () => window.location.assign(href) })}>
            <Icon size={19} aria-hidden="true" />
            <span className={styles.label}>{label}</span>
            {typeof count === "number" && count > 0 && <span className={`count-badge ${styles.count}`}><span aria-hidden="true">{count > 99 ? "99+" : count}</span><span className="sr-only">{count} waiting</span></span>}
          </a>
        );
      })}
    </nav>
  );
}
