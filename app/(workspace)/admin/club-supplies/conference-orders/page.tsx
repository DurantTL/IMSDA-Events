import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { ConferenceClubOrdersWorkspace } from "@/components/conference-club-orders-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { loadConferenceOrdersForStaff } from "@/modules/club-orders/conference-repository";

export const metadata: Metadata = { title: "Conference club orders" };
export const dynamic = "force-dynamic";

/**
 * Conference club orders (#1688): the patches and pins clubs ordered from the youth department. System administrators and Clubs
 * Administrators (#1232) see them, the same gate as the club supply catalog; they mark an order filled (postage, church bill,
 * optional club stock) or cancelled with a reason.
 */
export default async function ConferenceClubOrdersPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { orders, bills } = await loadConferenceOrdersForStaff();
  return (
    <>
      <AdminPageHeader path="/admin/club-supplies/conference-orders" />
      <section className="page-stack">
        <div className="page-intro">
          <div>
            <p className="eyebrow">Club supplies</p>
            <h1>Conference club orders</h1>
            <p>Patches and pins clubs ordered from the conference, billed to their churches.</p>
          </div>
        </div>
        <ConferenceClubOrdersWorkspace bills={bills} orders={orders} />
      </section>
    </>
  );
}
