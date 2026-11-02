/**
 * Sort whitelists for the club and conference screens (rule B1, #1458, round 2). Each list is a fixed `as const` array: an
 * address names a column from it, and a table's own fixed accessors (never the raw param) read the value to sort by. A key
 * that is not on the list, such as `name;drop` or `__proto__`, is the fallback order. Pure and client-safe.
 */
import { sortOrderText, type SortKind, type SortState } from "@/lib/list-sort";

/** No column chosen: the rows keep the order the page already gives them. Assignable to any list's sort state. */
export const UNSORTED = { key: null, dir: "asc" } as const;

/** Submitted forms an Area Coordinator sees for one club. */
export const AREA_CLUB_FORMS_SORT_COLUMNS = ["form", "subject", "submitted"] as const;

/** Event manager's registered clubs (/more/clubs). */
export const EVENT_CLUBS_SORT_COLUMNS = ["club", "going", "sterling", "registration"] as const;

/** Honors rosters: people in a class, totals by club, everyone on the site, one club's schedule. */
export const HONOR_CLASS_SORT_COLUMNS = ["name", "club", "age", "type"] as const;
export const HONOR_TOTALS_SORT_COLUMNS = ["club", "youth", "staff", "adults"] as const;
export const HONOR_SITE_SORT_COLUMNS = ["checkedIn", "name", "club", "site", "age", "type", "dietary"] as const;
export const HONOR_SCHEDULE_SORT_COLUMNS = ["name", "age"] as const;

/** Club event reports: camping, duties, milestones, special roles. */
export const CLUB_CAMPING_SORT_COLUMNS = ["club", "location", "tents", "trailers", "canopy", "sqft", "campNextTo", "pf", "tlt", "staff", "child", "total"] as const;
export const CLUB_DUTIES_SORT_COLUMNS = ["club", "location", "dutyAreas", "activities", "campsite", "duty", "activity"] as const;
export const CLUB_MILESTONES_SORT_COLUMNS = ["club", "location", "baptism", "bible"] as const;
export const CLUB_ROLES_SORT_COLUMNS = ["role", "name", "club", "location"] as const;

/** Operational reports: counts, ranked interest, roster by group, attendees by type, volunteers. */
export const REPORT_COUNTS_SORT_COLUMNS = ["choice", "count"] as const;
export const REPORT_SEMINAR_SORT_COLUMNS = ["option", "first", "second", "total"] as const;
export const REPORT_ROSTER_SORT_COLUMNS = ["attendee", "type", "registration", "holder"] as const;
export const REPORT_TYPES_SORT_COLUMNS = ["attendee", "group", "registration", "holder"] as const;
export const REPORT_VOLUNTEER_SORT_COLUMNS = ["volunteer", "answer", "phone", "group", "registration"] as const;

/** The words "Sorted by ..." uses for a column (and what the column holds, for "highest first" and the like). */
const SORT_WORDS: Record<string, string | { label: string; kind: SortKind }> = {
  form: "form", subject: "member or subject", submitted: { label: "date submitted", kind: "date" },
  club: "club", going: { label: "people going", kind: "number" }, sterling: { label: "Sterling Volunteers follow-ups", kind: "number" }, registration: "registration",
  name: "name", age: { label: "age", kind: "number" }, type: "type", youth: { label: "youth", kind: "number" }, staff: { label: "staff", kind: "number" },
  adults: { label: "adults", kind: "number" }, checkedIn: "checked in", site: "site", dietary: "dietary notes", location: "location",
  tents: { label: "tents", kind: "number" }, trailers: { label: "trailers", kind: "number" }, canopy: { label: "kitchen canopy", kind: "number" }, sqft: { label: "total sq ft", kind: "number" },
  campNextTo: "camp next to", pf: { label: "Pathfinders", kind: "number" }, tlt: { label: "TLT", kind: "number" }, child: { label: "children", kind: "number" }, total: { label: "total", kind: "number" },
  dutyAreas: "duty areas", activities: "activities", campsite: "assigned campsite", duty: "assigned duty", activity: "assigned activity", baptism: "baptism interest", bible: "Bible read-through",
  role: "role", choice: "choice or quantity", count: { label: "count", kind: "number" }, option: "option", first: { label: "first choices", kind: "number" }, second: { label: "second choices", kind: "number" },
  attendee: "attendee", holder: "account holder", group: "group", volunteer: "volunteer", answer: "answer", phone: "phone",
};

/** "Sorted by club, A to Z." for the column a server table is sorted by. */
export function sortLine<K extends string>(order: SortState<K>): string {
  const words = order.key !== null && Object.hasOwn(SORT_WORDS, order.key) ? SORT_WORDS[order.key]! : order.key ?? "";
  const { label, kind } = typeof words === "string" ? { label: words, kind: "text" as SortKind } : words;
  return sortOrderText(label, order.dir, kind);
}
