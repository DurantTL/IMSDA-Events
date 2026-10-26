import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Printer } from "lucide-react";
import { CopyApplicationLink } from "@/components/copy-application-link";
import { EmptyState } from "@/components/empty-state";
import { RevokeClubFormLinkButton, SendClubFormLink } from "@/components/club-forms-actions";
import { getServerEnv } from "@/lib/env";
import { groupClubFormsByFillMode, openApplicationUrl } from "@/modules/club-forms/open-applications-domain";
import { clubLeaderViewerFromAccess } from "@/modules/club-forms/access";
import { CLUB_FORM_LINK_DEFAULT_DAYS, isClubFormsRole } from "@/modules/club-forms/domain";
import { listClubFormLinks } from "@/modules/club-forms/links";
import { listRosterChoices, listSubmissionsForViewer } from "@/modules/club-forms/submissions";
import { listEnabledClubFormTemplates } from "@/modules/club-forms/templates";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";

export const metadata: Metadata = { title: "Club forms" };
export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

const emailDeliveryLabel = {
  QUEUED: "Sending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  NOT_DELIVERED: "Not delivered: link withdrawn, send a new one",
  UNKNOWN: "",
} as const;

const linkStateLabel = { OPEN: "Waiting", USED: "Submitted", REVOKED: "Withdrawn", EXPIRED: "Expired" } as const;

/**
 * A club's forms (#610): the forms the conference has turned on, filling one
 * in for a member, sending a single-use private link, and the club's filled
 * forms by form and by member. Only the club's director and deputy see it.
 */
