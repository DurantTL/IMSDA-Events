import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClubDirectorsWorkspace } from "@/components/club-directors-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { canAdministerClubOrganization } from "@/modules/organizations/access";
import { clubPageReturnHref } from "@/modules/club-reports/club-page-links";
import { listDirectorGrants } from "@/modules/organizations/director-grants-repository";
import { OrganizationOperationError } from "@/modules/organizations/repository";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Club directors" };

/**
 * Reached from the Clubs and churches directory or from the club's own
 * overview page (#428): the back link returns to whichever sent the visitor
 * here.
 */
export default async function ClubDirectorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const { organizationId } = await params;
  if (!(await canAdministerClubOrganization(user, organizationId))) redirect("/no-access");
  const { from } = await searchParams;
  let initial: Awaited<ReturnType<typeof listDirectorGrants>>;
  try {
    initial = await listDirectorGrants(organizationId);
  } catch (error) {
    if (error instanceof OrganizationOperationError) notFound();
    throw error;
  }
  const parentHref = clubPageReturnHref(from, organizationId);

  return (
    <>
      <AdminPageHeader path={`/admin/organizations/${organizationId}/directors`} parentName={initial.club.name} viaParent={parentHref !== null} back={parentHref ? { href: parentHref, label: `Back to ${initial.club.name}` } : undefined} />
      <ClubDirectorsWorkspace canOpenPeople={(await resolvePeopleViewer()).scope !== null} club={initial.club} initialGrants={initial.grants} />
    </>
  );
}
