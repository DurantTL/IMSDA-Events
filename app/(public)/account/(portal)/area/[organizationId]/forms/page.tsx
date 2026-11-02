import type { Metadata } from "next";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ColumnHeader } from "@/components/column-header";
import { SortOrderNote } from "@/components/list-sort";
import { serverSort, sortRows } from "@/lib/list-sort";
import { getPrisma } from "@/lib/prisma";
import { AREA_CLUB_FORMS_SORT_COLUMNS, UNSORTED, sortLine } from "@/lib/staff-sort-columns";
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
export default async function AreaClubFormsPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await resolveAreaCoordinatorViewer();
  if (!viewer) notFound();
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const club = await getPrisma().organization.findUnique({
    where: { id: organizationId },
    select: { type: true, name: true, isActive: true },
  });
  if (!club || club.type !== "CLUB" || !club.isActive) notFound();
  const listed = await listSubmissionsForViewer(viewer, { organizationId });
  // Sorted from a fixed list of columns; no column chosen keeps the order the list already has (#1458).
  const sorting = serverSort(`/account/area/${organizationId}/forms`, query, AREA_CLUB_FORMS_SORT_COLUMNS, UNSORTED);
  const submissions = sortRows(listed, sorting.order.key, sorting.order.dir, {
    form: (row) => row.templateName,
    subject: (row) => row.subjectName,
    submitted: (row) => (row.submittedAt ? new Date(row.submittedAt) : null),
  });
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
      {submissions.length === 0 && <CoordinatorSetupHelp context="club forms" id="club-no-forms" />}
      {submissions.length === 0 ? (
        <EmptyState className="empty-state panel" headingLevel={2} icon={<FileText aria-hidden="true" size={26} />} title="No submitted forms">This club has not submitted any forms yet.</EmptyState>
      ) : (
        <div className="report-table-wrap">
          {sorting.order.key && <SortOrderNote>{sortLine(sorting.order)}</SortOrderNote>}
          <table className="report-table">
            <caption className="sr-only">Submitted forms</caption>
            <thead><tr><ColumnHeader column="form" label="Form" sorting={sorting} /><ColumnHeader column="subject" label="Member or subject" sorting={sorting} /><ColumnHeader column="submitted" label="Submitted" sorting={sorting} /><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {submissions.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.templateName}</th>
                  <td translate={row.subjectName ? "no" : undefined}>{row.subjectName || "Not named"}</td>
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
