import { askDirector, askOffice, howTo, type RoleSetupEntry } from "./role-setup";

/**
 * Every club-portal state that can read "not set up", "missing", "blocked" or "empty" for a club director, with the
 * Set up link, the How-to steps or who to ask (#1435; rules H3 and H4). This file is the ONE place the club steps live;
 * the pages only name an id. Each id is listed in `tests/role-setup-help-1435.test.ts`, which also fails when a listed
 * page stops rendering its help. `base` is the club's own portal path (`/account/clubs/<id>`).
 */
export const CLUB_SETUP_IDS = [
  "roster-empty",
  "honors-no-members",
  "awards-no-members",
  "events-none-registered",
  "events-none-published",
  "event-team-none",
  "event-form-problem",
  "event-no-schedule",
  "event-registration-closed",
  "event-roster-empty",
  "classes-location-needed",
  "classes-closed",
  "records-not-due",
  "records-role",
  "year-end-role",
  "forms-none",
  "forms-role",
  "health-role",
  "health-none",
  "club-settings-role",
  "next-year-role",
  "supplies-no-catalog",
  "meetings-none",
  "sterling-follow-up",
  "no-clubs",
  "two-step-needed",
] as const;
export type ClubSetupId = (typeof CLUB_SETUP_IDS)[number];

