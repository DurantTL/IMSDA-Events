import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    expect(html).toContain("120 registrations match");
    expect(html).toContain("page 2 of 3");
    expect(html).toContain("/people?q=Jane&amp;event=event-a");
    expect(html).toContain("page=3");
  });

  it("reports an issue instead of a count", () => {
    const html = render(["VIEW_EVENT", "VIEW_SENSITIVE_DATA"], "", true);
    expect(html).toContain('role="alert"');
    expect(html).toContain("no longer offered");
    expect(html).not.toContain("registrations match");
  });
});
