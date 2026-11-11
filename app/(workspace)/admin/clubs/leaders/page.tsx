import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { ClubLeadersList } from "@/components/club-leaders-list";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { parsePageParam, sliceFromCount } from "@/lib/pagination";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { countDraftClubInvites, listClubLeaderInvites, listClubLeaders } from "@/modules/system-admin/club-leaders";
import { clubLeadersHref, parseLeaderFilters } from "@/modules/system-admin/club-leaders-model";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { listClubOptions } from "@/modules/system-admin/people-directory";

export const metadata: Metadata = { title: "Club leaders" };
export const dynamic = "force-dynamic";

/** Club leaders (#1277, #1589): current Directors, Deputies, Registrars and Reporters, or the invites still waiting (Invited) or not sent (Draft). Gated like the Clubs dashboard; the invite actions keep their own route checks. */
export default async function ClubLeadersPage({
  searchParams,
}: {
  searchParams: Promise<{ club?: string | string[]; role?: string | string[]; status?: string | string[]; page?: string }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const query = await searchParams;
  const filters = parseLeaderFilters(query);
  const page = parsePageParam(query.page);
  const invitesView = filters.status !== "current";
  const [current, invited, drafts, clubs, viewer] = await Promise.all([
    invitesView ? null : listClubLeaders(filters, page),
    invitesView ? listClubLeaderInvites(filters, page) : null,
    filters.status === "draft" ? countDraftClubInvites(filters.clubId) : null,
    listClubOptions(),
    resolvePeopleViewer(),
  ]);
  const shown = invited ?? current!;
  const hrefFor = (next: number) => clubLeadersHref(filters, next);
  return (
    <>
      <AdminPageHeader path="/admin/clubs/leaders" />
      <ClubLeadersList
        canOpenPeople={viewer.scope !== null}
        clubs={clubs}
        drafts={drafts ?? undefined}
        emailConfigured={isAccountEmailConfigured()}
        filters={filters}
        hrefFor={hrefFor}
        invites={invited?.invites ?? []}
        leaders={current?.leaders ?? []}
        slice={sliceFromCount([...(invited?.invites ?? current?.leaders ?? [])], shown.page, shown.total, shown.pageSize)}
      />
    </>
  );
}
