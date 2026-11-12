import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye } from "lucide-react";
import { ActAsButton } from "@/components/act-as-button";
import { ClubImportYearMove } from "@/components/club-import-year-move";
import { ClubGuardiansPanel } from "@/components/club-guardians-panel";
import { ClubOverview } from "@/components/club-overview";
import { HubCardGroup } from "@/components/admin-hub";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { canAdministerClubOrganization } from "@/modules/organizations/access";
import { clubPageHref, clubRelatedCards, directoryReturnHref } from "@/modules/club-reports/club-page-links";
import { loadClubCardStatuses } from "@/modules/club-reports/club-card-statuses";
import { getCurrentSession } from "@/modules/access/current-session";
import { listClubImports } from "@/modules/club-imports/move-year";
import { staffClubYearView } from "@/modules/club-rosters/domain";
import { resolveStaffGuardianViewer } from "@/modules/club-rosters/guardians-access";
import { getPrisma } from "@/lib/prisma";
import styles from "./club-page.module.css";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Open club" };
export const dynamic = "force-dynamic";

/**
 * A club as its director sees it, for conference staff, view only (#386):
 * the club's admins, this year's roster, its events, and its monthly reports.
 * Changes are made on the staff screens linked here, never on the club's behalf.
 * `?year=` shows any year the club directory offers, or next year, read-only
 * (#541, #1304), so an import can be checked in the year it went into. The one change made
 * here is moving a club import to another club year. System administrators and Clubs Administrators (#1232) both get
 * the club's change tools (club admins, profile, honors, act-as, year move); this page only opens for a club.
 */
