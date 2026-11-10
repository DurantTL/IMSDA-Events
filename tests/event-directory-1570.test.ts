import { createElement as createTypedElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventDirectory } from "@/components/event-directory";
import {
  buildDirectoryRows,
  directoryStatusOptions,
  directorySortAccessors,
  filterDirectoryRows,
  parseDirectoryStatus,
  type DirectoryEventInput,
} from "@/components/event-directory-model";
import { eventStartChoices, EventStartChoices } from "@/components/event-start-choices";
import { CopyFromPastEvent } from "@/components/copy-from-past-event";
import { areaTabs, markCurrentTab, railItems, staffPlaceFor, type StaffAreaViewer } from "@/components/staff-areas";
import { sortRows } from "@/lib/list-sort";
import { source } from "./helpers/page-sources-1772";

// #1570: the event directory (search, status filter, sorting, paging, empty states), All events, the start choices and the
// create pages' unchanged client components. Synthetic data only.
const nav = vi.hoisted(() => ({ redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/events", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), redirect: nav.redirect }));
vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; globalRole: string } }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: session.user }) }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
const repo = vi.hoisted(() => ({ listEventsForUser: vi.fn() }));
vi.mock("@/modules/events/repository", () => ({ listEventsForUser: repo.listEventsForUser }));

const createElement = createTypedElement as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReactElement;
const html = (element: ReactElement) => renderToStaticMarkup(element);
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

const event = (id: string, name: string, day: number, extra: Partial<DirectoryEventInput> = {}): DirectoryEventInput => ({
  id,
  name,
  startsAt: new Date(Date.UTC(2027, 2, day, 15)),
  endsAt: new Date(Date.UTC(2027, 2, day + 1, 15)),
  timezone: "America/Chicago",
  location: "Sample Camp",
  archivedAt: null,
  isPublished: true,
  lifecycleState: "PUBLISHED",
  ...extra,
});

const sample = [
  event("e1", "Women's Retreat", 5),
  event("e2", "Camp Meeting", 12, { isPublished: false, lifecycleState: "DRAFT", location: "" }),
  event("e3", "Spring Camporee", 20, { lifecycleState: "REGISTRATION_CLOSED" }),
];

function directory(rows: ReturnType<typeof buildDirectoryRows>, searchParams: Record<string, string> = {}, props: Record<string, unknown> = {}) {
  return html(createElement(EventDirectory, {
    pathname: "/admin/events",
    searchParams,
    rows,
    hrefFor: (id: string) => `/overview?event=${id}`,
    defaultSort: { key: "dates", dir: "asc" },
    noEvents: { title: "No events yet", text: "There are no current events.", action: { label: "Create an event", href: "/event-setup" } },
    ...props,
  }));
}

describe("the directory rows (#1570)", () => {
  it("uses the status words the app already has for an event, and Archived for an archived one", () => {
    const rows = buildDirectoryRows([...sample, event("e4", "Old Event", 2, { archivedAt: new Date("2027-04-01T00:00:00Z") })]);
    expect(rows.map((row) => row.statusLabel)).toEqual(["Published", "Draft", "Registration closed", "Archived"]);
    expect(rows[0]!.dates).toContain("2027");
    expect(rows[1]!.place).toBe("");
  });

  it("reads an event with no lifecycle facts (the archive list) as archived, and a legacy null from isPublished", () => {
    expect(buildDirectoryRows([{ ...event("a", "A", 1), archivedAt: new Date(), isPublished: undefined, lifecycleState: undefined }])[0]!.statusLabel).toBe("Archived");
    expect(buildDirectoryRows([{ ...event("b", "B", 1), lifecycleState: null, isPublished: false }])[0]!.statusLabel).toBe("Draft");
  });

  it("searches name, dates, place and status with every word needed, and filters by status", () => {
    const rows = buildDirectoryRows(sample);
    expect(filterDirectoryRows(rows, { q: "", status: null })).toHaveLength(3);
    expect(filterDirectoryRows(rows, { q: "sample camp", status: null }).map((row) => row.id)).toEqual(["e1", "e3"]); // the place; the draft has none
    expect(filterDirectoryRows(rows, { q: "meeting draft", status: null }).map((row) => row.id)).toEqual(["e2"]);
    expect(filterDirectoryRows(rows, { q: "", status: "DRAFT" }).map((row) => row.id)).toEqual(["e2"]);
    expect(filterDirectoryRows(rows, { q: "zzz", status: null })).toEqual([]);
  });

  it("offers only the statuses present, in lifecycle order, and ignores an unknown status in the address", () => {
    expect(directoryStatusOptions(buildDirectoryRows(sample)).map((option) => option.label)).toEqual(["Draft", "Published", "Registration closed"]);
    expect(parseDirectoryStatus("DRAFT")).toBe("DRAFT");
    expect(parseDirectoryStatus("nonsense")).toBeNull();
    expect(parseDirectoryStatus(undefined)).toBeNull();
  });

  it("sorts by start date as a date, not as words", () => {
    const rows = buildDirectoryRows(sample);
    expect(sortRows(rows, "dates", "desc", directorySortAccessors).map((row) => row.id)).toEqual(["e3", "e2", "e1"]);
    expect(sortRows(rows, "event", "asc", directorySortAccessors).map((row) => row.name)).toEqual(["Camp Meeting", "Spring Camporee", "Women's Retreat"]);
  });
});

