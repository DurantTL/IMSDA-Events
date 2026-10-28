"use client";

import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";

type Invite = { id: string; role: ClubRole; clubId: string; clubName: string };
type Fill = "all" | "first" | "none";

/** One invite card for the account page: a heading and one row with an Accept button per invite. Club and Area Coordinator invites share it (#376, #1276). */
function InviteAcceptCard({ eyebrow, heading, headingId, className, items, fill, acceptUrl, nextUrl, fallbackError }: {
  eyebrow: string;
  heading: string;
  headingId: string;
  className: string;
  items: Array<{ id: string; title: string; detail: string; translateTitle?: boolean }>;
  fill: Fill;
  acceptUrl: (id: string) => string;
  /** Where to go after accepting, from the route's answer. */
  nextUrl: (result: { clubUrl?: string; nextUrl?: string }) => string | undefined;
  fallbackError: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function accept(id: string) {
    setBusy(id);
    setError("");
    try {
      const response = await fetch(acceptUrl(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json().catch(() => ({})) as { clubUrl?: string; nextUrl?: string; message?: string };
      const next = nextUrl(result);
      if (!response.ok || !next) throw new Error(result.message ?? fallbackError);
      window.location.assign(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallbackError);
      setBusy(null);
    }
  }

  return (
    <section className={`public-manage-card ${className}`} aria-labelledby={headingId}>
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow"><Mail size={15} aria-hidden="true" /> {eyebrow}</p>
        <h2 id={headingId}>{heading}</h2>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <ul className="public-manage-club-list">
        {items.map((item, index) => (
          <li key={item.id}>
            <span>
              <strong translate={item.translateTitle ? "no" : undefined}>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            <button className={fill === "all" || (fill === "first" && index === 0) ? "primary-button" : "secondary-button"} disabled={busy !== null} onClick={() => void accept(item.id)} type="button">
              <Check aria-hidden="true" size={14} /> {busy === item.id ? "Accepting…" : "Accept"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Club invites waiting on this account (#376), each with an Accept button. */
export function ClubInviteAccept({ invites, fill = "all" }: {
  invites: Invite[];
  /** Which Accept buttons are filled primaries: all (default), only the first, or none (another invite card above holds the page's one primary). */
  fill?: Fill;
}) {
  return (
    <InviteAcceptCard
      acceptUrl={(id) => `/api/attendee/club-invites/${encodeURIComponent(id)}/accept`}
      className="club-invite-card"
      eyebrow="Club invite"
      fallbackError="The invite could not be accepted."
      fill={fill}
      heading={invites.length === 1 ? "You're invited to manage a club" : "You're invited to manage clubs"}
      headingId="club-invite-heading"
      items={invites.map((invite) => ({
        id: invite.id,
        title: invite.clubName,
        detail: `As ${clubDirectorRoleLabels[invite.role].toLocaleLowerCase("en-US")}, from the Iowa-Missouri Conference`,
        translateTitle: true,
      }))}
      nextUrl={(result) => result.clubUrl}
    />
  );
}

/** Area Coordinator invites waiting on this account (#1276), each with an Accept button. */
export function AreaCoordinatorInviteAccept({ invites, fill = "all" }: { invites: Array<{ id: string }>; fill?: Fill }) {
  return (
    <InviteAcceptCard
      acceptUrl={(id) => `/api/attendee/area-coordinator-invites/${encodeURIComponent(id)}/accept`}
      className="club-invite-card"
      eyebrow="Area Coordinator invite"
      fallbackError="The invite could not be accepted."
      fill={fill}
      heading="You're invited to be an Area Coordinator"
      headingId="area-coordinator-invite-heading"
      items={invites.map((invite) => ({ id: invite.id, title: "Area Coordinator", detail: "See every club, view only, from the Iowa-Missouri Conference" }))}
      nextUrl={(result) => result.nextUrl}
    />
  );
}
