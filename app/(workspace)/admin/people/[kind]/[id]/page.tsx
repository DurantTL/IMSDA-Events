import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PersonAccess } from "@/components/person-access";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { ActAsButton } from "@/components/act-as-button";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getPersonDetail, listClubOptions, listEventOptions } from "@/modules/system-admin/people-directory";
import styles from "@/components/people-directory.module.css";

export const metadata: Metadata = { title: "People & access" };
export const dynamic = "force-dynamic";

export default async function PersonAccessPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const viewer = await resolvePeopleViewer();
  if (!viewer.user) redirect(await staffLoginRedirectPath());
  if (!viewer.scope) redirect("/no-access");
  const { kind, id } = await params;
  if ((kind !== "staff" && kind !== "account") || id.length > 64) notFound();
  const person = await getPersonDetail(kind, id, viewer.scope);
  if (!person) notFound();
  const full = viewer.scope === "full";
  const [eventOptions, clubOptions, linkedEmailChangesTogether] = await Promise.all([
    full ? listEventOptions() : [],
    listClubOptions(),
    full ? isUnifiedSignInEnabled() : false,
  ]);
  return (
    <>
      <StaffPageHeader
        description={<Link className={styles.back} href="/admin/people">Back to People &amp; access</Link>}
        primary={full ? (
          <ActAsButton
            access="View only"
            endpoint="/api/admin/act-as/area-coordinator"
            label="Act as Area Coordinator (2 hours)"
            resultAction="Open the coordinator view"
            role="Area Coordinator"
          />
        ) : undefined}
      />
      <PersonAccess
        clubOptions={clubOptions}
        eventOptions={eventOptions}
        linkedEmailChangesTogether={linkedEmailChangesTogether}
        person={person}
        scope={viewer.scope}
        viewerUserId={viewer.user.id}
      />
    </>
  );
}
