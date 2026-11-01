import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getPrisma } from "@/lib/prisma";
import { SendClubFormLink } from "@/components/club-forms-actions";
import { resolveAreaCoordinatorViewer } from "@/modules/club-forms/access";
import { CLUB_FORM_LINK_DEFAULT_DAYS, viewerCanSendLinkForClub } from "@/modules/club-forms/domain";
import { listSubmissionsForViewer } from "@/modules/club-forms/submissions";
import { listEnabledClubFormTemplates } from "@/modules/club-forms/templates";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export const metadata: Metadata = { title: "Club forms", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "";
  return formatInConferenceTime(value, { month: "short", day: "numeric", year: "numeric" });
}

/** Any club's submitted forms, view only, for an Area Coordinator (#610). Sensitive answers are "Restricted". */
export default async function AreaClubFormsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const viewer = await resolveAreaCoordinatorViewer();
  if (!viewer) notFound();
  const { organizationId } = await params;
  const club = await getPrisma().organization.findUnique({
    where: { id: organizationId },
    select: { type: true, name: true, isActive: true },
  });
  if (!club || club.type !== "CLUB" || !club.isActive) notFound();
  const submissions = await listSubmissionsForViewer(viewer, { organizationId });
  // Forms that are turned off are not offered (#1221); the server refuses them too.
  const sendable = viewerCanSendLinkForClub(viewer, organizationId) ? await listEnabledClubFormTemplates() : [];

  return (
    <>
      {sendable.length > 0 && (
        <section className="public-manage-card club-forms-intro">
          <h2>Send a private link for this club</h2>
          <p className="field-help">
            Helping <span translate="no">{club.name}</span> with a form, such as the TLT forms. The link goes to one address, works once, and the
            filled form lands in this club&apos;s records, where its director sees it too.
          </p>
          {sendable.map((template) => (
            <div className="club-form-template" key={template.key}>
              <div>
                <h3>{template.name}</h3>
              </div>
              <div className="club-form-template-actions">
                <SendClubFormLink
                  asAreaCoordinator
                  defaultDays={CLUB_FORM_LINK_DEFAULT_DAYS}
                  formName={template.name}
                  organizationId={organizationId}
                  rosterMembers={[]}
                  templateKey={template.key}
                />
              </div>
            </div>
          ))}
        </section>
      )}
      <p className="field-help">
        Health, conduct, physician, emergency-contact and birth-date answers show as Restricted. Forms the conference has since switched off stay listed.
      </p>
      {submissions.length === 0 ? (
        <EmptyState className="empty-state panel" headingLevel={2} icon={<FileText aria-hidden="true" size={26} />} title="No submitted forms">This club has not submitted any forms yet.</EmptyState>
      ) : (
        <div className="report-table-wrap">
          <table className="report-table">
            <caption className="sr-only">Submitted forms</caption>
            <thead><tr><th scope="col">Form</th><th scope="col">Member or subject</th><th scope="col">Submitted</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {submissions.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.templateName}</th>
                  <td translate="no">{row.subjectName || "Not named"}</td>
                  <td>{formatDate(row.submittedAt)}</td>
                  <td><Link className="secondary-button" href={`/account/area/${organizationId}/forms/${row.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
