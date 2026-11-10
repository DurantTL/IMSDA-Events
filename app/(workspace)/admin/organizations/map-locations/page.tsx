import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChurchMapLocationsWorkspace } from "@/components/church-map-locations-workspace";
import { OrganizationActionProvider, OrganizationHeaderButton } from "@/components/organization-header-action";
import { ListPage } from "@/components/page-templates/list-page";
import { geocodingEnabled } from "@/integrations/geocoding";
import { getCurrentSession } from "@/modules/access/current-session";
import { countGeocodableChurches, listGeocodeReview } from "@/modules/organizations/church-geocoding";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Find map locations" };

/** Staff-triggered lookup of church map points, with a review list (#724). System administrators only. */
export default async function ChurchMapLocationsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  const [eligible, items] = await Promise.all([countGeocodableChurches(), listGeocodeReview()]);
  return (
    <>
      <AdminSectionHeaderFor path="/admin/organizations/map-locations" section="system" />
      <OrganizationActionProvider>
        <ListPage header={{ title: "Find map locations", description: "Looks up map points for imported churches so their clubs appear on the public club map. Review each match before it is used.", primary: <OrganizationHeaderButton icon="map" label="Find map locations" /> }}>
          <ChurchMapLocationsWorkspace enabled={geocodingEnabled()} eligible={eligible} items={items} />
        </ListPage>
      </OrganizationActionProvider>
    </>
  );
}
