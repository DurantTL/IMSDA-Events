import type { Metadata } from "next";
import { ClubSetupHelp } from "@/components/role-setup-help";
import { ClubProfileForm } from "@/components/club-profile-form";
import { ClubTeamWorkspace } from "@/components/club-team-workspace";
import { listPendingClubTeamInvites } from "@/modules/club-imports/invites";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { getClubProfile, listSponsorOptions } from "@/modules/organizations/club-profile-repository";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { clubTeamPeopleLinkAllowed } from "@/modules/system-admin/people-links";
import { listClubTeam } from "@/modules/organizations/director-grants-repository";

export const metadata: Metadata = { title: "Club settings" };
export const dynamic = "force-dynamic";

/**
 * Club settings, formerly Club info (#644): the club profile (#375) first, the club admins (#375, #425)
 * below. Each section keeps its own capability: `editProfile` and
 * `manageTeam`. The old `/profile` and `/team` addresses redirect to the anchors.
 */
export default async function ClubInfoPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return null;
  const { editProfile, manageTeam } = access.capabilities;
  if (!editProfile && !manageTeam) {
    return (
      <>
        <p className="public-manage-empty">Only the club&apos;s director or deputy can change the club&apos;s settings.</p>
        <ClubSetupHelp base={`/account/clubs/${organizationId}`} context="club settings" id="club-settings-role" />
      </>
    );
  }

  const profileSection = editProfile ? await loadProfileSection(organizationId) : null;
  const teamSection = manageTeam
    ? await Promise.all([listClubTeam(organizationId), listPendingClubTeamInvites(organizationId)])
    : null;

  const canOpenPeople = teamSection && access.actor.kind === "STAFF_ACTING" ? clubTeamPeopleLinkAllowed(access.actor, await resolvePeopleViewer()) : false;

  return (
    <>
      {profileSection && (
        <div id="club-profile">
          <ClubProfileForm
            sponsors={profileSection.sponsors}
            endpoint={`/api/attendee/clubs/${encodeURIComponent(organizationId)}/profile`}
            initialProfile={profileSection.profile}
          />
        </div>
      )}
      {teamSection && (
        <div id="club-team">
          <ClubTeamWorkspace
            initialTeam={teamSection[0]}
            initialInvites={teamSection[1]}
            organizationId={organizationId}
            viewerAccountId={access.actor.kind === "ATTENDEE" ? access.actor.accountId : null}
            canOpenPeople={canOpenPeople}
          />
        </div>
      )}
    </>
  );
}

async function loadProfileSection(organizationId: string) {
  const profile = await getClubProfile(organizationId);
  if (!profile) return null;
  return { profile, sponsors: await listSponsorOptions(profile.sponsoringChurchId) };
}
