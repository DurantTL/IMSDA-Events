import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HubLink } from "@/components/site-notices-view";
import { isCalendarPagePath } from "@/modules/calendar/calendar-href";
import { ministryLinkHref } from "@/modules/system-admin/homepage-ministries-domain";

// Links held in variables (ministry tiles, staff-written hub links) reach the calendar too; the literal-href guard in
// calendar-map-csp-1212 cannot see them, so they decide by the path instead (#1212).
describe("calendar map: links into the calendar decided by path (#1212)", () => {
  it("recognises the calendar page and nothing else", () => {
    for (const href of ["/calendar", "/calendar/", "/calendar?view=list&filter=ministry-1", "/calendar#calendar-day-detail"]) {
      expect(isCalendarPagePath(href)).toBe(true);
    }
    for (const href of ["/calendar/feed.ics", "/calendars", "/embed/calendar", "/admin/calendar", "/", "https://example.org/calendar"]) {
      expect(isCalendarPagePath(href)).toBe(false);
    }
  });

  it("a staff-written link into the calendar renders a plain anchor", () => {
    const html = renderToStaticMarkup(HubLink({ href: "/calendar?view=list", children: "See dates" }));
    expect(html).toBe('<a href="/calendar?view=list">See dates</a>');
  });

  it("the default ministry tile address is a calendar path", () => {
    expect(isCalendarPagePath(ministryLinkHref({ position: 1, linkHref: null }))).toBe(true);
  });
});
