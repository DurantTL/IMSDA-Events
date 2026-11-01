import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { OrganizationSearchControls } from "@/components/organization-search-controls";
import {
  SearchAsYouTypeForm,
  SearchResultStatus,
  createTicket,
  searchAsYouTypeHref,
} from "@/components/search-as-you-type";

/** Search as you type everywhere (#1431), synthetic data only. */
describe("searchAsYouTypeHref", () => {
  const fields = (entries: Array<[string, string]>) => entries as Array<[string, FormDataEntryValue]>;

  it("sends only the form's own fields, like a native GET submit, and never the page", () => {
    expect(searchAsYouTypeHref("/admin/clubs", "?year=2026&q=old&page=3", fields([["year", "2026"], ["q", "eagles"]])))
      .toBe("/admin/clubs?year=2026&q=eagles");
    expect(searchAsYouTypeHref("/admin/people", "?role=a&page=2", fields([["q", "ann"]]))).toBe("/admin/people?q=ann");
    expect(searchAsYouTypeHref("/p", "", fields([["q", "x"], ["page", "4"]]))).toBe("/p?q=x");
  });

  it("does not carry a stale param the form has no field for (answerQuestion, registration)", () => {
    const href = searchAsYouTypeHref(
      "/people",
      "?event=e1&answerQuestion=meal&answerValue=vegan&registration=r1&q=old",
      fields([["event", "e1"], ["q", "ann"]]),
    );
    expect(href).toBe("/people?event=e1&q=ann");
    expect(href).not.toContain("answer");
    expect(href).not.toContain("registration");
  });

  it("carries a param only when the form opts in with keepParams", () => {
    expect(searchAsYouTypeHref("/p", "?tab=b&other=1", fields([["q", "x"]]), { keepParams: ["tab"] })).toBe("/p?tab=b&q=x");
  });

  it("drops an empty or blank q, and returns the bare path when nothing remains", () => {
    expect(searchAsYouTypeHref("/admin/clubs", "?q=old", fields([["q", "   "]]))).toBe("/admin/clubs");
    expect(searchAsYouTypeHref("/admin/clubs", "?year=2026&q=old", fields([["year", "2026"], ["q", ""]]))).toBe("/admin/clubs?year=2026");
  });

  it("trims the value and encodes it", () => {
    expect(searchAsYouTypeHref("/admin/clubs", "", fields([["q", "  Bay & Pines "]]))).toBe("/admin/clubs?q=Bay+%26+Pines");
  });

  it("writes every value of a multi-value field, and none for an unchecked box", () => {
    expect(searchAsYouTypeHref("/p", "?statuses=A", fields([["statuses", "B"], ["statuses", "C"]]))).toBe("/p?statuses=B&statuses=C");
    expect(searchAsYouTypeHref("/p", "?statuses=A&sort=name", fields([["sort", "name"]]))).toBe("/p?sort=name");
  });

  it("treats a select's all-value as empty and honours custom reset params", () => {
    expect(searchAsYouTypeHref("/o", "?status=ACTIVE", fields([["status", "ALL"]]), { ignoreValues: { status: "ALL" } })).toBe("/o");
    expect(searchAsYouTypeHref("/o", "", fields([["pg", "4"], ["q", "x"]]), { resetParams: ["pg"] })).toBe("/o?q=x");
  });
});

describe("createTicket", () => {
  it("only the newest ticket is current, so an older answer is dropped", () => {
    const ticket = createTicket();
    const first = ticket.next();
    const second = ticket.next();
    expect(ticket.isCurrent(first)).toBe(false);
    expect(ticket.isCurrent(second)).toBe(true);
    ticket.invalidate();
    expect(ticket.isCurrent(second)).toBe(false);
  });
});

describe("search-as-you-type markup", () => {
  it("SearchAsYouTypeForm is still a plain GET form with q and a submit button", () => {
    const html = renderToStaticMarkup(createElement(
      SearchAsYouTypeForm,
      { action: "/admin/clubs", className: "x" },
      createElement("input", { name: "year", type: "hidden", value: "2026" }),
      createElement("input", { defaultValue: "eag", name: "q", type: "search" }),
      createElement("button", { type: "submit" }, "Search"),
    ));
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/admin/clubs"');
    expect(html).toContain('name="q"');
    expect(html).toContain('type="submit"');
  });

  it("the live region is polite and hidden with the global sr-only class", () => {
    const html = renderToStaticMarkup(createElement(SearchResultStatus, { message: "3 clubs shown" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("3 clubs shown");
  });

  it("the organization filter bar (on the shared hook) is a GET form with q, Kind, Status and a Filter button", () => {
    const html = renderToStaticMarkup(createElement(OrganizationSearchControls, {
      basePath: "/admin/organizations/directory",
      kindOptions: [{ value: "", label: "All kinds" }],
      placeholder: "Name",
      searchLabel: "Search",
      state: { q: "grace", kind: "", status: "ALL" },
      statusOptions: [{ value: "ALL", label: "All" }],
    }));
    expect(html).toContain('method="get"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="grace"');
    expect(html).toContain("Filter</button>");
    expect(html).toContain('role="search"');
  });
});
