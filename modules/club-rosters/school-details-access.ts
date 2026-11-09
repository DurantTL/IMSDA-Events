/**
 * Whether this open roster access may see school type and church membership (#1668): the club's own director, deputy and
 * registrar, and a system administrator acting as director. Not a Clubs Administrator acting as director
 * (`viaClubsAdministrator` is only set when they are not also a system administrator): acting as director can edit, and
 * Clubs Administrators see these values view only, on the staff Open club page (#1758). Decided here, once, for every
 * director roster page and API route. Pure, so it needs no server-only module.
 */
export function rosterSchoolDetailsVisible(access: { actor: { kind: "ATTENDEE" } | { kind: "STAFF_ACTING"; viaClubsAdministrator?: true } }): boolean {
  return !(access.actor?.kind === "STAFF_ACTING" && access.actor.viaClubsAdministrator === true);
}
