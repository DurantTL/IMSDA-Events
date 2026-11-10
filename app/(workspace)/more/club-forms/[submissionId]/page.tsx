import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { PageHeader } from "@/components/page-header";
import { ClubFormSubmissionView } from "@/components/club-form-submission-view";
import { PrintFormButton } from "@/components/club-forms-actions";
import { resolveStaffViewer } from "@/modules/club-forms/access";
import { ClubFormError } from "@/modules/club-forms/errors";
import { getSubmissionForViewer } from "@/modules/club-forms/submissions";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.clubForm };
export const dynamic = "force-dynamic";

/** One submitted club form for conference staff (#610). Opening one with sensitive answers is audited. */
export default async function StaffClubFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const [{ submissionId }, { event }] = await Promise.all([params, searchParams]);
  const viewer = await resolveStaffViewer();
  if (!viewer) {
    // The page draws its own title (#1573), so the restricted state keeps the page's one h1 too.
    return (
      <>
        <PageHeader title={staffPageTitles.clubForm} />
        <AccessRestricted detail="Club forms are for system administrators, Clubs Administrators and Event Admins of a current event." title="Club forms are restricted" whoToAsk="a system administrator" />
      </>
    );
  }
  const submission = await getSubmissionForViewer(viewer, submissionId).catch((error: unknown) => {
    if (error instanceof ClubFormError && error.code === "SUBMISSION_NOT_FOUND") return null;
    throw error;
  });
  if (!submission) notFound();

  return (
    <section className="page-stack club-form-page">
      {/* The wrapper is the class the print rules already hide, so the header (back link, title, Print) does not print. */}
      <div className="club-form-page-actions">
        <PageHeader
          back={{ href: `/more/club-forms${event ? `?event=${encodeURIComponent(event)}` : ""}`, label: "Back to submissions" }}
          secondary={<PrintFormButton />}
          title={staffPageTitles.clubForm}
        />
      </div>
      <ClubFormSubmissionView submission={submission} />
    </section>
  );
}
