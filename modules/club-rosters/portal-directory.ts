import { paginate } from "@/lib/pagination";
import { filterClubsByNameChurchOrCity, parseClubQuery } from "@/modules/club-reports/area-summary-domain";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";

export type PortalDirectoryClub = {
  organizationId: string;
  name: string;
  sponsoringChurch: string | null;
  city?: string | null;
};

/** Only project clubs already read for the authorized viewer. No authority is inferred from search or URL state. */
export function portalClubDirectory(clubs: readonly PortalDirectoryClub[], ownRoles: ReadonlyMap<string, ClubRole>, query: string, page: number) {
  const matches = filterClubsByNameChurchOrCity([...clubs], parseClubQuery(query))
    .sort((a, b) => a.name.localeCompare(b.name) || a.organizationId.localeCompare(b.organizationId))
    .map((club) => {
      const role = ownRoles.get(club.organizationId);
      return {
        ...club,
        roleLabel: role ? clubDirectorRoleLabels[role] : "View only",
        href: `/account/${role ? "clubs" : "area"}/${encodeURIComponent(club.organizationId)}`,
      };
    });
  return paginate(matches, page, 12);
}

export function portalDirectoryHref(query: string, page = 1) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return `/account/clubs${params.size ? `?${params}` : ""}`;
}
