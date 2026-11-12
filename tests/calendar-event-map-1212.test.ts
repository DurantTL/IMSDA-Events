import { describe, expect, it } from "vitest";
import {
  buildCalendarMapData,
  buildPopupContent,
  dropDelayMs,
  mapNoteText,
  markerLabel,
} from "@/components/calendar-map-content";
import type { CalendarItem } from "@/modules/calendar/domain";

/**
 * The calendar map (#1212) shows staff-typed site and event names. Its popup is built as nodes with textContent; this
 * minimal DOM records what is created and has no markup sink, so a name that was ever parsed as HTML would show up
 * as an element or throw.
 */
type FakeElement = {
  tagName: string;
  className: string;
  href?: string;
  children: FakeElement[];
  textContent: string;
  appendChild(child: FakeElement): FakeElement;
};

function fakeDocument() {
  const doc = {
    createElement(tag: string) {
      const element: FakeElement = {
        tagName: tag.toUpperCase(),
        className: "",
        children: [],
        textContent: "",
        appendChild(child) {
          this.children.push(child);
          return child;
        },
      };
      Object.defineProperty(element, "innerHTML", { set() { throw new Error("innerHTML must not be used"); } });
      return element;
    },
  };
  return doc as unknown as Document;
}

const formatDates = (startsOn: string, endsOn: string) => `${startsOn} to ${endsOn}`;

function eventItem(slug: string, overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    key: `event-${slug}`,
    kind: "EVENT",
    title: slug,
    description: "",
    startsOn: "2027-03-12",
    endsOn: "2027-03-14",
    timeLabel: "",
    location: "",
    category: "",
    href: `/events/${slug}`,
    status: "SCHEDULED",
    registrationOpen: false,
    ...overrides,
  };
}

const maple = { siteId: "org-maple", siteName: "Maple Grove Church", latitude: 41.5868, longitude: -93.625 };
const river = { siteId: "org-river", siteName: "Riverside Church", latitude: 38.9517, longitude: -92.3341 };

describe("buildCalendarMapData", () => {
  it("makes one pin per site, grouping that site's events soonest first", () => {
    const data = buildCalendarMapData([
      eventItem("later", { title: "Later", startsOn: "2027-06-01", endsOn: "2027-06-02", mapPoint: maple }),
      eventItem("sooner", { title: "Sooner", startsOn: "2027-03-12", mapPoint: maple }),
      eventItem("river-fest", { title: "River Fest", mapPoint: river }),
    ], formatDates);
    expect(data.groups.map((group) => [group.siteName, group.events.map((event) => event.title)])).toEqual([
      ["Maple Grove Church", ["Sooner", "Later"]],
      ["Riverside Church", ["River Fest"]],
    ]);
    expect(data.mappedEvents).toBe(3);
    expect(data.unmappedEvents).toBe(0);
    expect(data.groups[0].events[0]).toMatchObject({ href: "/events/sooner", dateLabel: "2027-03-12 to 2027-03-14" });
  });

  it("gives calendar entries and events without a mapped site no pin, and counts only the events left off", () => {
    const data = buildCalendarMapData([
      eventItem("pinned", { mapPoint: maple }),
      eventItem("no-site"),
      { ...eventItem("entry-1"), key: "entry-1", kind: "ENTRY", href: null, mapPoint: maple },
    ], formatDates);
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].events).toHaveLength(1);
    expect(data.mappedEvents).toBe(1);
    expect(data.unmappedEvents).toBe(1);
  });

  it("counts an event shown as several items once, under its own name and dates", () => {
    const base = { href: "/events/retreat", eventTitle: "Retreat", eventStartsOn: "2027-05-01", eventEndsOn: "2027-05-03", mapPoint: maple };
    const data = buildCalendarMapData([
      eventItem("a", { ...base, key: "entry-a", title: "Friday session", startsOn: "2027-05-01", endsOn: "2027-05-01" }),
      eventItem("b", { ...base, key: "entry-b", title: "Saturday session", startsOn: "2027-05-02", endsOn: "2027-05-02" }),
    ], formatDates);
    expect(data.groups[0].events).toEqual([{ title: "Retreat", href: "/events/retreat", startsOn: "2027-05-01", endsOn: "2027-05-03", dateLabel: "2027-05-01 to 2027-05-03" }]);
    expect(data.mappedEvents).toBe(1);
  });

  it("is empty when nothing is mapped", () => {
    expect(buildCalendarMapData([eventItem("plain")], formatDates)).toEqual({ groups: [], mappedEvents: 0, unmappedEvents: 1 });
  });
});

