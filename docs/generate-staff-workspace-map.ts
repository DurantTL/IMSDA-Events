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
  const phone = place.area === "home" ? "bar: Home" : place.area === "events" ? "bar: Events" : place.area === "clubs" ? "bar: Clubs" : "More, Areas";
  return {
    area: staffAreaMeta[place.area].label,
    tab: tab?.label ?? (place.tab ? place.tab : "none (Help, Profile and pages no tab lists light no rail item)"),
    view: view?.label ?? "",
    phone,
    menu,
    // A page under a hub-pending tab that is neither the tab's landing page nor one of its views has no link in the row or
    // the menu line. Its home is the System administration page (/admin), which lists every System group, and search.
    note: tab?.hubPending
      ? (!view && sample !== tab.href.split(/[?#]/)[0]
        ? "hub pending #1569; not in the row: linked from the System administration page (/admin) and Find a page or task"
        : "hub pending #1569")
      : "",
  };
}

const text = [
  "# Staff workspace route matrix (#1565)",
  "",
  "Generated with `npx tsx docs/generate-staff-workspace-map.ts`. This is the staff-only subset for #1558, not a second runtime registry or a decision to build a whole-system site-map page.",
  "",
  "The staff shell is a branded header, an icon rail of the areas a person can reach (Events, Clubs, People, Reports, Admin; Home waits for its own pages in #1568), and below it that area's one row of tabs, or inside an event the event's tabs (Event home, Registrations, Check-in, Communications, Money, Reports, Event setup). Views inside a tab are a button strip. Below 1024px, or when a row would not fit, a row is a menu line (\"<Area> menu\" or \"Event menu\"). There is no sidebar. Each page belongs to exactly one place for the \"where you are\" marking; a page that two tabs list is the same page, and the area named here owns the marking.",
  "",
  "A role's tab row lists only the pages that role may open; every route keeps its server guard, and menu and search visibility keep their existing role, grant and module predicates. Record pages open through their existing parent links. Help and Profile light no rail item. No URL changes: aliases and redirects stay as they were.",
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
  "## Hub pending (#1569)",
  "",
  "The Admin area's tabs Events, Clubs, People, Forms and Catalogs and settings are for each group's hub page, which #1569 builds. Until then each opens the group's first page the person may reach, and that page keeps its own area for the marking (for example Admin > Events opens Create an event, which is in the Events area). System administration (`/admin`) keeps the task directory and the Common tasks for every System group, so no System destination lost its link. The Admin tabs Forms and Catalogs and settings also show the Clubs Administrator's pages as views (Club forms, Public club forms page, Honor catalog, Club supply catalog).",
  "",
  "## Pages that used to be reached only through other pages",
  "",
  "| Page | Home now |",
  "| --- | --- |",
  "| Check-in passes, badges and keys (`/check-in/passes`, `/check-in/badges`, `/check-in/assets`) | Views of the Check-in tab: Attendee passes, Name badges, Keys and items |",
  "| `/finance` sub-pages (Owed by churches, Billing responsibility, Attendance reconciliation, Scholarship fund, Invoices, Cancellation rules and requests, Unmatched Square payments, Ledger check) | Money > Payments owns them for the marking, and the Payments page keeps its tool links; the \"More money tools\" grouped page waits for #1575 and is not listed until it exists |",
  "| `/people` sub-pages (Find duplicates, Directory review, Teams waiting for a club, Responsible adults, Staff invitations) | Registrations > All registrations owns them, and that page lists them as links; a review-queues page waits for #1574 |",
  "| Imports, Attendee list | Views of the Registrations tab |",
  "| Honors Weekend classes, instructors, rosters and schedule (`/more/honors/**`) | Event setup > All event tools (the `/more` directory) lists the classes card, and the classes page links the other three |",
  "| Event features (`/more/features`) | A view of Event setup |",
  "| Event module requests (`/admin/feature-requests`) | The Event module requests section of the System administration dashboard (`/admin`); it is the page's own title now |",
  "| Club invites, Import clubs, Import health records, Sterling Volunteers | Views of the Clubs tabs New club applications and Club administration |",
  "| Archived events (`/archived-events`) | Events tab for system administrators and Event Administrators, and the event bar's link for everyone else |",
  "",
  "## Left out until built",
  "",
  "- Home (Needs you, Coming up): #1568 builds the pages; until then the rail has no Home item and the phone bar's Home slot opens the person's main dashboard.",
  "- Events > All events: there is no in-shell list of all events yet. Staff open an event from the Events row's \"Open an event\" picker or the dashboards, and switch from the event bar.",
  "- Money > Refunds and More money tools (#1575), Registrations > Review queues (#1574), Event setup groups (#1571 and the setup issues), Admin hub pages (#1569), the reserved event tabs Operations and Safety (no feature or route exists, so none is listed).",
  "",
);
writeFileSync("docs/STAFF-WORKSPACE-ROUTES.md", text.join("\n"));
console.log(`Wrote ${table.length} staff route rows from existing registries.`);
