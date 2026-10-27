import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { ClubDirectorsWorkspace } from "@/components/club-directors-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { canAdministerClubOrganization } from "@/modules/organizations/access";
import { allowedReturnTo } from "@/lib/return-to";
import { listDirectorGrants } from "@/modules/organizations/director-grants-repository";
import { OrganizationOperationError } from "@/modules/organizations/repository";

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
  const clubHref = `/admin/organizations/${organizationId}/club`;
  const backHref = allowedReturnTo(from, [clubHref], user.globalRole === "SYSTEM_ADMIN" ? "/admin/organizations" : clubHref);
  const backLabel = backHref === clubHref ? `Back to ${initial.club.name}` : "Back to Clubs and churches";

  return (
    <>
      <BackLink href={backHref} variant="staff">{backLabel}</BackLink>
      <ClubDirectorsWorkspace club={initial.club} initialGrants={initial.grants} />
    </>
  );
}
