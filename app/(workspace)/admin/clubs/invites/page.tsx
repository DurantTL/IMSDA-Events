import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { permanentRedirect, redirect } from "next/navigation";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { clubLeadersHref, parseLeaderFilters } from "@/modules/system-admin/club-leaders-model";

export const metadata: Metadata = { title: "Club leaders" };
export const dynamic = "force-dynamic";

/**
 * Club invites became the Invited view of Club leaders (#1589). The old address keeps working: it asks the same sign-in and
 * Clubs administration questions as before, then moves permanently to the list, keeping a `club` filter when there is one.
 */
export default async function ClubInvitesPage({ searchParams }: { searchParams: Promise<{ club?: string | string[] }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { club } = await searchParams;
  permanentRedirect(clubLeadersHref({ ...parseLeaderFilters({ club }), role: null, status: "invited" }));
}
