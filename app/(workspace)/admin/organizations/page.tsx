import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrganizationDirectoryWorkspace } from "@/components/organization-directory-workspace";
import { OrganizationActionProvider, OrganizationHeaderButton } from "@/components/organization-header-action";
import { ListPage } from "@/components/page-templates/list-page";
import { getCurrentSession } from "@/modules/access/current-session";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { getOrganizationSummary, listSponsorOptions, listOrganizationsPage } from "@/modules/organizations/repository";
import { cleanSearchQuery } from "@/modules/organizations/search";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { parseLeadingPageParam } from "@/lib/pagination";

export const metadata: Metadata = { title: "Clubs and churches" };

/**
 * The page's Tools menu (#981). Monthly Records, Club summary, Member transfers, New club
 * applications and Sterling Volunteers have their own places in System management, so they are not
 * repeated here; these are the sub-pages that are not listed there.
 */
function organizationTools(healthImport: boolean): { href: string; label: string }[] {
  return [
    { href: "/admin/clubs/import", label: "Import clubs" },
    ...(healthImport ? [{ href: "/admin/clubs/health-import", label: "Import health records" }] : []),
    { href: "/admin/organizations/directory", label: "Organization directory" },
    { href: "/admin/organizations/import", label: "Import from eAdventist" },
  ];
}

const statuses = ["ACTIVE", "INACTIVE"] as const;

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; q?: string; page?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");

  const params = await searchParams;
  const kind = params.kind === "CHURCH" || params.kind === "CLUB" ? params.kind : null;
  const status = statuses.find((candidate) => candidate === params.status) ?? "ALL";
  const query = cleanSearchQuery(params.q);
  const [list, summary, sponsorOptions] = await Promise.all([
    listOrganizationsPage({ query, kind, status, page: parseLeadingPageParam(params.page) }),
    getOrganizationSummary(),
    listSponsorOptions(),
  ]);

  return (
    <>
      <AdminSectionHeaderFor path="/admin/organizations" section="system" />
      <OrganizationActionProvider>
        <ListPage
          header={{
            title: "Clubs and churches",
            description: "Churches and the clubs each one sponsors, shared with events, club rosters and billing, with provider identifiers kept apart from names so later syncs do not guess.",
            primary: <OrganizationHeaderButton icon="add" label="Add church or club" />,
            tools: organizationTools(healthRecordsEnabled()),
          }}
        >
          <OrganizationDirectoryWorkspace
            sponsorOptions={sponsorOptions}
            filters={{ q: query, kind: kind ?? "", status }}
            organizations={list.organizations}
            page={list.page}
            pageSize={list.pageSize}
            summary={summary}
            total={list.total}
          />
        </ListPage>
      </OrganizationActionProvider>
    </>
  );
}
