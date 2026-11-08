/** Documentation only: derive the staff subset of #1558 from existing registries. */
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildRouteMapping } from "../components/route-mapping";
import { areaTabs, staffAreaMeta, staffPlaceFor, type StaffAreaViewer } from "../components/staff-areas";
import { currentEventPlace, eventTabSpecs } from "../components/staff-event-tabs";

function pages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? pages(file) : entry.name === "page.tsx" ? [file] : [];
  });
}

/** A viewer who can reach every area, so each page's tab is named whatever role holds it today. */
const everything: StaffAreaViewer = {
  isSystemAdmin: true,
  held: ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"],
  activeRole: "SYSTEM_ADMIN",
  hasEvents: true,
  siteContentEditor: true,
  healthImport: true,
  clubYear: null,
  counts: {},
};

const rows = buildRouteMapping();
const files = [...pages("app/(workspace)"), "app/archived-events/page.tsx", "app/select-event/page.tsx", "app/check-in-station/page.tsx"];
const table = files.map((file) => {
  const route = file.replace(/^app(?:\/\(workspace\))?/, "").replace(/\/page\.tsx$/, "") || "/";
  return { file, route };
}).filter(({ route }) => route !== "/profile").sort((a, b) => a.route.localeCompare(b.route));

/** A route's place in the shell: the rail area, the tab, the view, and how a phone reaches it. */
function placeOf(route: string, query = "") {
  const sample = route.replace(/\[[^\]]+\]/g, "x");
  const params = new URLSearchParams(query);
  const place = staffPlaceFor(sample, params);
  const menu = place.inEvent ? "Event menu" : staffAreaMeta[place.area].menuLabel;
  if (place.inEvent) {
    const where = currentEventPlace(sample, params);
    const spec = eventTabSpecs.find((tab) => tab.key === where.tab);
    const view = spec?.views.find((candidate) => candidate.key === where.view);
    const phone = where.tab === "check-in" ? "bar: Check-in" : "More, This event";
    return { area: "Events (inside an event)", tab: spec?.label ?? "Event setup", view: view?.label ?? "", phone, menu, note: "" };
  }
  const tabs = areaTabs(place.area, everything);
  const tab = tabs.find((candidate) => candidate.key === place.tab);
  const view = tab?.views?.find((candidate) => candidate.key === place.view);
  const phone = place.area === "home" ? (place.tab ? "bar: Home" : "More")  : place.area === "events" ? "bar: Events" : place.area === "clubs" ? "bar: Clubs" : "More, Areas";
  return {
    area: staffAreaMeta[place.area].label,
    tab: tab?.label ?? (place.tab ? place.tab : "none (Help, Profile and pages no tab lists light Home and no tab)"),
    view: view?.label ?? "",
    phone,
    menu,
    note: "",
  };
}

const text = [
  "# Staff workspace route matrix (#1565)",
  "",
  "Generated with `npx tsx docs/generate-staff-workspace-map.ts`. This is the staff-only subset for #1558, not a second runtime registry or a decision to build a whole-system site-map page.",
  "",
  "The staff shell is a branded header, an icon rail of the areas a person can reach (Home, Events, Clubs, People, Reports, Admin), and below it that area's one row of tabs, or inside an event the event's tabs (Event home, Registrations, Check-in, Communications, Money, Reports, Event setup). Views inside a tab are a button strip. Below 1024px, or when a row would not fit, a row is a menu line (\"<Area> menu\" or \"Event menu\"). There is no sidebar. Each page belongs to exactly one place for the \"where you are\" marking; a page that two tabs list is the same page, and the area named here owns the marking.",
  "",
  "A role's tab row lists only the pages that role may open; every route keeps its server guard, and menu and search visibility keep their existing role, grant and module predicates. Record pages open through their existing parent links. Help and Profile light Home on the rail and no tab. No URL changes: aliases and redirects stay as they were.",
  "",
  "| Route | Previously reached from | Rail area | Tab | View | Phone | Menu line | Note | Source |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const { route, file } of table) {
  const exact = rows.find((row) => row.route === route);
  const parent = exact ?? rows.filter((row) => route.startsWith(row.route + "/")).sort((a, b) => b.route.length - a.route.length)[0];
  const where = placeOf(route);
  const notInRow = where.note.includes("not in the row");
  text.push(`| \`${route}\` | ${parent?.oldPlace ?? "Existing page link"} | ${where.area} | ${where.tab} | ${where.view || "-"} | ${notInRow ? "via /admin" : where.phone} | ${notInRow ? "-" : where.menu} | ${where.note || "-"} | \`${file}\` |`);
}
text.push("", `${table.length} staff page definitions. Dynamic patterns count once. Alias routes remain aliases. The table does not enumerate query states, permissions or approved data fields; those remain with each owning issue and page guard.`, "");

text.push("## Query states that move a page to another tab or view", "", "| Route and query | Rail area | Tab | View |", "| --- | --- | --- | --- |");
for (const [route, query] of [
  ["/admin/clubs/summary", ""],
  ["/admin/clubs/summary", "view=events"],
  ["/admin/clubs/summary", "view=records"],
  ["/admin/clubs/summary", "view=points"],
  ["/finance", ""],
  ["/finance", "filter=BALANCE"],
] as const) {
  const where = placeOf(route, query);
  text.push(`| \`${route}${query ? `?${query}` : ""}\` | ${where.area} | ${where.tab} | ${where.view || "-"} |`);
}

