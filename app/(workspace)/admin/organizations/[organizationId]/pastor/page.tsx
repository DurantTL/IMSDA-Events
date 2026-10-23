import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { ChurchPastorContact } from "@/components/church-pastor-contact";
import { getCurrentSession } from "@/modules/access/current-session";
import { getChurchPastorContactView } from "@/modules/organizations/contacts-repository";

export const metadata: Metadata = { title: "Pastor contact" };

/** Conference staff keep a church's pastor contact (#977). Not the billing contact, and nothing is sent to it. System administrators only. */
export default async function StaffChurchPastorContactPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const { organizationId } = await params;
  const view = await getChurchPastorContactView(organizationId, { id: user.id, globalRole: user.globalRole });
  if (!view) notFound();
  return (
    <section className="page-stack">
      <BackLink href="/admin/organizations/directory" variant="staff">Back to the directory</BackLink>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Church contacts</p>
          <h2>Pastor contact for {view.organization.name}</h2>
          <p>
            The church&apos;s pastor, kept with dates and history. This is not the billing contact: the treasurer is the billing
            contact and invoices go there. Nothing is sent to the pastor from this record.
          </p>
        </div>
      </div>
      <ChurchPastorContact active={view.active} history={view.history} organizationId={view.organization.id} />
    </section>
  );
}
