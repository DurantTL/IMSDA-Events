import { askOffice, howTo, type RoleSetupEntry } from "./role-setup";

/**
 * Every area-coordinator page state that can read "missing", "none" or "empty", with the Set up link, How-to steps or
 * who to ask (#1435; H3 and H4). Same rules as `club-setup-steps.ts`; the ids are listed in the guard test.
 */
export const COORDINATOR_SETUP_IDS = [
  "no-clubs",
  "club-no-director",
  "whos-missing",
  "club-reports-none-due",
  "events-none",
  "points-none",
  "club-no-forms",
  "club-no-report",
  "club-no-emergency-contacts",
] as const;
export type CoordinatorSetupId = (typeof COORDINATOR_SETUP_IDS)[number];

export function coordinatorSetupFor(id: CoordinatorSetupId): RoleSetupEntry {
  switch (id) {
    case "no-clubs":
      return {
        setup: howTo(["Clubs appear here once the conference has an active club on record.", "If you expected clubs, check you are signed in as the right account."], "Clubs are listed with their records."),
        whoToAsk: askOffice("add clubs or change what your role can see"),
        guideId: "coordinator-getting-started",
      };
    case "club-no-director":
      return {
        setup: howTo(["A club with no director cannot file Monthly Records or register for events.", "Contact the conference office with the club's name and, if you know it, who should direct it.", "Once added, the director is named here."], "A director is listed for the club."),
        whoToAsk: askOffice("add a director to a club"),
        guideId: "coordinator-follow-up-clubs",
      };
    case "whos-missing":
      return {
        setup: howTo(["Open the club from its row to see what it has filed.", "Contact the club's director about anything missing. The app sends nothing for you.", "For a club with no director, ask the conference office to add one."], "Each club's row shows nothing missing."),
        whoToAsk: askOffice("add a director to a club"),
        guideId: "coordinator-follow-up-clubs",
      };
    case "club-reports-none-due":
      return { setup: howTo(["Monthly Records open as each month of the club year begins.", "Check back when the first month opens."], "The club's months are listed."), guideId: "coordinator-follow-up-clubs" };
    case "events-none":
      return {
        setup: howTo(["Club events show here once the conference publishes them for clubs."], "Each club event is listed with its registered clubs."),
        whoToAsk: askOffice("publish a club event"),
        guideId: "coordinator-getting-started",
      };
    case "points-none":
      return { setup: howTo(["Points come from submitted Monthly Records and on-time yearly registration.", "Use Who's missing what on Overview to follow up with clubs that have not filed."], "Clubs are ranked by points."), guideId: "coordinator-points" };
    case "club-no-forms":
      return { setup: howTo(["The club has not submitted a form this year.", "Ask the club's director to fill in the club forms."], "Submitted forms are listed."), whoToAsk: "Only the club's director or deputy submits forms. Ask them.", guideId: "coordinator-find-club" };
    case "club-no-report":
      return { setup: howTo(["The club has not submitted this month's Monthly Record.", "Contact the club's director. The app sends nothing for you."], "The submitted record can be read here."), whoToAsk: "Only the club's director, deputy or reporter files it. Ask them.", guideId: "coordinator-follow-up-clubs" };
    case "club-no-emergency-contacts":
      return { setup: howTo(["Emergency contacts are kept on the club's roster by its director or deputy.", "Ask the club's director to add them before the event."], "The club's emergency contacts are listed."), whoToAsk: "Only the club's director or deputy adds them. Ask them.", guideId: "coordinator-find-club" };
  }
}
