import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { renderPublicClubForms } from "@/components/public-club-forms-view";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getDraftPublicClubFormsSettings } from "@/modules/club-forms/public-index-settings";
import styles from "@/components/site-content-workspace.module.css";

export const metadata: Metadata = { title: "Public club forms page", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The public Club forms page drawn from the working draft (#1562). Nothing here is published. */
export default async function PublicClubFormsPreviewPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const draft = await getDraftPublicClubFormsSettings();
  if (!draft) redirect("/admin/club-forms/public-page");

  return (
    <>
      <p className={styles.previewBar} role="status">
        Preview: not published. Visitors do not see this yet. <Link href="/admin/club-forms/public-page">Back to editing</Link>
      </p>
      {await renderPublicClubForms(draft, { as: "div" })}
    </>
  );
}
