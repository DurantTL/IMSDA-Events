export type NoAccessCopy = { heading: string; body: string; whoToAsk: string; showEvents: boolean; /** Offer a link back to Club administration (a Clubs Administrator is working, just not here). */ showClubs?: boolean; /** Offer Home (#1596): staff with no event still have Home and any admin role they hold, so the card is not a dead end. */ showHome?: boolean };

/**
 * What /no-access says (#1411): event-creation pages send `?from=event-setup`; anyone else with an assignment gets a
 * general line. `body` is the reason in one sentence; `whoToAsk` fills the shared "Ask ... if you need access." line
 * that `AccessRestricted` shows everywhere (rule 14).
 */
/** The `?from=` reasons a Clubs Administrator can arrive with; any other (or none) sends them home to Club administration. */
export const CLUBS_ADMIN_NO_ACCESS_REASONS = ["system", "event-setup", "club-only", "site-content", "health-access"] as const;

const clubsAdminReasons: Record<string, { heading: string; body: string }> = {
  system: { heading: "System management needs a system administrator", body: "System management pages are for IMSDA system administrators. Your Clubs Administrator account covers Club administration." },
  "club-only": { heading: "Only club organizations are managed here", body: "Only club organizations are managed from Club administration." },
  "site-content": { heading: "Website content needs the site-content permission", body: "Website content needs the site-content permission, and your account does not have it." },
  "health-access": { heading: "Health access holds are for system administrators", body: "Health access holds and emergency access are managed by IMSDA system administrators, and your account is not one." },
};

export function noAccessCopy(input: { from?: string | null; hasEvents: boolean; email: string; clubsAdmin?: boolean }): NoAccessCopy {
  // A Clubs Administrator is signed in and working: "no events assigned" would send them to the wrong people (rule B14).
  // Only a page that sends a reason says so; a bare arrival sends them home (see /no-access).
  if (input.clubsAdmin && input.from === "event-setup") {
    return {
      heading: "Creating events needs a system administrator",
      body: "New events are set up by IMSDA system administrators, and your Clubs Administrator account is not one.",
      whoToAsk: "an IMSDA system administrator",
      showEvents: input.hasEvents,
      showClubs: true,
    };
  }
  if (input.clubsAdmin && input.from && Object.hasOwn(clubsAdminReasons, input.from)) {
    return { ...clubsAdminReasons[input.from], whoToAsk: "an IMSDA system administrator", showEvents: input.hasEvents, showClubs: true };
  }
  if (!input.hasEvents) {
    return {
      heading: "No events are assigned",
      body: `${input.email} is signed in, but it does not have an active event assignment.`,
      whoToAsk: "an IMSDA event administrator",
      showEvents: false,
      showHome: true,
    };
  }
  if (input.from === "event-setup") {
    return {
      heading: "Creating events needs a system administrator",
      body: "New events are set up by IMSDA system administrators, and your account is not one.",
      whoToAsk: "a system administrator",
      showEvents: true,
    };
  }
  return {
    heading: "This page needs a system administrator",
    body: "Only IMSDA system administrators can open this page, and your account is not one.",
    whoToAsk: "a system administrator",
    showEvents: true,
  };
}

/** What /no-access says to someone signed in as an attendee or club leader who opened a staff page (rule 14). */
export function attendeeStaffPageCopy(email: string): NoAccessCopy {
  return {
    heading: "This page is for event staff",
    body: `${email} is signed in as an attendee or club account, which does not include staff pages.`,
    whoToAsk: "an IMSDA event administrator",
    showEvents: false,
  };
}
