import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { ListPage } from "@/components/page-templates/list-page";
import { ConferenceClubOrdersWorkspace } from "@/components/conference-club-orders-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { loadConferenceOrdersForStaff } from "@/modules/club-orders/conference-repository";
import { CLUB_KINDS, parseClubKindFilter } from "@/modules/organizations/club-kind";
import styles from "./conference-orders-page.module.css";

export const metadata: Metadata = { title: "Conference club orders" };
export const dynamic = "force-dynamic";

/**
 * Conference club orders (#1688): the patches and pins clubs ordered from the youth department. System administrators and Clubs
 * Administrators (#1232) see them, the same gate as the club supply catalog; they mark an order filled (postage, church bill,
 * optional club stock) or cancelled with a reason.
 */
export default async function ConferenceClubOrdersPage({ searchParams }: { searchParams?: Promise<{ clubType?: string | string[] }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  // "Club type" filter (#1517): `?clubType=pathfinder|adventurer`; anything else shows all clubs.
  const clubKind = parseClubKindFilter((await searchParams)?.clubType);
  const { orders, bills } = await loadConferenceOrdersForStaff(clubKind);
  const choices = [
    { label: "All", href: "/admin/club-supplies/conference-orders", current: clubKind === null },
    ...CLUB_KINDS.map((kind) => ({
      label: kind === "PATHFINDER" ? "Pathfinder" : "Adventurer",
      href: `/admin/club-supplies/conference-orders?clubType=${kind.toLowerCase()}`,
      current: clubKind === kind,
    })),
  ];
  return (
    <>
      <AdminPageHeader path="/admin/club-supplies/conference-orders" />
      <ListPage header={{ title: "Conference club orders", description: "Patches and pins clubs ordered from the conference, billed to their churches." }}>
        <nav aria-label="Club type" className={styles.filter} data-testid="conference-orders-club-type">
          <p className={styles.filterLabel}>Club type</p>
          <ul className={styles.choices}>
            {choices.map((choice) => (
              <li key={choice.label}>
                <Link aria-current={choice.current ? "page" : undefined} className={styles.choice} href={choice.href}>{choice.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <ConferenceClubOrdersWorkspace clubKind={clubKind} bills={bills} orders={orders} />
      </ListPage>
    </>
  );
}
