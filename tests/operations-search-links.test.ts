import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocationFilter } from "@/components/location-filter";
import { OperationsSearchBar } from "@/components/operations-search-bar";
import {
  availableOperationsFilters,
  parseOperationsSearchParams,
  serializeOperationsSearchQuery,
  type SearchCatalog,
} from "@/modules/registrations/operations-search-domain";

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));

describe("location links keep the whole search", () => {
  const locations = [{ id: "loc-1", name: "North" }, { id: "loc-2", name: "South" }];

  it("keeps repeated answer parameters and drops the page and the old location", () => {
    const params = new URLSearchParams(serializeOperationsSearchQuery(parseOperationsSearchParams(new URLSearchParams(
      "answer=ATTENDEE:meal=vegan&answer=REGISTRATION:transport=bus&q=Jane&page=4&location=loc-1&sort=name",
    )).query));
    params.set("event", "event-a");
    const html = renderToStaticMarkup(createElement(LocationFilter, { basePath: "/people", locations, params, selectedId: "loc-1" }));
    const links = hrefs(html).map((href) => new URL(href, "https://example.test").searchParams);
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.getAll("answer")).toEqual(["ATTENDEE:meal=vegan", "REGISTRATION:transport=bus"]);
      expect(link.get("q")).toBe("Jane");
      expect(link.get("sort")).toBe("name");
      expect(link.has("page")).toBe(false);
    }
    expect(links.map((link) => link.get("location"))).toEqual([null, "loc-1", "loc-2"]);
  });

  it("still accepts a plain record", () => {
    const html = renderToStaticMarkup(createElement(LocationFilter, { basePath: "/people", locations, params: { event: "event-a", filter: "PAID" }, selectedId: null }));
    expect(hrefs(html)[1]).toBe("/people?event=event-a&filter=PAID&location=loc-1");
  });
});

describe("the search bar carries what it cannot show", () => {
  const catalog: SearchCatalog = {
    waitlistEnabled: false, deferredBilling: false, attendeeTypes: [{ code: "ADULT", label: "Adult" }, { code: "YOUTH", label: "Youth" }],
    locations: [], organizations: [{ id: "org-1", name: "Eagle Club" }], tags: [],
    questions: [{ id: "ATTENDEE:meal", key: "meal", label: "Dinner choice", scope: "ATTENDEE", multi: false, sensitive: false, versionIds: ["v1"], choices: [{ value: "vegan", label: "Plant based" }, { value: "plain", label: "Plain" }] }],
  };
  const render = (qs: string) => {
    const { query } = parseOperationsSearchParams(new URLSearchParams(qs));
    const filters = availableOperationsFilters({ eventId: "event-a", permissions: ["VIEW_EVENT", "VIEW_SENSITIVE_DATA"] }, catalog);
    return renderToStaticMarkup(createElement(OperationsSearchBar, { basePath: "/people", carry: {}, eventId: "event-a", filters, query, summary: null }));
  };

  it("keeps the sort and page size as hidden fields", () => {
    const html = render("sort=name.desc&size=25&q=Jane");
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="sort"[^>]*value="name\.desc"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="size"[^>]*value="25"/);
    expect(render("q=Jane")).not.toContain('name="sort"');
  });

  it("offers several statuses and keeps those already chosen", () => {
    const html = render("status=CONFIRMED,CANCELLED");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="status"[^>]*value="CONFIRMED"/);
    expect(html.match(/checked=""/g)).toHaveLength(2);
  });

  it("keeps several values of one filter and several answers instead of dropping them", () => {
    const types = render("attendeeType=ADULT,YOUTH");
    expect(types).toMatch(/<input[^>]*type="hidden"[^>]*name="attendeeType"[^>]*value="ADULT,YOUTH"/);
    expect(types).not.toContain('<select name="attendeeType"');
    const answers = render("answer=ATTENDEE:meal=vegan&answer=ATTENDEE:meal=plain");
    expect(answers.match(/type="hidden" name="answer"/g)).toHaveLength(2);
  });

  it("offers the organization filter", () => {
    expect(render("organization=org-1")).toContain("Eagle Club");
  });
});
