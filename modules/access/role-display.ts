import type { EventRole } from "@/modules/access/permissions";
import { eventRoleText } from "@/modules/access/role-descriptions";

/** Name and one-line summary of each event role, read from the shared wording (#1278). */
export const roleDetails = Object.fromEntries(
  (Object.keys(eventRoleText) as EventRole[]).map((role) => [role, { label: eventRoleText[role].name, description: eventRoleText[role].summary }]),
) as Record<EventRole, { label: string; description: string }>;

export function roleLabel(role: EventRole) {
  return roleDetails[role].label;
}
