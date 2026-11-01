import { clubRoleText, type ClubRoleKey } from "@/modules/access/role-descriptions";
import type { PortalDestination, PortalGuide } from "@/modules/help/types";

/**
 * Portal guides (#1259): short task guides for attendees, club directors and Area Coordinators, shown inside the
 * account portal. They are a separate registry from the staff guides so a portal viewer never gets a staff or
 * system page, and nothing here adds a staff menu to the portal. Same wording rules as `guides.ts`: plain short
 * sentences, the exact on-screen labels, synthetic examples only, no person's name and no event name.
 * `docs/HELP-AND-LEARNING.md` says how to add or change one.
 */

/** Guide ids that are already routes below `/account/help`. A portal guide may not use one. */
export const reservedPortalGuideIds: readonly string[] = ["authenticator"];

/** The portal pages guides depend on, by id. A path with `[organizationId]` is resolved for the viewer's own club. */
export const portalDestinations: Record<string, PortalDestination> = {
  "portal-overview": { id: "portal-overview", label: "Overview", path: "/account", audience: "attendee" },
  "portal-registrations": { id: "portal-registrations", label: "My registrations", path: "/account/registrations", audience: "attendee" },
  "portal-recover-registration": { id: "portal-recover-registration", label: "Find a registration made with another email", path: "/recover-registration", audience: "attendee" },
  "club-list": { id: "club-list", label: "My clubs", path: "/account/clubs", audience: "director" },
  "club-home": { id: "club-home", label: "Club home", path: "/account/clubs/[organizationId]", audience: "director" },
  "club-records": { id: "club-records", label: "Monthly Records", path: "/account/clubs/[organizationId]/records", audience: "director", capability: "submitReports" },
  "coordinator-clubs": { id: "coordinator-clubs", label: "Clubs", path: "/account/clubs", audience: "coordinator" },
  "coordinator-overview": { id: "coordinator-overview", label: "Overview", path: "/account/area-clubs/overview", audience: "coordinator" },
  "coordinator-records": { id: "coordinator-records", label: "Monthly Records summary", path: "/account/area-clubs/reports", audience: "coordinator" },
  "coordinator-team-approvals": { id: "coordinator-team-approvals", label: "Team approvals", path: "/account/area-clubs/team-permissions", audience: "coordinator" },
  "coordinator-new-clubs": { id: "coordinator-new-clubs", label: "New clubs (view only)", path: "/account/area-clubs/applications", audience: "coordinator" },
};