text.push(
  "",
  "## Home (#1568)",
  "",
  "Home is on the rail for every staff viewer and has two tabs. **Needs you** (`/home`) is the work waiting for the person, one section per admin role they hold, built from the same reads as the role pills so the numbers agree; every item links to the page that does the work, a read that failed says \"Unavailable\" (never zero or \"Nothing waiting\"), and \"Nothing needs you right now\" shows only when every read worked and found nothing. The tab's count is the held roles' counts added up, shown only when every held role's count was read. **Coming up** (`/home/coming-up`) lists the upcoming events the person can open, soonest first, each linking to its event home. Help and Profile also light Home but no tab. The phone bar's Home slot opens `/home`; where people land after sign-in is unchanged (the role switcher's decision, #108).",
  "",
  "## Club administration (#1568)",
  "",
  "`/admin/clubs` keeps its key numbers, with Review applications as the one main action, and lists every destination of the Clubs area as a card with its own status, in card groups (Clubs, Records and points, Applications, Club events and forms, People, Catalogs and imports). A card is a link only and is drawn only for a page the person can open; a number that cannot be read shows \"Unavailable\". Below the cards the page keeps New clubs (with its approve buttons), Registered clubs, Club events and Quick actions as they were. The Clubs tab Club administration overview lights as before.",
  "",
  "## Admin hub pages (#1569)",
  "",
  "Each Admin tab (Events, Clubs, People, Forms, Catalogs and settings) opens its own hub page under `/admin/hubs/`: a few key numbers, one main action, then a card for each destination with its own status. A card is a link only and is drawn only for a destination the person can open; a number that cannot be read shows \"Unavailable\", never zero. The hub lists every destination of its group, so the Forms and Catalogs tabs have no view buttons. The pages a hub links to keep their own area for the marking (for example Create an event is in Events); the Admin pages with no hub of their own light the Forms or Catalogs and settings tab. System administration (`/admin`) keeps the task directory and the Common tasks. Break-glass and legal-hold counts are not shown on the People hub: that page asks for the health privacy acknowledgment first.",
  "",
  "## Pages that used to be reached only through other pages",
  "",
  "| Page | Home now |",
  "| --- | --- |",
  "| Check-in passes, badges and keys (`/check-in/passes`, `/check-in/badges`, `/check-in/assets`) | Views of the Check-in tab: Attendee passes, Name badges, Keys and items |",
  "| `/finance` sub-pages (Owed by churches, Billing responsibility, Attendance reconciliation, Scholarship fund, Invoices, Cancellation rules and requests, Unmatched Square payments, Ledger check) | Money > Payments owns them for the marking, and the Payments page keeps its tool links; the \"More money tools\" grouped page waits for #1575 and is not listed until it exists |",
  "| `/people` sub-pages (Find duplicates, Directory review, Teams waiting for a club, Responsible adults, Staff invitations) | Registrations > Review queues owns them (#1574): the grouped page lists each one the person can open as a card, with a count where its own page already has one. `/people/matches` stays with All registrations |",
  "| Imports, Attendee list | Views of the Registrations tab |",
  "| Honors Weekend classes, instructors, rosters and schedule (`/more/honors/**`) | Event setup (the `/more` page, grouped cards) lists the classes card under Program, and the classes page links the other three |",
  "| Event features (`/more/features`) | A card in the Basics group of Event setup (the tab has no view strip) |",
  "| Event module requests (`/admin/feature-requests`) | The Event module requests section of the System administration dashboard (`/admin`); it is the page's own title now |",
  "| Club invites, Import clubs, Import health records, Sterling Volunteers | Views of the Clubs tabs New club applications and Club administration |",
  "| Archived events (`/archived-events`) | Events tab for system administrators and Event Administrators, and the event bar's link for everyone else |",
  "",
  "## Event setup (#1586)",
  "",
  "The Event setup tab opens one grouped page, `/more`, with no view strip: Basics, Registration, Program, Lodging and items, Sales, People, Clubs. Each card opens its own page and every page keeps its URL and its Event setup lighting. A card shows only when the person may open its page and, for a module page, the module is on for the event. Promo codes is the Money page and says so. The Team page (`/staff`) says it is the event staff team, not participant staff invitations or System account access. Health, change-of-type leftovers, modules that are off, Request a feature and the activity trail stay below the cards.",
  "",
  "## Left out until built",
  "",
  "- Events > All events: there is no in-shell list of all events yet. Staff open an event from the Events row's \"Open an event\" picker or the dashboards, and switch from the event bar.",
    "- Money > Refunds and More money tools (#1575), the reserved event tabs Operations and Safety (no feature or route exists, so none is listed).",
  "",
);
writeFileSync("docs/STAFF-WORKSPACE-ROUTES.md", text.join("\n"));
console.log(`Wrote ${table.length} staff route rows from existing registries.`);
