import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { adminBackLink } from "@/components/admin-section-nav";
import { OrganizationBillingContact } from "@/components/organization-billing-contact";
import { DetailPage } from "@/components/page-templates/detail-page";
import { getCurrentSession } from "@/modules/access/current-session";
import { getOrganizationBillingContactAdminView } from "@/modules/billing-responsibility/repository";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Billing contact" };

/**
 * Conference staff enter a church's billing contact (#165), usually its treasurer. It is kept
 * with effective dates and history and reused for every event that bills the organization.
 * System administrators only: event finance staff read it, never change it.
 */
export default async function StaffOrganizationBillingContactPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  const { organizationId } = await params;
  const view = await getOrganizationBillingContactAdminView(organizationId, { id: user.id, globalRole: user.globalRole });
  if (!view) notFound();
  const path = `/admin/organizations/${organizationId}/billing`;
  return (
    <>
      {/* The back link is the header's: one link, named for where it goes. */}
      <AdminSectionHeaderFor back={null} path={path} section="system" />
      <DetailPage
        header={{
          title: view.organization.name,
          exactName: true,
          eyebrow: "Billing contact",
          description: "Where invoices for this organization are sent after an event.",
          back: adminBackLink("system", path) ?? undefined,
        }}
        notices={(
          <p className="inline-notice" role="status">
            Entered here by conference staff, never taken from a form answer, an email address, the club director, or whoever submitted a
            registration. Event finance staff can see the current contact&apos;s name, role and email, but only you can change it.
          </p>
        )}
      >
        <OrganizationBillingContact active={view.active} history={view.history} organizationId={view.organization.id} />
      </DetailPage>
    </>
  );
}