describe("the directory list (#1570)", () => {
  const rows = buildDirectoryRows(sample);

  it("shows a search box, a status filter, a sortable table with card labels and a link per row", () => {
    const markup = directory(rows);
    expect(markup).toContain('type="search"');
    expect(markup).toContain('name="status"');
    expect(markup).toContain("Showing 1–3 of 3 events");
    expect(count(markup, /aria-sort="(ascending|descending)"/g)).toBe(1);
    expect(markup).toContain("table-cards");
    expect(markup).toContain('data-label="Dates"');
    expect(markup).toContain('data-label="Status"');
    expect(markup).toContain('href="/overview?event=e1"');
    expect(markup).toContain("Sorted by start date, oldest first.");
    expect(markup).toContain('action="/admin/events" method="get"');
    expect(count(markup, /<h1\b/g)).toBe(0);
  });

  it("hides the Place column when no event has a place, and the status filter when there is one status", () => {
    const markup = directory(buildDirectoryRows([event("x", "Solo", 3, { location: null })]));
    expect(markup).not.toContain('data-label="Place"');
    expect(markup).not.toContain('name="status"');
  });

  it("narrows to the matches and says so, keeping Clear filters one click away", () => {
    const markup = directory(rows, { q: "meeting" });
    expect(markup).toContain("Showing 1–1 of 1 matching event (3 in total)");
    expect(markup).toContain('value="meeting"');
    expect(markup).toContain("Clear filters");
    expect(markup).not.toContain("Women&#x27;s Retreat");
  });

  it("says nothing matches (not that there are no events) when a search finds nothing", () => {
    const markup = directory(rows, { q: "zzz" });
    expect(markup).toContain("No events match");
    expect(markup).not.toContain("No events yet");
    expect(markup).toContain('href="/admin/events"');
  });

  it("says there are no events at all, with the next step, when the list is empty", () => {
    const markup = directory([]);
    expect(markup).toContain("No events yet");
    expect(markup).toContain('href="/event-setup"');
    expect(markup).not.toContain('type="search"');
    expect(count(markup, /primary-button/g)).toBe(0);
  });

  it("pages at 25 with the shared count line and links that keep the search and sort", () => {
    const many = buildDirectoryRows(Array.from({ length: 30 }, (_, index) => event(`m${index}`, `Event ${String(index).padStart(2, "0")}`, (index % 27) + 1)));
    const markup = directory(many, { sort: "event", dir: "asc" });
    expect(markup).toContain("Showing 1–25 of 30 events");
    expect(markup).toMatch(/href="\/admin\/events\?[^"]*page=2/);
    expect(markup).toMatch(/href="\/admin\/events\?[^"]*sort=event/);
    expect(directory(many, { page: "2" })).toContain("Showing 26–30 of 30 events");
  });

  it("carries a kept param in the search form, and lets a long name wrap", () => {
    const long = `${"Very long event name ".repeat(12)}Camporee`;
    const markup = directory(buildDirectoryRows([event("l", long, 4), event("l2", "Other", 6)]), {}, { keepParams: { unavailable: "1" } });
    expect(markup).toContain('type="hidden" name="unavailable" value="1"');
    expect(markup).toContain(long);
    const css = source("components/event-directory.module.css");
    expect(css).toMatch(/\.link \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/min-height: var\(--touch-target, 44px\)/);
  });

  it("records the last-used event only where asked (Choose an event)", () => {
    expect(source("app/select-event/page.tsx")).toContain("rememberOnOpen");
    expect(source("app/archived-events/page.tsx")).not.toContain("rememberOnOpen");
    expect(source("app/(workspace)/admin/events/page.tsx")).not.toContain("rememberOnOpen");
    expect(source("components/event-directory-link.tsx")).toContain("rememberLastUsedEvent");
  });
});

