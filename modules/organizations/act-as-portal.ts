/**
 * Where "act as" lands (#1556): the portal page for the role being acted as, so staff go straight there without
 * passing through My account. Used by the start routes, the result button and the act-as banner alike. Pure and
 * client-safe; it only builds a link, so it grants nothing: the portal pages still check the act-as server-side.
 */
export const AREA_COORDINATOR_PORTAL_HREF = "/account/area-clubs/overview";

export function clubDirectorPortalHref(organizationId: string) {
  return `/account/clubs/${organizationId}`;
}

export function actAsPortalHref(role: "AREA_COORDINATOR" | "CLUB_DIRECTOR", organizationId: string | null) {
  if (role === "CLUB_DIRECTOR" && organizationId) return clubDirectorPortalHref(organizationId);
  return AREA_COORDINATOR_PORTAL_HREF;
}

export function actAsPortalLabel(role: "AREA_COORDINATOR" | "CLUB_DIRECTOR") {
  return role === "CLUB_DIRECTOR" ? "Open the club portal" : "Open the Area Coordinator portal";
}
