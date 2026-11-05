import { adminSectionFor } from "@/components/admin-section-nav";
import { isSystemWorkspacePath } from "@/components/system-navigation";
import type { AdminRole } from "@/modules/access/admin-roles-domain";

export type StaffWorkspace = "events" | "clubs" | "system";

export const staffWorkspaceRoles: Record<StaffWorkspace, AdminRole> = {
  events: "EVENTS_ADMIN", clubs: "CLUBS_ADMIN", system: "SYSTEM_ADMIN",
};

/** Presentation only: roles and page guards still own authorization. */
export function staffWorkspaceFor(input: {
  pathname: string;
  activeRole: AdminRole | null;
  isSystemAdmin: boolean;
}): StaffWorkspace {
  const { pathname, activeRole, isSystemAdmin } = input;
  const section = adminSectionFor(pathname, { active: activeRole, systemAdmin: isSystemAdmin });
  if (section) return section;
  if (isSystemWorkspacePath(pathname)) return "system";
  // Help/profile keep the workspace from which they were opened.
  if (/^\/(help|profile)(\/|$)/.test(pathname)) {
    if (activeRole === "CLUBS_ADMIN") return "clubs";
    if (activeRole === "SYSTEM_ADMIN" && isSystemAdmin) return "system";
  }
  return "events";
}
