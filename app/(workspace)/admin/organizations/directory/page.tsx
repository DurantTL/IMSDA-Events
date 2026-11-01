import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, NoMatchesState } from "@/components/empty-state";
import { ListPager } from "@/components/list-pager";
import { ColumnHeader, SortOrderNote } from "@/components/list-sort";
import { OrganizationSearchControls } from "@/components/organization-search-controls";
import { cardCell } from "@/components/table-card-labels";
import { OrganizationStatusButton } from "@/components/organization-status-button";
import { getCurrentSession } from "@/modules/access/current-session";
import { listDirectoryContacts } from "@/modules/organizations/contacts-repository";
import { disbandedNotice, organizationKindLabels, safeWebsiteHref } from "@/modules/organizations/eadventist-import";
import { listDirectoryOrganizations, type DirectoryStatusFilter } from "@/modules/organizations/eadventist-import-repository";
import { cleanSearchQuery, listSearchParams } from "@/modules/organizations/search";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { serverSort, sortOrderText } from "@/lib/list-sort";
import { parseLeadingPageParam, sliceFromCount } from "@/lib/pagination";
import { DIRECTORY_DEFAULT_SORT, DIRECTORY_SORT_COLUMNS } from "@/modules/organizations/directory-sort";

export const metadata: Metadata = { title: "Organization directory" };

const kinds = Object.keys(organizationKindLabels).filter((kind) => kind !== "CLUB") as Array<keyof typeof organizationKindLabels>;
const statuses: Array<{ value: DirectoryStatusFilter; label: string }> = [
  { value: "ALL", label: "Any status" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "REVIEW", label: "Active, disbanded date on file" },
];

