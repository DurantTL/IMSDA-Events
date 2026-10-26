/**
 * The public "Club forms" page (#1221) as data: three groups, each item with one plain line on who fills it in and
 * where it goes. Pure, so the links and the "Not available yet" rule are testable without a database.
 *
 * Director items do not link to a club directly (the page is public and does not know the visitor's club). They go
 * through `/account/clubs/choose?to=<key>`, and the key is looked up here in a fixed allowlist, so a visitor can never
 * make that page redirect anywhere else.
 */

/** Club-relative portal paths the chooser may send a director to. Keys are the only thing a URL can name. */
export const clubChooseTargets = {
  "roster-next-year": "roster/next-year",
  "monthly-records": "records",
  orders: "orders",
  "pathfinder-of-the-year": "forms/club_pathfinder_of_the_year/new",
  "tlt-of-the-year": "forms/club_tlt_of_the_year/new",
  "transportation-list": "forms/transportation_passenger_list/new",
  "can-collecting-report": "forms/can_collecting_report/new",
} as const;

export type ClubChooseKey = keyof typeof clubChooseTargets;

export function isClubChooseKey(value: unknown): value is ClubChooseKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(clubChooseTargets, value);
}

/** The signed-in destination for one club, or null for a key that is not on the allowlist. */
export function clubChooseDestination(organizationId: string, key: unknown): string | null {
  if (!isClubChooseKey(key)) return null;
  return `/account/clubs/${encodeURIComponent(organizationId)}/${clubChooseTargets[key]}`;
}

export type PublicClubFormItem = {
  id: string;
  name: string;
  /** One plain line on who fills it in. */
  who: string;
  /**
   * - REGISTER: a direct public link.
   * - DIRECTOR: the director fills it in; links through the club chooser.
   * - PRIVATE_LINK: the director sends a private link; nothing to open here.
   * - POINTER: text only.
   */
  kind: "REGISTER" | "DIRECTOR" | "PRIVATE_LINK" | "POINTER";
  chooseKey?: ClubChooseKey;
  /** The club form template behind the item, if any: when it is not turned on the item says "Not available yet." */
  templateKey?: string;
};

export type PublicClubFormGroup = { id: string; title: string; items: PublicClubFormItem[] };

export const PRIVATE_LINK_LINE = "Your club director sends this form by link.";
export const NOT_AVAILABLE_LINE = "Not available yet.";

export const publicClubFormGroups: readonly PublicClubFormGroup[] = [
  {
    id: "beginning",
    title: "Beginning of year",
    items: [
      { id: "new-club", name: "New Club Application", who: "Anyone who wants to start a new club.", kind: "REGISTER" },
      { id: "yearly-registration", name: "Yearly Club Registration", who: "The club director, to start the club's roster for next year.", kind: "DIRECTOR", chooseKey: "roster-next-year" },
      { id: "member-application", name: "Club Member Application", who: "A parent or guardian, for a new member.", kind: "PRIVATE_LINK", templateKey: "pathfinder_membership_application" },
      { id: "health-record", name: "Health Record", who: "A parent or guardian. Ask your club director for it.", kind: "POINTER" },
      { id: "tlt-application", name: "TLT Application", who: "A teen applying for the TLT program.", kind: "PRIVATE_LINK", templateKey: "club_tlt_application" },
      { id: "tlt-recommendation", name: "TLT Recommendation", who: "The person recommending a TLT applicant.", kind: "PRIVATE_LINK", templateKey: "tlt_program_recommendation" },
      { id: "staff-registration", name: "Staff Registration", who: "A staff member or volunteer.", kind: "PRIVATE_LINK", templateKey: "pathfinder_staff_service_information" },
    ],
  },
  {
    id: "end",
    title: "End of year",
    items: [
      { id: "pathfinder-of-the-year", name: "Pathfinder of the Year", who: "The club director, to nominate a Pathfinder.", kind: "DIRECTOR", chooseKey: "pathfinder-of-the-year", templateKey: "club_pathfinder_of_the_year" },
      { id: "tlt-of-the-year", name: "TLT of the Year", who: "The club director, to nominate a TLT.", kind: "DIRECTOR", chooseKey: "tlt-of-the-year", templateKey: "club_tlt_of_the_year" },
      { id: "year-end-report", name: "Year End Report", who: "The club director.", kind: "DIRECTOR", chooseKey: "monthly-records" },
    ],
  },
  {
    id: "ongoing",
    title: "Ongoing",
    items: [
      { id: "permission-slip", name: "Permission Slip", who: "A parent or guardian, for an off-premises activity.", kind: "PRIVATE_LINK", templateKey: "off_premises_permission_slip" },
      { id: "transportation-list", name: "Transportation List", who: "The club director or the trip's central contact.", kind: "DIRECTOR", chooseKey: "transportation-list", templateKey: "transportation_passenger_list" },
      { id: "can-collecting", name: "Can Collecting Report", who: "The club director.", kind: "DIRECTOR", chooseKey: "can-collecting-report", templateKey: "can_collecting_report" },
      { id: "monthly-report", name: "Monthly Report", who: "The club director or the person who reports for the club.", kind: "DIRECTOR", chooseKey: "monthly-records" },
      { id: "patch-pin-order", name: "Conference Patch & Pin Order", who: "The club director.", kind: "DIRECTOR", chooseKey: "orders" },
      { id: "photo-release", name: "Photo and Video Release", who: "A parent or guardian, for a minor.", kind: "PRIVATE_LINK", templateKey: "pathfinder_photo_video_release" },
    ],
  },
];

/** Every club form template key the page depends on, for the one narrow enabled-state query. */
export const publicClubFormTemplateKeys: readonly string[] = publicClubFormGroups.flatMap((group) => group.items.flatMap((item) => (item.templateKey ? [item.templateKey] : [])));

export type PublicClubFormView = {
  id: string;
  name: string;
  who: string;
  /** A link, or null when the item has none. */
  href: string | null;
  /** The plain line shown instead of a link, or null. */
  note: string | null;
};

/** What one item shows, given which club form templates are turned on. A template that is not listed counts as off. */
export function publicClubFormView(item: PublicClubFormItem, enabledTemplateKeys: ReadonlySet<string>): PublicClubFormView {
  const base = { id: item.id, name: item.name, who: item.who };
  if (item.templateKey && !enabledTemplateKeys.has(item.templateKey)) return { ...base, href: null, note: NOT_AVAILABLE_LINE };
  if (item.kind === "REGISTER") return { ...base, href: "/clubs/register", note: null };
  if (item.kind === "DIRECTOR" && item.chooseKey) return { ...base, href: `/account/clubs/choose?to=${item.chooseKey}`, note: null };
  if (item.kind === "PRIVATE_LINK") return { ...base, href: null, note: PRIVATE_LINK_LINE };
  return { ...base, href: null, note: null };
}
