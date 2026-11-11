import { eventRoles } from "@/modules/access/permissions";
import { roleDetails } from "@/modules/access/role-display";
import type { GlossaryTerm } from "@/modules/help/types";

const roleNames = eventRoles.map((role) => roleDetails[role].label).join(", ");

/** Plain-language words used across the staff workspace (#1077). Same rules as the guides: short, no names, no events. */
export const glossaryTerms: readonly GlossaryTerm[] = [
  { term: "System administration", meaning: "The pages for the whole organization, under Admin: events, clubs and churches, people and access, shared forms and templates, email and platform settings. Only system administrators have it." },
  { term: "Event workspace", meaning: "The pages for one event, shown as tabs: Event home, Registrations, Check-in, Communications, Money, Reports and Event setup. The event picker says which event you are in." },
  { term: "Event", meaning: "One gathering people register for, such as a retreat or a camp meeting. It starts as a private draft and is public only after it is published." },
  { term: "Event template", meaning: "A starting point for a new event, with its forms and settings already filled in. System administrators keep them under Admin, then Events." },
  { term: "Copy from a past event", meaning: "Starts a new draft from an earlier event's settings and forms. Dates, links to the old event, registrations and payments are not carried over. It is under Admin, then Events." },
  { term: "Team and event roles", meaning: `The Staff card on Event setup (the event team) is where an event's staff and their roles are managed. The event roles are ${roleNames}. A role decides which pages a person can open for that event.` },
  { term: "Staff invitation", meaning: "Adding a person to an event's staff with a role, on the Staff page. They get a one-time link to choose a password." },
  { term: "Club director grant", meaning: "Access to a club, not to an event's staff pages. A director leads a club. It is given by an administrator, or by the club's own director or deputy." },
  { term: "Attendee registration", meaning: "A person signing up for an event on the public pages. It never gives staff access." },
  { term: "Registration form", meaning: "The form people fill in to register for one event. It is built, tested and published under Event setup, then Registration forms." },
  { term: "Club form", meaning: "A form clubs fill in for events, such as a membership application, permission slip or passenger list. Staff see the answers under Event setup, then Club forms." },
  { term: "Form template", meaning: "A saved form that event staff can start a new form from. System administrators edit them under Admin, then Forms." },
  { term: "Information form", meaning: "A survey or interest form that gathers answers only, with no registration or payment." },
  { term: "Monthly Record", meaning: "A club's monthly report, filled in by its director. It is not a form you build in Registration forms." },
  { term: "Question library", meaning: "Saved questions that anyone building a form can add. System administrators keep the list under Admin, then Forms." },
  { term: "Import preview", meaning: "A look at exactly what an uploaded file would create or change, shown before anything is saved. Imports are under Registrations. Nothing changes until you commit." },
  { term: "Central sender", meaning: "The one address every event's email is sent from. A system administrator saves it under Admin, then Catalogs and settings, then Email. Events can set their own display name and reply-to, but not the sender address." },
  { term: "Paused event email", meaning: "An event whose email is held back and not sent, for example a test event. A system administrator sets this on the Email page." },
  { term: "System readiness", meaning: "A page in Admin that separates what the app measured from what a person ticked. A tick is a record, not an approval." },
  { term: "Feature off", meaning: "An event feature that is switched off, so its pages and menu entries are hidden for that event. Event features shows what is on and who can switch it." },
  { term: "Archived event", meaning: "A finished event that has been put away. It stays readable by link and in the Archived events list under Admin." },
  { term: "Pathfinders and Adventurers", meaning: "The Seventh-day Adventist (SDA) youth clubs. Pathfinders is for youth ages 10 to 15, and Adventurers is for children ages 4 to 9." },
];
