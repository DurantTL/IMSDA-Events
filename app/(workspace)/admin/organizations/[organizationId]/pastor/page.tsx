import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { adminBackLink } from "@/components/admin-section-nav";
import { ChurchPastorContact } from "@/components/church-pastor-contact";
import { DetailPage } from "@/components/page-templates/detail-page";
import { getCurrentSession } from "@/modules/access/current-session";
import { getChurchPastorContactView } from "@/modules/organizations/contacts-repository";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Pastor contact" };

/** Conference staff keep a church's pastor contact (#977). Not the billing contact, and nothing is sent to it. System administrators only. */
export default async function StaffChurchPastorContactPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  const { organizationId } = await params;
  const view = await getChurchPastorContactView(organizationId, { id: user.id, globalRole: user.globalRole });
  if (!view) notFound();
  const path = `/admin/organizations/${organizationId}/pastor`;
  return (
    <>
      {/* The back link is the header's: one link, named for where it goes. */}
      <AdminSectionHeaderFor back={null} path={path} section="system" />
      <DetailPage
        header={{
          title: view.organization.name,
          exactName: true,
          eyebrow: "Pastor contact",
          description: "The church's pastor, kept with dates and history.",
          back: adminBackLink("system", path) ?? undefined,
        }}
        notices={(
          <p className="inline-notice" role="status">
            This is not the billing contact: the treasurer is the billing contact and invoices go there. The only email sent to the pastor is the optional baptism follow-up notice, for an event that has it turned on, when a club of this church names someone for baptism.
          </p>
        )}
      >
        <ChurchPastorContact active={view.active} history={view.history} organizationId={view.organization.id} />
      </DetailPage>
    </>
  );
}
