export type NoAccessCopy = { heading: string; body: string; whoToAsk: string; showEvents: boolean };

/**
 * What /no-access says (#1411): event-creation pages send `?from=event-setup`; anyone else with an assignment gets a
 * general line. `body` is the reason in one sentence; `whoToAsk` fills the shared "Ask ... if you need access." line
 * that `AccessRestricted` shows everywhere (rule 14).
 */
export function noAccessCopy(input: { from?: string | null; hasEvents: boolean; email: string }): NoAccessCopy {
  if (!input.hasEvents) {
    return {
      heading: "No events are assigned",
      body: `${input.email} is signed in, but it does not have an active event assignment.`,
      whoToAsk: "an IMSDA event administrator",
      showEvents: false,
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
