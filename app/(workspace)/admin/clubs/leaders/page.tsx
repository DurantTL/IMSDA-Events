import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { ClubLeadersList } from "@/components/club-leaders-list";
import { StaffPageHeader } from "@/components/staff-page-header";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { clubRoleText } from "@/modules/access/role-descriptions";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { listClubLeaders } from "@/modules/system-admin/club-leaders";
import { parseLeaderFilters } from "@/modules/system-admin/club-leaders-model";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { listClubOptions } from "@/modules/system-admin/people-directory";

export const metadata: Metadata = { title: "Club leaders" };
export const dynamic = "force-dynamic";

/** Every current Director, Deputy, Registrar and Reporter across clubs (#1277). Read only; gated like the Clubs dashboard. */
export default async function ClubLeadersPage({
  searchParams,
}: {
  searchParams: Promise<{ club?: string | string[]; role?: string | string[] }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const filters = parseLeaderFilters(await searchParams);
  const [leaders, clubs, viewer] = await Promise.all([listClubLeaders(filters), listClubOptions(), resolvePeopleViewer()]);
  return (
    <>
      <AdminPageHeader path="/admin/clubs/leaders" />
      <StaffPageHeader description={`Everyone who currently leads a club as ${clubRoleText.DIRECTOR.name}, ${clubRoleText.DEPUTY.name}, ${clubRoleText.REGISTRAR.name} or ${clubRoleText.REPORTER.name}.`} />
      <ClubLeadersList canOpenPeople={viewer.scope !== null} clubs={clubs} filters={filters} leaders={leaders} />
    </>
  );
}
