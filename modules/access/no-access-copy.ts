export type NoAccessCopy = { heading: string; body: string; showEvents: boolean };

/** What /no-access says (#1411): event-creation pages send `?from=event-setup`; anyone else with an assignment gets a general line. */
export function noAccessCopy(input: { from?: string | null; hasEvents: boolean; email: string }): NoAccessCopy {
  if (!input.hasEvents) {
    return {
      heading: "No events are assigned",
      body: `${input.email} is signed in, but it does not have an active event assignment. Ask an IMSDA event administrator to add the account.`,
      showEvents: false,
    };
  }
  if (input.from === "event-setup") {
    return {
      heading: "Creating events needs a system administrator",
      body: "Creating events needs a system administrator. Ask one to set up a new event, or go back to the events you work in.",
      showEvents: true,
    };
  }
  return {
    heading: "This page needs a system administrator",
    body: "This page needs a system administrator. You can go back to the events you work in.",
    showEvents: true,
  };
}
