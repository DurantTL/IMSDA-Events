import { notFound } from "next/navigation";
import { CoordinatorShellHeader } from "@/components/coordinator-shell-header";
import { currentAreaCoordinatorViewerActive, requireSecondStepForAreaCoordinator } from "@/modules/organizations/area-coordinators";

/** The Area Coordinator's Clubs section (#657): its own menu, view only, nothing for anyone but a coordinator. */
export default async function AreaClubsLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentAreaCoordinatorViewerActive())) {
    // A coordinator without a real second step in this session is sent to the club gate, not shown a 404 (#1410).
    await requireSecondStepForAreaCoordinator();
    notFound();
  }
  return (
    <>
      <CoordinatorShellHeader>
        <section className="public-registration-hero public-manage-hero account-page-hero">
          <div>
            <p className="public-registration-eyebrow">Area Coordinator · view only</p>
            <h1>Clubs</h1>
          </div>
        </section>
      </CoordinatorShellHeader>
      <div className="account-page-body">{children}</div>
    </>
  );
}