describe("labels", () => {
  const group = buildCalendarMapData([
    eventItem("a", { title: "Camp Meeting", mapPoint: maple }),
    eventItem("b", { title: "Men's Convention", startsOn: "2027-04-01", mapPoint: maple }),
  ], formatDates).groups[0];

  it("names a pin by its site and events", () => {
    expect(markerLabel(group)).toBe("Maple Grove Church: 2 upcoming events, Camp Meeting, Men's Convention");
    expect(markerLabel({ ...group, events: [group.events[0]] })).toBe("Maple Grove Church: 1 upcoming event, Camp Meeting");
  });

  it("says in plain text how many events are not on the map", () => {
    expect(mapNoteText(3, 0)).toBe("3 of 3 upcoming events are on the map.");
    expect(mapNoteText(1, 1)).toBe("1 of 2 upcoming events are on the map. 1 event has no map location and is listed below only.");
    expect(mapNoteText(2, 3)).toBe("2 of 5 upcoming events are on the map. 3 events have no map location and are listed below only.");
  });

  it("staggers the drop inside about 0.4s whatever the pin count", () => {
    expect(dropDelayMs(0, 1)).toBe(0);
    expect(dropDelayMs(2, 3)).toBe(120);
    expect(dropDelayMs(99, 100)).toBeLessThanOrEqual(400);
  });
});

describe("buildPopupContent", () => {
  it("shows the site, then each event as a link with its dates", () => {
    const [group] = buildCalendarMapData([eventItem("camp", { title: "Camp Meeting", mapPoint: maple })], formatDates).groups;
    const root = buildPopupContent(fakeDocument(), group) as unknown as FakeElement;
    expect(root.children[0]).toMatchObject({ tagName: "STRONG", textContent: "Maple Grove Church" });
    const item = root.children[1].children[0];
    expect(item.children[0]).toMatchObject({ tagName: "A", href: "/events/camp", textContent: "Camp Meeting" });
    expect(item.children[1]).toMatchObject({ tagName: "SMALL", textContent: "2027-03-12 to 2027-03-14" });
  });

  it("shows HTML typed into a name as literal text, never as markup", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const [group] = buildCalendarMapData([eventItem("evil", { title: payload, mapPoint: { ...maple, siteName: `<b>${payload}</b>` } })], formatDates).groups;
    const root = buildPopupContent(fakeDocument(), group) as unknown as FakeElement;
    expect(root.children[0].textContent).toBe(`<b>${payload}</b>`);
    expect(root.children[1].children[0].children[0].textContent).toBe(payload);
    const tags: string[] = [];
    const walk = (element: FakeElement) => { tags.push(element.tagName); element.children.forEach(walk); };
    walk(root);
    expect(tags).not.toContain("IMG");
    expect(tags).not.toContain("B");
    expect(markerLabel(group)).toContain(payload);
  });

  it("links only to this site's own paths", () => {
    const [group] = buildCalendarMapData([eventItem("x", { href: "//elsewhere.example/x", mapPoint: maple })], formatDates).groups;
    const root = buildPopupContent(fakeDocument(), group) as unknown as FakeElement;
    expect(root.children[1].children[0].children[0].tagName).toBe("SPAN");
  });
});