export default async function StaffOpenClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{ year?: string | string[]; from?: string | string[] }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  // A Clubs Administrator (#1225, #1232) sees and can do what a system administrator can on a club: roster, birth dates,
  // Sterling Volunteers detail, guardians, and the change tools (club admins, profile, honors, act-as, year move).
  // The way back is in the section header (#1274): Club summary in the Clubs view, Clubs and churches in the System view. Churches 404 below.
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const view = staffClubYearView(query?.year);
  const club = await getPrisma().organization.findUnique({
    where: { id: organizationId },
    select: { type: true, name: true, isActive: true, parentOrganization: { select: { name: true } } },
  });
  if (!club || club.type !== "CLUB") notFound();
  const imports = await listClubImports(organizationId);
  // Guardian contacts (#510): staff holding the sensitive-data permission (a system administrator always does).
  const guardianViewer = await resolveStaffGuardianViewer();
  // Opened from the directory, the back link returns to that exact directory view (year, search, filter, page); anything
  // that is not a safe same-site directory URL is dropped and the default "Club summary" link is used (#1587).
  const directoryHref = directoryReturnHref(typeof query?.from === "string" ? query.from : undefined);
  const selfHref = `/admin/organizations/${organizationId}/club`;
  const yearHref = (year: string) => (directoryHref
    ? clubPageHref(organizationId, year, directoryHref)
    : year === view.currentClubYear ? selfHref : `${selfHref}?year=${encodeURIComponent(year)}`);
  // Directors, profile and report pages go back to this page in this year (and on to the directory view).
  const fromHere = `?from=${encodeURIComponent(clubPageHref(organizationId, view.clubYear, directoryHref))}`;
  const linksViewer = { canAdministerClub: await canAdministerClubOrganization(user, organizationId), clubsAdministration: true };
  const counts = await loadClubCardStatuses(organizationId, view.clubYear, { ...linksViewer, clubActive: club.isActive });
  const cards = clubRelatedCards({
    organizationId,
    clubName: club.name,
    clubActive: club.isActive,
    clubHasChurch: club.parentOrganization !== null,
    clubYear: view.clubYear,
    directoryHref,
    counts,
    viewer: linksViewer,
  });

  return (
    <section className="page-stack">
      <AdminPageHeader
        path={`/admin/organizations/${organizationId}/club`}
        year={view.clubYear}
        back={directoryHref ? { href: directoryHref, label: "Back to Club directory" } : undefined}
      />

      <div className={`page-intro ${styles.identity}`} data-testid="club-identity">
        <div>
          <p className="eyebrow">Open club · view only</p>
          <h2 className="club-name-heading" title={club.name} translate="no">{club.name}</h2>
          <dl className={styles.facts}>
            <div><dt>Sponsoring church</dt><dd translate={club.parentOrganization ? "no" : undefined}>{club.parentOrganization?.name ?? "No church listed"}</dd></div>
            <div><dt>Status</dt><dd>{club.isActive ? "Active" : "Inactive"}</dd></div>
            <div><dt>Club year</dt><dd>{view.clubYear}</dd></div>
          </dl>
          <p>This is what the club&apos;s director sees. Nothing can be changed here; showing birth dates is recorded.</p>
        </div>
      </div>

      <HubCardGroup headingId="club-related-heading" title="This club" cards={cards} testId="club-card" />

      <section aria-labelledby="club-act-as-heading" className={styles.actAs} data-testid="club-act-as">
        <h2 id="club-act-as-heading" className={styles.actAsHeading}>Act as Director</h2>
        <p>Separate from the view-only pages above. This opens the club&apos;s director portal with full director powers, attributed to you, for 2 hours.</p>
        <ActAsButton
          access="Full director powers, attributed to you"
          club={club.name}
          endpoint={`/api/admin/organizations/${encodeURIComponent(organizationId)}/act-as-director`}
          label="Act as Director (2 hours)"
          resultAction="Open the club portal"
          role="Director"
        />
      </section>

      <h2 className={styles.sectionHeading} id="club-year-overview-heading">Club year overview · {view.clubYear}</h2>

      <p className="inline-notice" role="status">
        <Eye aria-hidden="true" size={14} /> View only.{" "}
        Change club admins or the profile from the cards above, and file or correct reports from Monthly Records.
      </p>

      <nav aria-label="Roster club year" className={`intro-actions club-year-choice ${styles.yearChoice}`}>
        {view.choices.map((year) => (
          <Link
            aria-current={year === view.clubYear ? "page" : undefined}
            className={year === view.clubYear ? "primary-button" : "secondary-button"}
            href={yearHref(year)}
            key={year}
          >
            {year}{year === view.currentClubYear ? " (current)" : ""}
          </Link>
        ))}
      </nav>
      {view.readOnly && (
        <p className="inline-notice" role="status">
          Showing the {view.clubYear} roster, read-only. Everything else on this page is for {view.currentClubYear}.
        </p>
      )}

      <ClubOverview
        headingLevel={3}
        backgroundChecks={{ includeNotes: true }}
        birthDatesEndpoint={`/api/admin/organizations/${encodeURIComponent(organizationId)}/roster/birth-dates`}
        organizationId={organizationId}
        staffHonorsHref={`/admin/organizations/${encodeURIComponent(organizationId)}/club/honors`}
        reportHref={(month) => `/admin/clubs/reports/${organizationId}/${month}${fromHere}`}
        reportsEditable
        rosterYear={view.clubYear}
        // School type and church membership, view only (#1668, #1758): every viewer here holds Clubs Administration (checked
        // above), so system administrators and Clubs Administrators both see them. Event managers' club page does not.
        schoolDetails
      />

      {guardianViewer && !view.readOnly && <ClubGuardiansPanel headingLevel={3} organizationId={organizationId} viewer={guardianViewer} />}

      {/* Keyed by the imports' years, so the panel starts fresh after a move refreshes the page. */}
      {imports.length > 0 && (
        <ClubImportYearMove
          imports={imports}
          key={imports.map((item) => item.clubYear).join(",")}
          organizationId={organizationId}
          yearChoices={view.importChoices}
        />
      )}
    </section>
  );
}