describe("All events (#1570)", () => {
  beforeEach(() => {
    nav.redirect.mockClear();
    repo.listEventsForUser.mockReset();
    repo.listEventsForUser.mockResolvedValue([{ ...event("e1", "Women's Retreat", 5), isBillingContainer: false }, { ...event("hidden", "Hidden billing", 6), isBillingContainer: true }]);
  });

  async function render(role: string | null) {
    session.user = role ? { id: "user_1", email: "staff@example.test", globalRole: role } : null;
    const { default: AllEventsPage } = await import("@/app/(workspace)/admin/events/page");
    return html(await AllEventsPage({ searchParams: Promise.resolve({}) }));
  }

  it("sends everyone but a System Administrator to /no-access, as /event-setup does, and reads no events for them", async () => {
    await expect(render("USER")).rejects.toThrow("redirect:/no-access?from=event-setup");
    await expect(render(null)).rejects.toThrow("redirect:/login");
    expect(repo.listEventsForUser).not.toHaveBeenCalled();
    expect(source("app/(workspace)/event-setup/page.tsx")).toContain('redirect("/no-access?from=event-setup")');
  });

  it("lists every current event for a System Administrator from the existing read, without archived or the hidden billing event", async () => {
    const markup = await render("SYSTEM_ADMIN");
    expect(repo.listEventsForUser).toHaveBeenCalledWith("user_1", true);
    expect(markup).toContain("Women&#x27;s Retreat");
    expect(markup).not.toContain("Hidden billing");
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup).toContain(">All events</h1>");
    expect(count(markup, /primary-button/g)).toBe(1);
    expect(markup).toMatch(/class="primary-button" href="\/event-setup">Create an event/);
    expect(markup).toContain('href="/archived-events"');
  });

  it("shows the no-events state with a way to create one", async () => {
    repo.listEventsForUser.mockResolvedValue([]);
    const markup = await render("SYSTEM_ADMIN");
    expect(markup).toContain("No events yet");
    expect(count(markup, /primary-button/g)).toBe(1);
  });

  it("leaves /events-admin and the assigned-events picker on their own reads", () => {
    expect(source("app/select-event/page.tsx")).toContain("listEventsForUser(session.user.id, false)");
    expect(source("app/(workspace)/events-admin/page.tsx")).not.toContain("EventDirectory");
  });
});

describe("the All events tab and where Events opens (#1570)", () => {
  const base: StaffAreaViewer = { isSystemAdmin: false, held: [], activeRole: null, hasEvents: true, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} };
  const system: StaffAreaViewer = { ...base, isSystemAdmin: true, held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"], activeRole: "SYSTEM_ADMIN" };
  const keys = (viewer: StaffAreaViewer) => areaTabs("events", viewer).map((tab) => tab.key);

  it("puts All events first for a System Administrator, and nowhere else", () => {
    expect(keys(system)).toEqual(["all-events", "calendar", "create", "copy", "templates", "archived"]);
    expect(areaTabs("events", system)[0]).toMatchObject({ label: "All events", href: "/admin/events" });
    expect(keys({ ...base, held: ["EVENTS_ADMIN"], activeRole: "EVENTS_ADMIN" })).toEqual(["event-administration", "archived"]);
    expect(keys({ ...base, held: ["CLUBS_ADMIN"], activeRole: "CLUBS_ADMIN" })).toEqual([]);
    expect(keys(base)).toEqual([]);
  });

  it("makes All events where the Events rail item opens for a System Administrator only", () => {
    expect(railItems(system, null).find((item) => item.area === "events")?.href).toBe("/admin/events");
    expect(railItems({ ...base, held: ["EVENTS_ADMIN"] }, null).find((item) => item.area === "events")?.href).toBe("/events-admin");
    expect(railItems(base, "/overview?event=e1").find((item) => item.area === "events")?.href).toBe("/overview?event=e1");
  });

  it("marks the one tab as current on the page", () => {
    expect(staffPlaceFor("/admin/events")).toMatchObject({ area: "events", tab: "all-events", inEvent: false });
    const marked = markCurrentTab(areaTabs("events", system), staffPlaceFor("/admin/events"));
    expect(marked.filter((tab) => tab.current).map((tab) => tab.key)).toEqual(["all-events"]);
  });
});

