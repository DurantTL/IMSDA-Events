import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
import { OperationsSearchBar } from "@/components/operations-search-bar";
import {
  availableOperationsFilters,
  parseOperationsSearchParams,
  type SearchCatalog,
} from "@/modules/registrations/operations-search-domain";

const catalog: SearchCatalog = {
  waitlistEnabled: false,
  deferredBilling: false,
  attendeeTypes: [{ code: "ADULT", label: "Adult" }],
  locations: [],
  organizations: [{ id: "org-1", name: "Eagle Club" }],
  tags: [],
  questions: [{
    id: "ATTENDEE:meal", key: "meal", label: "Dinner choice", scope: "ATTENDEE", multi: false, sensitive: false, versionIds: ["v1"],
    choices: [{ value: "vegan", label: "Plant based" }],
  }],
};

function render(permissions: Parameters<typeof availableOperationsFilters>[0]["permissions"], qs = "", issues = false) {
  const { query } = parseOperationsSearchParams(new URLSearchParams(qs));
  const filters = availableOperationsFilters({ eventId: "event-a", permissions }, catalog);
  return renderToStaticMarkup(createElement(OperationsSearchBar, {
    basePath: "/people",
    carry: {},
    eventId: "event-a",
    filters,
    query,
    summary: { total: 120, page: 2, pageCount: 3, issues: issues ? [{ filter: "answer", code: "field-unavailable", message: "This form question is no longer offered as a filter, or is not available to you." }] : [] },
  }));
}

describe("OperationsSearchBar", () => {
  it("renders only the filters the server offered", () => {
    const withText = render(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"]);
    expect(withText).toContain('name="q"');
    expect(withText).toContain('name="answer"');
    expect(withText).toContain("Plant based");
    const plain = render(["VIEW_EVENT"]);
    expect(plain).not.toContain('name="q"');
    expect(plain).not.toContain('name="answer"');
    expect(plain).not.toContain('name="payment"');
  });

  it("shows the true total and links the neighbouring pages with the search kept", () => {
    const html = render(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"], "q=Jane&page=2");
    expect(html).toContain("Showing 51\u2013100 of 120 registrations");
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain("/people?q=Jane&amp;event=event-a");
    expect(html).toContain("page=3");
  });

  it("reports an issue instead of a count", () => {
    const html = render(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"], "", true);
    expect(html).toContain('role="alert"');
    expect(html).toContain("no longer offered");
    expect(html).not.toContain("Showing");
  });

  it("wraps the form in a disclosure that opens only when a filter or result is showing", () => {
    const closed = renderToStaticMarkup(createElement(OperationsSearchBar, {
      basePath: "/people", carry: {}, eventId: "event-a", query: parseOperationsSearchParams(new URLSearchParams("")).query,
      filters: availableOperationsFilters({ eventId: "event-a", permissions: ["VIEW_EVENT"] }, catalog), summary: null,
    }));
    expect(closed).toContain("<details");
    expect(closed).toContain("Advanced search");
    expect(closed).not.toMatch(/<details[^>]*\sopen/);
    expect(render(["VIEW_EVENT"], "status=CONFIRMED")).toMatch(/<details[^>]*\sopen/);
    expect(render(["VIEW_EVENT"], "", true)).toMatch(/<details[^>]*\sopen/);
  });

  it("keeps the disclosure closed when only the location is set, and opens it for a zero-result summary", () => {
    const { query } = parseOperationsSearchParams(new URLSearchParams("location=site-1"));
    const filters = availableOperationsFilters({ eventId: "event-a", permissions: ["VIEW_EVENT"] }, catalog);
    const base = { basePath: "/people", carry: {}, eventId: "event-a", filters, query };
    const locationOnly = renderToStaticMarkup(createElement(OperationsSearchBar, { ...base, summary: null }));
    expect(locationOnly).not.toMatch(/<details[^>]*\sopen/);
    const empty = renderToStaticMarkup(createElement(OperationsSearchBar, { ...base, summary: { total: 0, page: 1, pageCount: 1, issues: [] } }));
    expect(empty).toMatch(/<details[^>]*\sopen/);
  });
});