/** Staff list of churches, companies, groups, schools and the rest, by kind, status and search (#649, #723). */
export default async function OrganizationDirectoryPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; q?: string; page?: string; sort?: string; dir?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  const params = await searchParams;
  const kind = kinds.find((candidate) => candidate === params.kind) ?? null;
  const status = statuses.find((candidate) => candidate.value === params.status)?.value ?? "ALL";
  const query = cleanSearchQuery(params.q);
  // The sort is whitelisted and runs in the database, so every page is a slice of the whole sorted list (#1458).
  const sorting = serverSort("/admin/organizations/directory", params, DIRECTORY_SORT_COLUMNS, DIRECTORY_DEFAULT_SORT);
  const { organizations, total, page, pageSize } = await listDirectoryOrganizations({ kind, status, query, page: parseLeadingPageParam(params.page), sort: sorting.order });
  const contacts = await listDirectoryContacts(organizations.map((organization) => organization.id), { id: user.id, globalRole: user.globalRole });
  const state = { q: query, kind: kind ?? "", status, sort: params.sort && sorting.order.key ? sorting.order.key : "", dir: params.sort && sorting.order.key ? sorting.order.dir : "" };
  const pageHref = (next: number) => {
    const urlParams = listSearchParams({ q: query, kind, status, page: next });
    if (state.sort) { urlParams.set("sort", state.sort); urlParams.set("dir", state.dir); }
    const text = urlParams.toString();
    return text ? `/admin/organizations/directory?${text}` : "/admin/organizations/directory";
  };
  const orderLabels = { name: "name", kind: "kind", status: "status", place: "place", parent: "parent", contact: "contact phone" } as const;
  const searching = query.trim() !== "" || kind !== null || status !== "ALL";

  return (
    <>
      <AdminSectionHeaderFor path="/admin/organizations/directory" section="system" />
      <div className="intro-actions club-admin-links">
        <Link className="secondary-button" href="/admin/organizations/import">Import from eAdventist</Link>
        <Link className="secondary-button" href="/admin/organizations/map-locations">Find map locations</Link>
      </div>
      <section className="page-stack org-directory-page" aria-labelledby="org-directory-title">
        <div className="page-intro">
          <div>
            <p className="eyebrow">Clubs and churches</p>
            <h2 id="org-directory-title">Organization directory</h2>
            <p>
              Churches, companies and groups that are active appear in registration form church lists; active schools appear in school lists.
            </p>
          </div>
        </div>
        <div className="panel org-directory-panel">
          <OrganizationSearchControls
            basePath="/admin/organizations/directory"
            kindOptions={[{ value: "", label: "All kinds" }, ...kinds.map((value) => ({ value, label: organizationKindLabels[value] }))]}
            placeholder="Name, city, code, district or parent"
            searchLabel="Search"
            state={state}
            statusOptions={statuses}
          />
          <p className="org-result-summary" role="status">
            {total} {total === 1 ? "organization" : "organizations"}{searching ? " match" : ""}.
          </p>
          <div className="report-table-wrap">
            {state.sort && <SortOrderNote>{sortOrderText(orderLabels[sorting.order.key!], sorting.order.dir)}</SortOrderNote>}
            <table className="report-table table-cards table-cards-wide org-directory-table" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <ColumnHeader column="name" label="Name" sorting={sorting} />
                  <ColumnHeader column="kind" label="Kind" sorting={sorting} />
                  <ColumnHeader column="status" label="Status" sorting={sorting} />
                  <ColumnHeader column="place" label="Place" sorting={sorting} />
                  <ColumnHeader column="parent" label="Parent" sorting={sorting} />
                  <ColumnHeader column="contact" label="Contact" sorting={sorting} />
                  <th role="columnheader" scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {organizations.length === 0 && (
                  <tr role="row"><td colSpan={7} role="cell">
                    {searching
                      ? <NoMatchesState clear={{ href: "/admin/organizations/directory" }} className="empty-state" noun="organizations" query={query} />
                      : <EmptyState className="empty-state" title="No organizations yet">Import churches and schools from eAdventist to fill the directory.</EmptyState>}
                  </td></tr>
                )}
                {organizations.map((organization) => {
                  const notice = disbandedNotice(organization.disbandedOn, organization.isActive);
                  const href = safeWebsiteHref(organization.website);
                  const rowContacts = contacts.get(organization.id);
                  const place = [organization.city, organization.state].filter(Boolean).join(", ");
                  const kindLabel = organizationKindLabels[organization.type];
                  const subType = organization.sourceOrgType && organization.sourceOrgType !== kindLabel ? organization.sourceOrgType : null;
                  return (
                    <tr key={organization.id} role="row">
                      <th className="org-cell-name" role="rowheader" scope="row" translate="no">{organization.name}</th>
                      <td {...cardCell("Kind")}>
                        <span className="org-cell-main">{kindLabel}</span>
                        {subType && <span className="org-cell-sub">{subType}</span>}
                      </td>
                      <td {...cardCell("Status")}>
                        <span className={`status-chip ${organization.isActive ? "green" : "gold"}`}>{organization.isActive ? "Active" : "Inactive"}</span>
                        {notice && <span className="org-cell-sub">{notice}</span>}
                      </td>
                      <td {...cardCell("Place")}>
                        <span className="org-cell-main">{place || "—"}</span>
                        {organization.district && <span className="org-cell-sub">District: {organization.district}</span>}
                      </td>
                      <td {...cardCell("Parent")}>{organization.parentName ?? "—"}</td>
                      <td {...cardCell("Contact")}>
                        {organization.officePhone && <span className="org-cell-main">{organization.officePhone}</span>}
                        {href && <a className="org-cell-sub org-cell-link" href={href} rel="noopener noreferrer" target="_blank">Website</a>}
                        {organization.type === "CHURCH" && (
                          <>
                            <span className="org-cell-sub">Pastor: {rowContacts?.pastor ? rowContacts.pastor.name : "none on file"}</span>
                            <span className="org-cell-sub">Billing contact: {rowContacts?.billing ? `${rowContacts.billing.name} (${rowContacts.billing.roleLabel})` : "none on file"}</span>
                          </>
                        )}
                        {!organization.officePhone && !href && organization.type !== "CHURCH" && <span className="org-cell-main">—</span>}
                      </td>
                      <td {...cardCell(null)} className="org-cell-actions">
                        <OrganizationStatusButton isActive={organization.isActive} name={organization.name} organizationId={organization.id} />
                        {/* A company or group can sponsor a club (#822), so it is billed like a church and needs a billing contact. This page is system administrators only. */}
                        {organization.type === "CHURCH" && (
                          <Link
                            aria-label={`Pastor contact for ${organization.name}`}
                            className="secondary-button"
                            href={`/admin/organizations/${organization.id}/pastor`}
                          >
                            Pastor contact
                          </Link>
                        )}
                        {(organization.type === "CHURCH" || organization.type === "COMPANY" || organization.type === "GROUP") && (
                          <Link
                            aria-label={`Billing contact for ${organization.name}`}
                            className="secondary-button"
                            href={`/admin/organizations/${organization.id}/billing`}
                          >
                            Billing contact
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ListPager hrefFor={pageHref} label="Organization pages" noun="organizations" nounOne="organization" slice={sliceFromCount(organizations, page, total, pageSize)} />
        </div>
      </section>
    </>
  );
}
