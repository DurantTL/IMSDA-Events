import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrganizationDirectoryWorkspace } from "@/components/organization-directory-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { getOrganizationSummary, listSponsorOptions, listOrganizationsPage } from "@/modules/organizations/repository";
import { cleanSearchQuery, parsePageParam } from "@/modules/organizations/search";

export const metadata: Metadata = { title: "Clubs and churches" };

/**
 * The page's Tools menu (#981). Monthly Records, Club summary, Member transfers, New club
 * applications and Sterling Volunteers are System management sidebar items, so they are not
 * repeated here; these are the sub-pages the sidebar does not list.
 */
function organizationTools(healthImport: boolean): { href: string; label: string }[] {
  return [
    { href: "/admin/clubs/import", label: "Import clubs" },
    ...(healthImport ? [{ href: "/admin/clubs/health-import", label: "Import health records" }] : []),
    { href: "/admin/organizations/directory", label: "Organization directory" },
    { href: "/admin/organizations/import", label: "Import from eAdventist" },
    { href: "/admin/clubs/invites", label: "Club invites" },
  ];
}

const statuses = ["ACTIVE", "INACTIVE"] as const;

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; q?: string; page?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  const params = await searchParams;
  const kind = params.kind === "CHURCH" || params.kind === "CLUB" ? params.kind : null;
  const status = statuses.find((candidate) => candidate === params.status) ?? "ALL";
  const query = cleanSearchQuery(params.q);
  const [list, summary, sponsorOptions] = await Promise.all([
    listOrganizationsPage({ query, kind, status, page: parsePageParam(params.page) }),
    getOrganizationSummary(),
    listSponsorOptions(),
  ]);

  return (
    <>
      <OrganizationDirectoryWorkspace
        tools={organizationTools(healthRecordsEnabled())}
        sponsorOptions={sponsorOptions}
        filters={{ q: query, kind: kind ?? "", status }}
        organizations={list.organizations}
        page={list.page}
        pageSize={list.pageSize}
        summary={summary}
        total={list.total}
      />
    </>
  );
}
