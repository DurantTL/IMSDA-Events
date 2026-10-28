import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicHomePage } from "@/components/public-home-page";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { canManageSiteContent } from "@/modules/access/site-content-editor";
import { getDraftHubContent } from "@/modules/site-content/hub-content";
import styles from "@/components/site-content-workspace.module.css";

export const metadata: Metadata = { title: "Homepage & site content", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The public homepage drawn from the working draft (#111), with its notices, header links and footer. Nothing here is published. */
export default async function SiteContentPreviewPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await canManageSiteContent(user))) redirect("/no-access");
  const draft = await getDraftHubContent();
  if (!draft) redirect("/admin/site-content");

  return (
    <>
      <p className={styles.previewBar} role="status">
        Preview: not published. Visitors do not see this yet. <Link href="/admin/site-content">Back to editing</Link>
      </p>
      <PublicHomePage content={draft} preview />
    </>
  );
}
