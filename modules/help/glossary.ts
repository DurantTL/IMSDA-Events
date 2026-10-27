import { eventRoles } from "@/modules/access/permissions";
import { roleDetails } from "@/modules/access/role-display";
import type { GlossaryTerm } from "@/modules/help/types";

const roleNames = eventRoles.map((role) => roleDetails[role].label).join(", ");

/** Plain-language words used across the staff workspace (#1077). Same rules as the guides: short, no names, no events. */
export const glossaryTerms: readonly GlossaryTerm[] = [
  { term: "System administration", meaning: "The pages for the whole organization: creating events, the club and church directory, shared forms and templates, accounts, email and platform settings. Only system administrators have it." },
  { term: "Event workspace", meaning: "The pages for one event: registrations, payments, emails, forms, check-in, staff and reports. The event picker says which event you are in." },
  { term: "Event", meaning: "One gathering people register for, such as a retreat or a camp meeting. It starts as a private draft and is public only after it is published." },
  { term: "Event template", meaning: "A starting point for a new event, with its forms and settings already filled in. System administrators keep them." },
  { term: "Copy from a past event", meaning: "Starts a new draft from an earlier event's settings and forms. Dates, links to the old event, registrations and payments are not carried over." },
  { term: "Team and event roles", meaning: `Team is where an event's staff and their roles are managed. The event roles are ${roleNames}. A role decides which pages a person can open for that event.` },
  { term: "Staff invitation", meaning: "Adding a person to an event's Team with a role. They get a one-time link to choose a password." },
  { term: "Club director grant", meaning: "Access to a club, not to an event's staff pages. It is given by an administrator, or by the club's own director or deputy." },
  { term: "Attendee registration", meaning: "A person signing up for an event on the public pages. It never gives staff access." },
  { term: "Registration form", meaning: "The form people fill in to register for one event. It is built, tested and published in Registration forms." },
  { term: "Club form", meaning: "A form clubs fill in for events, such as a membership application, permission slip or passenger list." },
  { term: "Form template", meaning: "A saved form that event staff can start a new form from. System administrators edit them." },
  { term: "Information form", meaning: "A survey or interest form that gathers answers only, with no registration or payment." },
  { term: "Monthly Record", meaning: "A club's monthly report, filled in by its director. It is not a form you build in the registration builder." },
  { term: "Question library", meaning: "Saved questions that anyone building a form can add." },
  { term: "Import preview", meaning: "A look at exactly what a file would create or change, shown before anything is saved. Nothing changes until you commit." },
  { term: "Central sender", meaning: "The one address every event's email is sent from. Events can set their own display name and reply-to, but not the sender address." },
  { term: "Paused event email", meaning: "An event whose email is kept here and not sent, for example a test event." },
  { term: "System readiness", meaning: "A page that separates what the app measured from what a person ticked. A tick is a record, not an approval." },
  { term: "Feature off", meaning: "An event feature that is switched off, so its pages and menu entries are hidden for that event. Event features shows what is on and who can switch it." },
  { term: "Archived event", meaning: "A finished event that has been put away. It stays readable by link and in Archived events." },
  { term: "Pathfinders and Adventurers", meaning: "The Seventh-day Adventist youth clubs. Pathfinders is for older youth and Adventurers for younger children." },
];
