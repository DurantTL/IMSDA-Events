import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { PublicClubFormsSettings } from "@/components/public-club-forms-settings";
import { StaffPageHeader } from "@/components/staff-page-header";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getPublicClubFormsAdminState } from "@/modules/club-forms/public-index-settings";
import { publicClubFormGroups } from "@/modules/club-forms/public-index-domain";

export const metadata: Metadata = { title: "Public club forms page" };
export const dynamic = "force-dynamic";

/** Choose what the public Club forms page shows (#1562), with a draft, a preview and publish. Clubs Administrators and system administrators only. */
export default async function PublicClubFormsSettingsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const state = await getPublicClubFormsAdminState();

  return (
    <section className="page-stack">
      <AdminPageHeader path="/admin/club-forms/public-page" />
      <StaffPageHeader
        description="Choose which forms visitors see on the public Club forms page, the group and order they appear in, and the short line under each. Save a draft, preview it as the public sees it, then publish."
        primary={<Link className="secondary-button" href="/admin/club-forms">Back to club forms</Link>}
      />
      <PublicClubFormsSettings
        draftDiffers={state.draftDiffers}
        draftId={state.draftId}
        draftUpdatedAt={state.draftUpdatedAt}
        forms={publicClubFormGroups.flatMap((group) => group.items.map((item) => ({ id: item.id, name: item.name })))}
        groups={publicClubFormGroups.map((group) => ({ id: group.id, title: group.title }))}
        hasDraft={state.hasDraft}
        initial={state.content}
        publishedAt={state.publishedAt}
      />
    </section>
  );
}
