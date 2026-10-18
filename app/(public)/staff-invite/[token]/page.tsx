import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { StaffInvitationRegistration } from "@/components/staff-invitation-registration";
import { INVITATION_UNAVAILABLE_MESSAGE } from "@/modules/staff-invitations/domain";
import { getInvitationExperience } from "@/modules/staff-invitations/repository";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Staff invitation",
  robots: { index: false, follow: false },
};

function StateCard({ eyebrow, heading, children }: { eyebrow: string; heading: string; children: ReactNode }) {
  return (
    <main className="public-registration-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark /><span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
        </div>
      </header>
      <section className="public-manage-card public-group-state">
        <p className="public-registration-eyebrow">{eyebrow}</p>
        <h1>{heading}</h1>
        {children}
      </section>
    </main>
  );
}

/**
 * /staff-invite/<token> (#804): one person's personal registration link. A link that doesn't work, whatever the reason (wrong,
 * replaced, revoked, or the event is over), gets the same words, so a link can't be probed. Never indexed or cached.
 */
export default async function StaffInvitePage({ params }: PageProps) {
  const { token } = await params;
  const experience = await getInvitationExperience(token);
  if (experience.state === "UNAVAILABLE") {
    return (
      <StateCard eyebrow="Staff invitation" heading="This link isn't available">
        <p>{INVITATION_UNAVAILABLE_MESSAGE}</p>
      </StateCard>
    );
  }
  if (experience.state === "REGISTERED") {
    return (
      <StateCard eyebrow={experience.event.name} heading="You have already registered">
        <p>This link has been used. The event office reviews every registration and will contact you. Contact the event office if something needs to change.</p>
      </StateCard>
    );
  }
  return <StaffInvitationRegistration event={experience.event} person={experience.person} token={token} />;
}
