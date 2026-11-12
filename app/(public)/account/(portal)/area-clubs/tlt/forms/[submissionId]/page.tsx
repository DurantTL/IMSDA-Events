import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClubFormSubmissionView } from "@/components/club-form-submission-view";
import { PrintFormButton } from "@/components/club-forms-actions";
import { NavigationLink as Link } from "@/components/navigation-link";
import { ClubFormError } from "@/modules/club-forms/errors";
import { getSubmissionForViewer } from "@/modules/club-forms/submissions";
import { currentTltFormsViewer } from "@/modules/tlt-directory/access";

export const metadata: Metadata = { title: "TLT form", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * One TLT form, answers in full (sensitive ones included), for the TLT director only (#1686). `getSubmissionForViewer`
 * limits her to the three TLT forms and writes one audit row for this opening before anything is returned. Any other
 * form, or any other person, is "not found".
 */
export default async function TltFormPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const viewer = await currentTltFormsViewer();
  if (!viewer) notFound();
  const { submissionId } = await params;
  const submission = await getSubmissionForViewer(viewer, submissionId, "VIEW").catch((error: unknown) => {
    if (error instanceof ClubFormError && error.code === "SUBMISSION_NOT_FOUND") return null;
    throw error;
  });
  if (!submission) notFound();
  return (
    <section className="page-stack club-form-page">
      <div className="club-form-page-actions">
        <Link className="secondary-button" href="/account/area-clubs/tlt/forms">Back to TLT forms</Link>
        <PrintFormButton />
      </div>
      <ClubFormSubmissionView submission={submission} />
    </section>
  );
}
