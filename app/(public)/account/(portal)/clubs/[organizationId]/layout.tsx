import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BackToTopButton } from "@/components/back-to-top-button";
import { ClubAccessGate } from "@/components/club-access-gate";
import { ClubGateSlot, ClubRecordsHint } from "@/components/club-gate-slot";
import { ClubBannerYear } from "@/components/club-banner-year";
import { ClubPortalMasthead } from "@/components/club-portal-masthead";
import { ClubPortalNav } from "@/components/club-portal-nav";
import { attendeeSignInRedirectPath } from "@/modules/attendee-accounts/return-redirect";
import { requireAttendeeSecondStep } from "@/modules/attendee-accounts/portal-second-step";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { clubPortalNavItems, clubReporterNavItems, clubShellNavigation } from "@/modules/club-rosters/portal-nav";
import { clubCapabilities, clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";

// Every page under a club's portal is an authenticated leader/director
// destination (#108): noindex here covers each one that doesn't set its own
// `robots`, the same way the sibling `area/[organizationId]` pages already do.
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

/**
 * Every club screen shares the club shell (#1165): the Club portal masthead,
 * the club banner (club, sponsoring church, actual role, club year), the
 * Home / Roster / Forms / Club events / More navigation, and the
 * authenticator gate. Pages check access again before they load anything: a
 * layout is not a security boundary, and the navigation only hides links.
 */
export default async function ClubLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state === "SIGN_IN") redirect(await attendeeSignInRedirectPath());
  if (access.state === "NOT_FOUND") notFound();
  // A club reached through the attendee's own account still needs the
  // attendee second step (the portal layout skips it while a staff act-as is
  // active, #442); the act-as club itself resolves from the staff session.
  if (!(access.state === "OPEN" && access.actor.kind === "STAFF_ACTING")) await requireAttendeeSecondStep();
  const base = `/account/clubs/${organizationId}`;

  // While the roster gate is up (set up or unlock two-step, own sign-in) Monthly Records still opens, so a role that can
  // submit reports keeps Home and Monthly Records. Every list comes from portal-nav.ts and is only regrouped for the shell.
  const navItems = access.state === "OPEN"
    ? clubPortalNavItems({ base, role: access.club.role, capabilities: access.capabilities })
    : access.state === "NO_ROSTER"
      ? clubReporterNavItems({ base, capabilities: access.capabilities })
      : "club" in access && clubCapabilities(access.club.role).submitReports
        ? clubReporterNavItems({ base, capabilities: clubCapabilities(access.club.role) })
        : [];
  const shellNav = clubShellNavigation(navItems);
  const gated = access.state !== "OPEN" && access.state !== "NO_ROSTER";

  return (
    <div className="club-shell">
      {/* This masthead stands in for the account header on club pages (globals.css hides that one here). */}
      <ClubPortalMasthead actingAs={access.state === "OPEN" && access.actor.kind === "STAFF_ACTING"} role={access.club.role} />
      <section aria-label="Club" className="club-banner">
        <div className="club-banner-inner">
          <div className="club-banner-identity">
            <h1 title={access.club.name} translate="no">{access.club.name}</h1>
            <p>
              {access.club.sponsoringChurch && <span translate="no">{access.club.sponsoringChurch} · </span>}
              {clubDirectorRoleLabels[access.club.role]}
            </p>
          </div>
          <ClubBannerYear currentYear={clubYearFor(new Date())} />
        </div>
      </section>
      {shellNav.primary.length > 0 && <ClubPortalNav more={shellNav.more} primary={shellNav.primary} />}
      <div className="club-roster-layout">
        {gated && (
          <ClubGateSlot>
            <ClubAccessGate access={access} />
            {"club" in access && clubCapabilities(access.club.role).submitReports && (
              <ClubRecordsHint>
                <p className="field-help club-gate-reports">
                  Monthly Records open without this step, except the attendance check-off: <Link href={`${base}/records`}>open Monthly Records</Link>.
                </p>
              </ClubRecordsHint>
            )}
          </ClubGateSlot>
        )}
        {children}
      </div>
      <BackToTopButton />
    </div>
  );
}
