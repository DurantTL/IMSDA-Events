import { findPortalGuide, portalDestinations, portalGuides } from "@/modules/help/portal-guides";
import type { PortalAudience, PortalDestination, PortalGuide } from "@/modules/help/types";
import { clubCapabilities, type ClubRole } from "@/modules/organizations/director-grants-domain";

/**
 * Who may see which portal guide (#1259). Decided on the server from the same checks the account portal layout
 * uses (the signed-in account, `listDirectedClubs`, `isAreaCoordinator`, and a staff "act as"). Nothing here grants
 * access: every portal page checks for itself. A guide the viewer may not see is not listed and not opened, and
 * asking for its id answers exactly like an id that does not exist.
 */
export type PortalHelpViewer = {
  /** The person's own attendee account is in use (not a staff "act as" with no account, and not a pending second step). */
  hasAccount: boolean;
  /** Clubs the account directs right now, with the role held. */
  directedClubs: readonly { organizationId: string; role: ClubRole }[];
  isAreaCoordinator: boolean;
  /** A staff "act as" (#442): they get the guide for the role they are acting as, and nothing else. */
  acting: { role: "CLUB_DIRECTOR"; organizationId: string | null } | { role: "AREA_COORDINATOR" } | null;
};

/** The audiences this viewer belongs to. A staff "act as" belongs only to the acted role's audience. */
export function portalAudiences(viewer: PortalHelpViewer): PortalAudience[] {
  const audiences: PortalAudience[] = [];
  if (viewer.hasAccount) audiences.push("attendee");
  if ((viewer.hasAccount && viewer.directedClubs.length > 0) || viewer.acting?.role === "CLUB_DIRECTOR") audiences.push("director");
  if ((viewer.hasAccount && viewer.isAreaCoordinator) || viewer.acting?.role === "AREA_COORDINATOR") audiences.push("coordinator");
  return audiences;
}

export function canSeePortalGuide(guide: Pick<PortalGuide, "audience">, viewer: PortalHelpViewer): boolean {
  return portalAudiences(viewer).includes(guide.audience);
}

export function visiblePortalGuides(viewer: PortalHelpViewer): PortalGuide[] {
  const audiences = portalAudiences(viewer);
  return portalGuides.filter((guide) => audiences.includes(guide.audience));
}

/** The guide for an id, only when this viewer may see it. Unknown and hidden look the same: `undefined`. */
export function portalGuideForViewer(id: string, viewer: PortalHelpViewer): PortalGuide | undefined {
  const guide = findPortalGuide(id);
  return guide && canSeePortalGuide(guide, viewer) ? guide : undefined;
}

export type PortalGuideLink = { id: string; label: string; href: string };

/** The one line shown where a page is not linked. It never names the page. */
export const portalUnavailableText = "Some pages in this guide are not open to your account, so they are not linked here.";

/** The club chooser: the page that lists the clubs the viewer can open. */
const clubChooserPath = "/account/clubs";

type ClubChoice = { kind: "one"; organizationId: string; role: ClubRole } | { kind: "several"; roles: ClubRole[] } | { kind: "none" };

function clubChoice(viewer: PortalHelpViewer): ClubChoice {
  // A staff "act as" director has exactly one club and the director's access.
  if (viewer.acting?.role === "CLUB_DIRECTOR") {
    return viewer.acting.organizationId ? { kind: "one", organizationId: viewer.acting.organizationId, role: "DIRECTOR" } : { kind: "none" };
  }
  if (!viewer.hasAccount) return { kind: "none" };
  if (viewer.directedClubs.length === 1) return { kind: "one", ...viewer.directedClubs[0]! };
  if (viewer.directedClubs.length > 1) return { kind: "several", roles: viewer.directedClubs.map((club) => club.role) };
  return { kind: "none" };
}

function resolveClubLink(destination: PortalDestination, viewer: PortalHelpViewer): { href: string; label: string } | null {
  const choice = clubChoice(viewer);
  const allowed = (role: ClubRole) => !destination.capability || clubCapabilities(role)[destination.capability];
  if (choice.kind === "one") {
    return allowed(choice.role) ? { href: destination.path.replace("[organizationId]", encodeURIComponent(choice.organizationId)), label: destination.label } : null;
  }
  // Several clubs: never guess one. The chooser lists them, and only when some role could use the page.
  if (choice.kind === "several" && choice.roles.some(allowed)) return { href: clubChooserPath, label: "Choose your club" };
  return null;
}

/**
 * The portal pages of a guide this viewer can open. A page whose path holds `[organizationId]` resolves to the
 * viewer's own club only when they direct exactly one (or act as one); with several it links to the club chooser,
 * and with none it is left out. A page for another audience, or one the viewer's club role does not allow, is only
 * counted, never named.
 */
export function portalGuideLinksForViewer(guide: PortalGuide, viewer: PortalHelpViewer): { links: PortalGuideLink[]; unavailable: number } {
  const audiences = portalAudiences(viewer);
  const links: PortalGuideLink[] = [];
  const seen = new Set<string>();
  let unavailable = 0;
  for (const id of guide.destinationIds) {
    const destination = portalDestinations[id];
    if (!destination) continue;
    let link: { href: string; label: string } | null = null;
    if (audiences.includes(destination.audience)) {
      link = destination.path.includes("[organizationId]") ? resolveClubLink(destination, viewer) : { href: destination.path, label: destination.label };
    }
    // A coordinator's club list is the same page the director's chooser is; do not offer it twice.
    if (link && !seen.has(link.href)) {
      seen.add(link.href);
      links.push({ id, ...link });
    } else if (!link) unavailable += 1;
  }
  return { links, unavailable };
}
