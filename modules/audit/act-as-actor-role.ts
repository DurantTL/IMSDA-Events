/**
 * The `actorRole` an audit entry carries while a staff member acts as an Area Coordinator or club director (#1232, #1685):
 * Clubs Administrator or Youth Admin, and nothing for a system administrator. One place, so every writer labels the same way.
 */
export type ActAsRoleMarks = { viaClubsAdministrator?: true; viaYouthAdministrator?: true };

export type ActAsActorRole = "CLUBS_ADMINISTRATOR" | "YOUTH_ADMINISTRATOR";

export function actAsActorRoleFields(actor: ActAsRoleMarks): { actorRole?: ActAsActorRole } {
  if (actor.viaYouthAdministrator) return { actorRole: "YOUTH_ADMINISTRATOR" };
  return actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {};
}

/** The marker to carry onward from an acting context, so each builder copies both marks the same way. */
export function actAsRoleMarks(acting: ActAsRoleMarks): ActAsRoleMarks {
  return {
    ...(acting.viaClubsAdministrator ? { viaClubsAdministrator: true as const } : {}),
    ...(acting.viaYouthAdministrator ? { viaYouthAdministrator: true as const } : {}),
  };
}
