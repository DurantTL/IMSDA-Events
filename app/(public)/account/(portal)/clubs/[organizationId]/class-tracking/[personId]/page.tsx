import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { MemberClassHistory } from "@/components/member-class-history";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { loadMemberClassHistory } from "@/modules/earned-awards/order-source";
import { clubAccessClosed } from "@/components/club-access-closed";

export const metadata: Metadata = { title: "Class history", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * One member's class history (#791): class completions and the class they are
 * working on. Someone with the roster role can also add, re-date and remove
 * completed classes (#1011); the routes enforce that again server-side. It opens on the same gate as the Class tracking page
 * (`getRosterAccessStateForPage`), and only for someone on this club's roster.
 */
export default async function MemberClassHistoryPage({ params }: { params: Promise<{ organizationId: string; personId: string }> }) {
  const { organizationId, personId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const history = await loadMemberClassHistory(organizationId, personId);
  if (!history) notFound();
  return (
    <>
      <BackLink href={`/account/clubs/${organizationId}/class-tracking`}>Back to class tracking</BackLink>
      <MemberClassHistory
        canEdit={access.capabilities.roster}
        history={history}
        nowIso={new Date().toISOString()}
        organizationId={organizationId}
        personId={personId}
      />
    </>
  );
}
