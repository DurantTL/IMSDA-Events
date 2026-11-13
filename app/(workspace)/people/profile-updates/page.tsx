import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProfileUpdatesReview } from "@/components/profile-updates-review";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { listProfileChangesForStaff } from "@/modules/attendee-accounts/profile-change-staff";
import { isDisclosureAllowed, staffIdentityAudience } from "@/modules/people/disclosure-matrix";

export const metadata: Metadata = { title: "Profile updates" };

/**
 * Attendee profile changes (#1512). System administrators only, gated the way the possible-duplicates queue is
 * (`modules/people/duplicate-match-access.ts`): the profile belongs to a global account, not to one event.
 */
export default async function ProfileUpdatesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!isDisclosureAllowed("MATCH_CANDIDATE_EVIDENCE", staffIdentityAudience(user), "READ")) redirect("/no-access");

  const { changes, accounts } = await listProfileChangesForStaff(user.id);
  return (
    <section className="page-stack">
      <PageHeader
        title="Profile updates"
        description="Recent changes attendees made to their saved profile, and corrections staff made. Only name, phone and shirt size show their values."
      />
      <ProfileUpdatesReview changes={changes} accounts={accounts} />
    </section>
  );
}
