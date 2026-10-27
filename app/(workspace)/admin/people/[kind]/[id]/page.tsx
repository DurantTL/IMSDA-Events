import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PersonAccess } from "@/components/person-access";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { getPersonDetail } from "@/modules/system-admin/people-directory";
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
  return (
    <>
      <StaffPageHeader
        description={<Link className={styles.back} href="/admin/people">Back to People &amp; access</Link>}
      />
      <PersonAccess person={person} scope={viewer.scope} />
    </>
  );
}
