import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { AccountPageBanner } from "@/components/account-page-banner";
import { VisitingClubRequestForm } from "@/components/visiting-club-request-form";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { requireAttendeeSecondStep } from "@/modules/attendee-accounts/portal-second-step";
import { attendeeSignInRedirectPath } from "@/modules/attendee-accounts/return-redirect";
import { checkVisitingClubLinkRateLimit } from "@/modules/rate-limit/service";
import { VISITING_EMAIL_MISMATCH_MESSAGE } from "@/modules/visiting-clubs/domain";
import { viewVisitingInvite } from "@/modules/visiting-clubs/repository";

export const dynamic = "force-dynamic";

// The token is in the path, so nothing about this page may be cached, indexed, or leaked through a referrer.
export const metadata: Metadata = {
  title: "Bring your club",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * A visiting club's private link (#835). Under /account so a signed-out visit goes to sign-in and comes back here. The
 * link by itself grants nothing: it needs the account whose verified email the link was sent to, and staff approve the
 * request afterward. A bad, used, expired or withdrawn link gets the same 404.
 */
export default async function VisitingClubLinkPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  await requireAttendeeSecondStep();
  const { account, via } = await getCurrentAttendee();
  if (!account || via !== "attendee") redirect(await attendeeSignInRedirectPath());

  const requestLike = new Request("http://visiting-clubs.invalid/", { headers: await headers() });
  const rateLimit = await checkVisitingClubLinkRateLimit(requestLike, token);
  if (!rateLimit.allowed) {
    return (
      <>
        <AccountPageBanner title="Too many attempts" context="Visiting club" />
        <div className="account-page-body">
          <section className="public-manage-card"><p>Try this link again in a few minutes.</p></section>
        </div>
      </>
    );
  }

  const view = await viewVisitingInvite(token, { id: account.id, verifiedEmail: account.verifiedEmail, displayName: account.displayName });
  if (view.status === "UNAVAILABLE") notFound();
  if (view.status === "EMAIL_MISMATCH") {
    return (
      <>
        <AccountPageBanner title="Bring your club" context="Visiting club" />
        <div className="account-page-body">
          <section className="public-manage-card">
            <div className="inline-notice error" role="status">{VISITING_EMAIL_MISMATCH_MESSAGE}</div>
          </section>
        </div>
      </>
    );
  }
  return (
    <>
      <AccountPageBanner title="Bring your club" context={view.eventName} />
      <div className="account-page-body">
        <VisitingClubRequestForm eventName={view.eventName} token={token} />
      </div>
    </>
  );
}
