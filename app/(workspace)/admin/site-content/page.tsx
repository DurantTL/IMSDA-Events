import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { SiteContentWorkspace } from "@/components/site-content-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { canManageSiteContent } from "@/modules/access/site-content-editor";
import { conferenceToday } from "@/modules/calendar/repository";
import { listFeaturableEvents } from "@/modules/events/featured";
import { getSiteContentAdminState } from "@/modules/site-content/hub-content";

export const metadata: Metadata = { title: "Homepage & site content" };
export const dynamic = "force-dynamic";

/** Edit, preview and publish the public homepage, notices, navigation and footer (#111). System administrators and Site content editors only. */
export default async function SiteContentPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await canManageSiteContent(user))) redirect("/no-access");
  const [state, events] = await Promise.all([getSiteContentAdminState(), listFeaturableEvents(conferenceToday())]);

  return (
    <>
      {user.globalRole === "SYSTEM_ADMIN" ? <AdminSectionHeaderFor path="/admin/site-content" section="system" /> : null}
      <SiteContentWorkspace
        draft={state.draft}
        draftDiffers={state.draftDiffers}
        events={events}
        history={state.history}
        initialContent={state.content}
        published={state.published}
      />
    </>
  );
}