export function clubSetupFor(id: ClubSetupId, base: string): RoleSetupEntry {
  switch (id) {
    case "roster-empty":
      return {
        setup: howTo(["Choose Open roster to add people.", "Add each member, or carry last year's roster forward.", "Home then shows how many people are on the roster."], "The roster lists your club's people for this year."),
        guideId: "director-roster-and-forms",
      };
    case "honors-no-members":
    case "awards-no-members":
      return { setup: { href: `${base}/roster`, label: "Add people to the roster" }, guideId: "director-honors-and-sterling" };
    case "events-none-registered":
      return {
        setup: howTo(["Choose Open club events.", "Pick the event and start your club's registration.", "Add your people and submit."], "The event shows here with your club's registration status."),
        guideId: "director-register-for-events",
      };
    case "events-none-published":
      return {
        setup: howTo(
          ["Open events appear here by themselves when the conference publishes registration for clubs.", "Watch Upcoming deadlines on Home for registration dates.", "If you expected an event, ask the conference office when registration opens."],
          "The event is listed here with a way to register your club.",
        ),
        whoToAsk: askOffice("open registration for a club event"),
        guideId: "director-register-for-events",
      };
    case "event-team-none":
      return {
        setup: howTo(
          ["Choose Register a team on this page.", "Pick the people from your roster.", "Submit the registration."],
          "Your club's team shows here with its status.",
        ),
        guideId: "director-register-for-events",
      };
    case "event-form-problem":
      return {
        setup: howTo(["Copy the problem shown above.", "Send it to the event team so they can fix the form.", "Come back and reload this page once they say it is fixed."], "The registration form opens for your club."),
        whoToAsk: "Only the event team can fix the form. Ask the event team.",
        guideId: "director-register-for-events",
      };
    case "event-registration-closed":
      return {
        setup: howTo(["Registration opens and closes on the dates the event team sets.", "Check Upcoming deadlines on Home for the dates."], "Registration is open and you can add a team."),
        whoToAsk: "Only the event team can reopen registration or change a date. Ask the event team.",
        guideId: "director-register-for-events",
      };
    case "event-no-schedule":
      return { setup: { href: `${base}/events`, label: "Open club events" }, whoToAsk: askOffice("confirm a registration you are not sure about"), guideId: "director-register-for-events" };
    case "event-roster-empty":
      return { setup: { href: `${base}/roster`, label: "Add people to the roster" }, guideId: "director-register-for-events" };
    case "classes-location-needed":
      return {
        setup: howTo(["Choose your location on the registration page.", "The class choices open once a location is chosen."], "The classes for your location are listed."),
        whoToAsk: "If your location is not in the list, ask the event team.",
        guideId: "director-register-for-events",
      };
    case "classes-closed":
      return {
        setup: howTo(["Class choices open and close on the dates the event team sets.", "Check Upcoming deadlines on Home."], "The classes can be chosen."),
        whoToAsk: "Ask the event team when class choices open.",
        guideId: "director-register-for-events",
      };
    case "records-not-due":
      return {
        setup: howTo(["A month shows here once it has begun.", "The Year-End Report appears once its Pathfinder year is due."], "The month or year is listed with Open."),
        guideId: "director-monthly-record",
      };
    case "records-role":
    case "year-end-role":
      return { setup: howTo(["Monthly Records and the Year-End Report are kept by the club's director, deputy or reporter."], "You can open Monthly Records."), whoToAsk: askDirector("to file the record, or to give you the Reporter role"), guideId: "director-monthly-record" };
    case "forms-none":
      return {
        setup: howTo(["The conference turns each form on for the new year.", "Once one is on, it is listed here to fill in.", "If none shows, ask the conference office when the forms open."], "Each form for the year is listed with Fill in."),
        whoToAsk: askOffice("turn on the club forms"),
        guideId: "director-roster-and-forms",
      };
    case "forms-role":
      return { setup: howTo(["Club forms hold health and conduct answers, so only the club's director and deputy open them."], "You can open Forms."), whoToAsk: askDirector("to fill in the club forms"), guideId: "director-roster-and-forms" };
    case "health-role":
      return { setup: howTo(["Event health information is kept by the club's director and deputy."], "You can open Health."), whoToAsk: askDirector("for the health information you need at an event"), guideId: "director-getting-started" };
    case "health-none":
      return {
        setup: howTo(["Health information is listed for each club event you registered for.", "Register your club for an event, and it appears here during the event."], "The event is listed with its health information."),
        guideId: "director-register-for-events",
      };
    case "club-settings-role":
      return { setup: howTo(["Club settings are changed by the club's director or deputy."], "You can open Club settings."), whoToAsk: askDirector("to change the club's settings"), guideId: "director-leaders-and-invites" };
    case "next-year-role":
      return { setup: howTo(["Starting a new year is done by the club's director or deputy."], "You can start next year's roster."), whoToAsk: askDirector("to start the new year"), guideId: "director-roster-and-forms" };
    case "supplies-no-catalog":
      return {
        setup: howTo(["The supply catalog is loaded by the conference.", "Once it is, each item is listed here to count."], "Each catalog item is listed with a count."),
        whoToAsk: askOffice("load the supply catalog"),
        guideId: "director-orders-and-supplies",
      };
    case "meetings-none":
      return {
        setup: howTo(["Choose Add meeting notes.", "Enter the date, who attended and what you did.", "Save. The month's Monthly Record fills in from the notes."], "The meeting is listed for the month."),
        guideId: "director-monthly-record",
      };
    case "sterling-follow-up":
      return {
        setup: howTo(["Find each person listed here on the roster.", "Ask the conference office how to start or renew their Sterling Volunteers check.", "Their status changes here once the check is current."], "Everyone registered from your club is current."),
        whoToAsk: askOffice("start or renew a Sterling Volunteers check"),
        guideId: "director-honors-and-sterling",
      };
    case "no-clubs":
      // This viewer directs no club, so no director guide is open to them: no guide link, one who-to-ask.
      return {
        setup: howTo(["Your account does not direct a club right now.", "Club directors are added by the conference office. Contact the conference office with your club's name and the email address you sign in with.", "Once you are added, your club is listed here."], "Your club is listed here."),
        whoToAsk: askOffice("add a club director"),
        guideId: null,
      };
    case "two-step-needed":
      return { setup: { href: "/account/security", label: "Set up two-step sign-in" }, guideId: "director-two-step-sign-in" };
  }
}