export default async function ClubFormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ member?: string }>;
}) {
  const [{ organizationId }, { member }] = await Promise.all([params, searchParams]);
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return null;
  if (!isClubFormsRole(access.club.role)) {
    return (
      <>
        <p className="public-manage-empty">Club forms are kept by the club&apos;s director and deputy.</p>
      </>
    );
  }
  const viewer = clubLeaderViewerFromAccess(access);
  const [templates, rosterMembers, submissions, links] = await Promise.all([
    listEnabledClubFormTemplates(),
    listRosterChoices(organizationId),
    listSubmissionsForViewer(viewer, member ? { rosterMemberId: member } : {}),
    listClubFormLinks(viewer, organizationId),
  ]);
  const base = `/account/clubs/${organizationId}/forms`;
  const { families, club: clubForms } = groupClubFormsByFillMode(templates);

  return (
    <>
      <section className="public-manage-card club-forms-intro">
        <p className="public-registration-eyebrow">Club forms</p>
        <h2>Forms for your club&apos;s files</h2>
        <p>
          Send a private link so a parent or staff person can fill a form in themselves, or fill in the club&apos;s own forms
          directly. These files can hold health, conduct and contact details, so only your club&apos;s director
          and deputy and the conference office can open them.
        </p>
      </section>

      {templates.length === 0 ? (
        <EmptyState className="empty-state panel" icon={<FileText aria-hidden="true" size={26} />} title="No forms are available yet">The conference turns each form on when it is needed.</EmptyState>
      ) : null}

      {(families.length > 0 || links.length > 0) && (
        <section aria-labelledby="club-forms-families" className="club-form-group">
          <h2 id="club-forms-families">Forms for families and individuals: send a link</h2>
          <p className="field-help">A parent, member, staff member or recommender fills these in through a private link you send. You can fill one in yourself too.</p>
          {families.map((template) => (
            <section className="public-manage-card club-form-template" key={template.key}>
              <div>
                <h3>{template.name}</h3>
                <p className="field-help">{template.description}</p>
              </div>
              <div className="club-form-template-actions">
                <SendClubFormLink
                  defaultDays={CLUB_FORM_LINK_DEFAULT_DAYS}
                  formName={template.name}
                  organizationId={organizationId}
                  primary
                  rosterMembers={rosterMembers}
                  templateKey={template.key}
                />
                <Link className="secondary-button" href={`${base}/${template.key}/new`}>
                  <FileText aria-hidden="true" size={14} /> Fill in
                </Link>
              </div>
            </section>
          ))}
          {links.length > 0 && (
            <section className="public-manage-card">
              <h3>Private links you sent</h3>
              <p className="field-help">A link works once. After it is used, the form appears under Filled forms.</p>
              <div className="report-table-wrap">
                <table className="report-table">
                  <caption className="sr-only">Private links</caption>
                  <thead>
                    <tr><th scope="col">Form</th><th scope="col">Sent to</th><th scope="col">Status</th><th scope="col">Email</th><th scope="col">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {links.map((link) => (
                      <tr key={link.id}>
                        <th scope="row">{link.templateName}</th>
                        <td translate="no">{link.recipientEmail}{link.subjectName ? ` · ${link.subjectName}` : ""}</td>
                        <td>{linkStateLabel[link.state]}</td>
                        <td>{emailDeliveryLabel[link.delivery]}</td>
                        <td>{formatDate(link.expiresAt)}</td>
                        <td>
                          {link.state === "OPEN" && <RevokeClubFormLinkButton linkId={link.id} organizationId={organizationId} />}
                          {link.submissionId && <Link className="text-button" href={`${base}/submissions/${link.submissionId}`}>Open form</Link>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      )}

      {clubForms.length > 0 && (
        <section aria-labelledby="club-forms-club" className="club-form-group">
          <h2 id="club-forms-club">Club forms: the club fills these in</h2>
          <p className="field-help">You fill these in directly, whenever they are needed. You can still send a link for one if someone else should fill it in.</p>
          {clubForms.map((template) => (
            <section className="public-manage-card club-form-template" key={template.key}>
              <div>
                <h3>{template.name}</h3>
                <p className="field-help">{template.description}</p>
                {template.fillMode === "OPEN_APPLICATION" && (
                  <p className="field-help">Anyone with the application link can apply and pick your club. Applications for your club are listed under Filled forms.</p>
                )}
              </div>
              {template.fillMode === "OPEN_APPLICATION" ? (
                <div className="club-form-template-actions">
                  <CopyApplicationLink url={openApplicationUrl(getServerEnv().APP_BASE_URL, template.key)} />
                </div>
              ) : (
                <div className="club-form-template-actions">
                  <Link className="primary-button" href={`${base}/${template.key}/new`}>
                    <FileText aria-hidden="true" size={14} /> Fill in
                  </Link>
                  <SendClubFormLink
                    defaultDays={CLUB_FORM_LINK_DEFAULT_DAYS}
                    formName={template.name}
                    organizationId={organizationId}
                    rosterMembers={rosterMembers}
                    templateKey={template.key}
                  />
                </div>
              )}
            </section>
          ))}
        </section>
      )}

      <section className="public-manage-card">
        <h3>Filled forms</h3>
        {rosterMembers.length > 0 && (
          <form action={base} className="club-form-filter" method="get">
            <label>
              Show forms for
              <select defaultValue={member ?? ""} name="member">
                <option value="">Everyone</option>
                {rosterMembers.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="submit">Show</button>
          </form>
        )}
        {submissions.length === 0 ? (
          <EmptyState className="empty-state panel" headingLevel={4} icon={<FileText aria-hidden="true" size={26} />} title="No forms filled in yet">Forms you fill in or receive by private link will be listed here.</EmptyState>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <caption className="sr-only">Filled forms</caption>
              <thead>
                <tr><th scope="col">Form</th><th scope="col">Member or subject</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col"><span className="sr-only">Open</span></th></tr>
              </thead>
              <tbody>
                {submissions.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.templateName}</th>
                    <td translate="no">{row.subjectName || "Not named"}</td>
                    <td>{row.status === "DRAFT" ? "Draft" : "Submitted"}{row.enteredVia === "LINK" ? " · private link" : row.enteredVia === "OPEN_APPLICATION" ? " · open application" : ""}</td>
                    <td>{formatDate(row.submittedAt ?? row.updatedAt)}</td>
                    <td>
                      <Link className="secondary-button" href={`${base}/submissions/${row.id}`}>
                        {row.status === "DRAFT" ? "Open" : <><Printer aria-hidden="true" size={13} /> View and print</>}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
