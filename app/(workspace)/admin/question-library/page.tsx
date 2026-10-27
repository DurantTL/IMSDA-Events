import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QuestionLibraryManager } from "@/components/question-library-manager";
import { getCurrentSession } from "@/modules/access/current-session";
import { listLibraryItemsForAdmin } from "@/modules/question-library/repository";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Question library" };
export const dynamic = "force-dynamic";

/**
 * The question library (#1070), for system administrators only (checked here, and again on every route this page calls).
 * Anyone who can build forms saves to it and adds from it in the form builder; only administrators rename or delete.
 * A saved question is not a form template, an event template or a ready-made module.
 */
export default async function AdminQuestionLibraryPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const items = await listLibraryItemsForAdmin();

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path="/admin/question-library" section="system" />
      <StaffPageHeader
        description="Saved questions that anyone building a form can add from the form builder. Adding one puts an independent copy on the form, so renaming or deleting one here never changes a form that already uses it or a published form."
      />
      <section className="panel"><QuestionLibraryManager items={items} /></section>
    </section>
  );
}