describe("the three starting choices (#1570)", () => {
  it("are Blank, Template and Copy, with today's three links and the calendar carry on the first two", () => {
    const carry = "?fromCalendarEntry=cal_1";
    expect(eventStartChoices.map((choice) => [choice.key, choice.href(carry)])).toEqual([
      ["blank", "/event-setup?fromCalendarEntry=cal_1#blank-event"],
      ["template", "/event-setup/from-template?fromCalendarEntry=cal_1"],
      ["copy", "/event-setup/copy"],
    ]);
    expect(eventStartChoices.map((choice) => choice.title)).toEqual(["Start blank", "Start from template", "Copy from a past event"]);
  });

  it("marks only the current page and says what each brings forward without promising more than the code does", () => {
    for (const current of ["blank", "template", "copy"] as const) {
      const markup = html(createElement(EventStartChoices, { current }));
      expect(count(markup, /aria-current="page"/g)).toBe(1);
      expect(markup).toMatch(new RegExp(`aria-current="page"[^>]*data-choice="${current}"|data-choice="${current}"[^>]*aria-current="page"`));
    }
    const text = eventStartChoices.map((choice) => choice.text).join(" ");
    expect(text).toContain("Registrations, attendees and payments are never copied");
    expect(text).toContain("private draft");
    const clones = source("modules/event-clones/domain.ts");
    expect(clones).toContain('"Registrations, attendees, and their answers"');
    expect(clones).toContain('"Payments, refunds, and adjustments"');
  });
});

describe("the create pages still mount the same client components (#1570)", () => {
  it("/event-setup keeps the create form and its calendar prefill", () => {
    const page = source("app/(workspace)/event-setup/page.tsx");
    expect(page).toContain('<EventSettingsWorkspace\n          mode="create"\n          initialEvent={null}');
    expect(page).toContain("calendarPrefill={prefill?.ok");
    expect(page).toContain('<EventStartChoices current="blank" carry={carry} />');
    expect(page).toContain('user.globalRole !== "SYSTEM_ADMIN"');
  });

  it("/event-setup/from-template keeps StartFromTemplate and its props", () => {
    const page = source("app/(workspace)/event-setup/from-template/page.tsx");
    expect(page).toMatch(/<StartFromTemplate\s+templates=\{templates\}\s+featureDefaults=\{featureDefaults\}\s+calendarPrefill=/);
    expect(page).toContain('<EventStartChoices current="template" carry={carry} />');
    expect(page).toContain('redirect("/no-access?from=event-setup")');
  });

  it("/event-setup/copy keeps CopyFromPastEvent with the same sources and adds the choices as an intro", () => {
    const page = source("app/(workspace)/event-setup/copy/page.tsx");
    expect(page).toContain("<CopyFromPastEvent sources={sources} intro={<EventStartChoices current=\"copy\" />} />");
    expect(page).toContain('redirect("/no-access?from=event-setup")');
  });

  it("the copy flow shows its step line and the choices before the draft exists, from the same state", () => {
    const sources = [{ id: "s1", name: "Last year", startsOn: "2026-03-01", endsOn: "2026-03-02", isPublished: true }];
    const markup = html(createElement(CopyFromPastEvent, { sources, intro: createElement("p", null, "INTRO") }));
    expect(markup).toContain("Step 1 of 3 · Choose the event");
    expect(markup.indexOf("INTRO")).toBeLessThan(markup.indexOf("Step 1 of 3"));
    expect(markup).toContain("Preview the copy plan");
    expect(count(markup, /<h1\b/g)).toBe(0);
  });

  it("the copy component's request and step logic is untouched (only the step line and intro were added)", () => {
    const copy = source("components/copy-from-past-event.tsx");
    expect(copy).toContain('"/api/event-clones/preview"');
    expect(copy).toContain("crypto.randomUUID()");
  });
});