const roleLines = (Object.keys(clubRoleText) as ClubRoleKey[]).map((role) => `${clubRoleText[role].name}: ${clubRoleText[role].summary}${clubRoleText[role].cannot.length ? ` Can't: ${clubRoleText[role].cannot.join(" ")}` : ""}`);

export const portalGuides: readonly PortalGuide[] = [
  {
    id: "find-my-registration",
    title: "Find your registration and its next step",
    summary: "See your own registrations, read what each status means, and use the next step the card offers.",
    audience: "attendee",
    needs: [
      "Your account, signed in. You do not need any other access.",
      "The email address you registered with, if it is not the one on this account.",
    ],
    changes: ["Nothing. This guide is reading only."],
    steps: [
      "Open Overview. Under Coming up for you, each upcoming registration is a card with its status and one next step, usually View registration.",
      "Open My registrations to see all of them. Use All, Upcoming, Past or Cancelled to narrow the list. Past and cancelled registrations are folded under Past and cancelled.",
      "Read the status on the card and the money line under it. A church-billed registration never shows an amount owed to you.",
      "Some cards have more actions, such as Continue payment, Update contact details, Registration details or Request cancellation. A card shows only the ones allowed for that registration right now.",
      "A registration appears here when its contact email is your verified email address. It is never matched on a name. A registration that includes several people is still found by its contact email, and being listed on someone else's registration does not add it to your account.",
      "If a registration is missing, choose Find a registration made with another email, or ask the event team to correct the address on file.",
    ],
    verify: [
      "You can find the registration and read its status.",
      "You know the next step: the one on the card, or the event team for changes to attendance, rooms, activities or transfers.",
    ],
    next: "A cancellation is a request the event team reviews. Sending one does not cancel or refund anything.",
    destinationIds: ["portal-overview", "portal-registrations", "portal-recover-registration"],
    relatedDocs: [],
    keywords: ["registration", "registrations", "status", "payment", "balance", "my event", "confirmation", "cancel", "cancellation", "contact details"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "director-choose-club",
    title: "Choose your club and club year",
    summary: "Open the right club, see your role in it, and know which club year you are looking at.",
    audience: "director",
    needs: ["A club role on at least one club."],
    changes: ["Nothing. This guide is reading only."],
    steps: [
      "Open My club, or My clubs if you have several, in the account tabs. With one club it opens that club. With several, you see a list with your role and the sponsoring church. Choose Open beside the club you want.",
      "The banner on every club page shows the club, its sponsoring church, your role and the club year. Current club year is the year you can work in. A past or next year opens read-only.",
      "When you are looking at another year, Home says it is showing that year read-only and links back to the current year.",
      "What the club menu offers depends on your role. A club role opens this club's pages only. It does not open event staff pages, System management or another club.",
      ...roleLines,
      "A menu item you do not see is not open to your role. Ask your club's director or the conference office if you need a different role.",
    ],
    verify: [
      "The banner shows the club and the role you expect.",
      "The banner says Current club year before you start work.",
    ],
    next: "Use the Complete a Monthly Record guide to file this month's report.",
    destinationIds: ["club-list", "club-home"],
    relatedDocs: [],
    keywords: ["club", "clubs", "choose club", "switch club", "club year", "year", "role", "deputy", "registrar", "reporter", "director"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "director-monthly-record",
    title: "Complete a Monthly Record",
    summary: "File your club's report for a month, from meeting notes to Submit report.",
    audience: "director",
    needs: [
      `A club role that can submit reports: ${clubRoleText.DIRECTOR.name}, ${clubRoleText.DEPUTY.name} or ${clubRoleText.REPORTER.name}. A ${clubRoleText.REGISTRAR.name} cannot, and sees a note saying Monthly Records are kept by the club's ${clubRoleText.DIRECTOR.name}, ${clubRoleText.DEPUTY.name} or ${clubRoleText.REPORTER.name}.`,
      "The month's numbers: attendance, staff, honors worked on and class levels.",
    ],
    changes: [
      "Save draft keeps your answers and does not file the report.",
      "Submit report files the report for that month with its points. Reports are due the 10th of the next month. After the due date a submitted report closes. Before then you can use Reopen as draft to change it.",
    ],
    steps: [
      "Open Monthly Records. In the club menu it is under More. A reporter sees it in the main menu.",
      "The list of months shows each month of the club year as Due, Draft, its points, or Missing. Choose Open beside the month you need (it reads View for a closed month). The month you are on says Viewing.",
      "The month's meeting notes are at the top. The report fills in from them where it can. When Refresh from meeting notes is offered, it asks before it replaces anything.",
      "Choose Open Monthly Record, or Continue report, Edit report or View report, whichever the button says. Fill in Club facts, Points and Signature.",
      "Choose Save draft to keep your answers without filing. Choose Submit report to file it. The button shows the points the report is worth.",
      "Items you have not answered count as 0, and the summary says how many.",
    ],
    verify: [
      "The month in the list shows its points instead of Due or Missing, and the report says Submitted with the date.",
      "A report filed after the due date says it was submitted after that date, so no on-time points.",
    ],
    next: "Do the next month that is due. The Year-End Report is on the same page.",
    destinationIds: ["club-records", "club-list"],
    relatedDocs: [],
    keywords: ["monthly record", "monthly records", "report", "reports", "meeting notes", "attendance", "points", "submit", "draft", "due", "10th"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
    screenshot: { src: "/help/monthly-records-example.webp", width: 800, height: 298, alt: "The Monthly Records page with the monthly points summary and the list of months, using sample data.", capturedFor: "2026-10-27" },
  },
  {
    id: "director-year-end-report",
    title: "File the Year-End Report",
    summary: "Check the pre-filled Year-End Report for a Pathfinder year, then save a draft or submit it.",
    audience: "director",
    needs: [
      `A club role that can submit reports: ${clubRoleText.DIRECTOR.name}, ${clubRoleText.DEPUTY.name} or ${clubRoleText.REPORTER.name}. A ${clubRoleText.REGISTRAR.name} cannot.`,
      "A little time to check the numbers. The report is pre-filled from your roster, honors and classes.",
    ],
    changes: [
      "Save draft keeps your answers and does not file the report.",
      "Submit report files it and closes it to changes.",
    ],
    steps: [
      "Open Monthly Records and find Year-End Report. It is due April 1.",
      "Each Pathfinder year is listed with its dates and whether it is Due, a Draft or Submitted. Choose Open report, or View report once it is submitted.",
      "Under Who is reporting, check the name, phones and email.",
      "Check each section's numbers. They are pre-filled. You can change one, and a number you changed can be restored to its pre-filled value.",
      "Choose Save draft to keep your work, then Submit report when it is right.",
    ],
    verify: [
      "The list shows the year as Submitted and closed. If it was filed after the due date it says Submitted late.",
    ],
    next: "A submitted report is closed. If something needs to change, ask the conference office to reopen it.",
    destinationIds: ["club-records"],
    relatedDocs: [],
    keywords: ["year-end", "year end", "annual", "yearly report", "april", "pathfinder year", "report"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "coordinator-find-club",
    title: "Find a club and open its view-only record",
    summary: "Search the clubs, open one, and know what a view-only record does and does not show.",
    audience: "coordinator",
    needs: ["An Area Coordinator account, signed in."],
    changes: ["Nothing. Everything a coordinator opens here is view only."],
    steps: [
      "Open Clubs in the account tabs, or All clubs in the Club coordination menu. The page lists every active club available to your role.",
      "Use Search by club, church or city to narrow the list.",
      "Choose Open beside a club. A club you do not run opens view only, with ages instead of birth dates, and the list says View only beside it. A club you also run opens as usual, with your own role.",
      "On a view-only club, the notice says View only. You see what the club's director sees, with ages instead of birth dates, plus each adult's Sterling Volunteers status and note.",
      "The director maintains the roster and the club's settings, so ask the director for any change. Club Orders are not shown to you.",
      "New clubs, in Club coordination, lists applications to start a club. It is view only. System administrators approve or decline them.",
    ],
    verify: ["The club page says View only, and you can read its record without any edit control."],
    next: "Use the Follow Monthly Records guide to see which clubs have filed.",
    destinationIds: ["coordinator-clubs", "coordinator-new-clubs"],
    relatedDocs: [],
    keywords: ["club", "clubs", "find a club", "search", "view only", "coordinator", "area", "applications", "new clubs"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "coordinator-follow-records",
    title: "Follow Monthly Records",
    summary: "See which clubs have filed each month, and understand the full-year download.",
    audience: "coordinator",
    needs: ["An Area Coordinator account, signed in."],
    changes: [
      "Nothing in the app. The full-year download saves a file on your computer. Keep it there and do not share it.",
    ],
    steps: [
      "Open Monthly Records in Club coordination. The grid has a row for each club and a column for each month of the club year. The club year shown is stated at the top of the page.",
      "Submitted means the club filed that month's record. Select it to read the record, read only.",
      "Not submitted means the month has ended and no record is filed. Not due yet means the month has not ended. Records are due on the 10th of the next month.",
      "These are record states, not approvals. There is no approve control on this page.",
      "Use the search to narrow the grid to a club by name.",
      "The Full-year CSV link, labelled with the club year, covers every available club for the full year. It does not change with the search.",
    ],
    verify: ["For any club and month you can say whether the record is Submitted, Not submitted or Not due yet."],
    next: "To read one club's record, use the Find a club and open its view-only record guide.",
    destinationIds: ["coordinator-records", "coordinator-overview"],
    relatedDocs: [],
    keywords: ["monthly records", "missing", "not submitted", "follow up", "export", "csv", "full year", "club year", "coordinator", "report"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "coordinator-team-approvals",
    title: "Decide Team approvals",
    summary: "Approve or decline team members of 18 or older on teams at your own event locations.",
    audience: "coordinator",
    needs: [
      "An Area Coordinator account. Decisions are for teams at your own event locations.",
    ],
    changes: [
      "Approve or Decline records your decision for that person. The club's director sees your answer on their team page.",
      "Nothing is removed for a declined person. The club's director is told to change them to a coach or take them off the team.",
    ],
    steps: [
      "Open Team approvals in Club coordination.",
      "Read Rules to check. A team member 18 or older must still qualify: an inducted Pathfinder or TLT, active and in good standing, not graduated from high school, and no older than the event's maximum age on its age date. The page shows the event's own limit.",
      "Each person who needs a decision from you is listed. Choose Approve or Decline beside a name.",
      "Pending approval means the club has asked. The team is registered while you decide. Approved can be changed later to declined.",
      "Adults who are coaching should be registered as coaches. Coaches do not need approval.",
      "A staff member viewing as an Area Coordinator can read this page but cannot approve or decline.",
    ],
    verify: ["The person's row shows your decision."],
    next: "Nothing else is needed. The club's director sees your answer.",
    destinationIds: ["coordinator-team-approvals"],
    relatedDocs: [],
    keywords: ["team", "approval", "approvals", "approve", "decline", "pbe", "18", "age", "coach", "permission"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
];

export function findPortalGuide(id: string): PortalGuide | undefined {
  return portalGuides.find((guide) => guide.id === id);
}
