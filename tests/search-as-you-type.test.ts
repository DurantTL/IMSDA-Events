import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { OrganizationSearchControls } from "@/components/organization-search-controls";
import {
  SEARCH_DEBOUNCE_MS,
  SearchAsYouTypeForm,
  SearchResultStatus,
  createDebouncer,
  createTicket,
  searchAsYouTypeHref,
} from "@/components/search-as-you-type";

/** Search as you type everywhere (#1431), synthetic data only. */
describe("searchAsYouTypeHref", () => {
  const fields = (entries: Array<[string, string]>) => entries as Array<[string, FormDataEntryValue]>;

  it("keeps the other params and goes back to page 1 when the term changes", () => {
    expect(searchAsYouTypeHref("/admin/clubs", "?year=2026&q=old&page=3", fields([["year", "2026"], ["q", "eagles"]])))
      .toBe("/admin/clubs?year=2026&q=eagles");
    expect(searchAsYouTypeHref("/admin/people", "?role=a&page=2", fields([["q", "ann"]]))).toBe("/admin/people?role=a&q=ann");
  });

  it("drops an empty or blank q, and returns the bare path when nothing remains", () => {
    expect(searchAsYouTypeHref("/admin/clubs", "?q=old", fields([["q", "   "]]))).toBe("/admin/clubs");
    expect(searchAsYouTypeHref("/admin/clubs", "?year=2026&q=old", fields([["year", "2026"], ["q", ""]]))).toBe("/admin/clubs?year=2026");
  });

  it("trims the value and encodes it", () => {
    expect(searchAsYouTypeHref("/admin/clubs", "", fields([["q", "  Bay & Pines "]]))).toBe("/admin/clubs?q=Bay+%26+Pines");
  });

  it("writes every value of a multi-value field and clears a control left out of the data", () => {
    expect(searchAsYouTypeHref("/p", "?statuses=A", fields([["statuses", "B"], ["statuses", "C"]]))).toBe("/p?statuses=B&statuses=C");
    // An unchecked checkbox is absent from FormData, so the form's own control names clear it.
    expect(searchAsYouTypeHref("/p", "?statuses=A&sort=name", fields([]), { ownedParams: ["statuses"] })).toBe("/p?sort=name");
  });

  it("treats a select's all-value as empty and honours custom reset params", () => {
    expect(searchAsYouTypeHref("/o", "?status=ACTIVE", fields([["status", "ALL"]]), { ignoreValues: { status: "ALL" } })).toBe("/o");
    expect(searchAsYouTypeHref("/o", "?pg=4&page=4", fields([["q", "x"]]), { resetParams: ["pg"] })).toBe("/o?page=4&q=x");
  });
});

describe("createDebouncer and createTicket", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once after the pause, restarting on every keystroke", () => {
    const run = vi.fn();
    const debouncer = createDebouncer(run);
    debouncer.schedule();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    debouncer.schedule();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancels, and flushes only a pending call", () => {
    const run = vi.fn();
    const debouncer = createDebouncer(run, 100);
    debouncer.schedule();
    debouncer.cancel();
    vi.advanceTimersByTime(500);
    expect(run).not.toHaveBeenCalled();
    debouncer.flush();
    expect(run).not.toHaveBeenCalled();
    debouncer.schedule();
    debouncer.flush();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
  });

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
      {
        action: "/admin/clubs",
        className: "x",
        children: [
          createElement("input", { key: "y", name: "year", type: "hidden", value: "2026" }),
          createElement("input", { key: "q", defaultValue: "eag", name: "q", type: "search" }),
          createElement("button", { key: "b", type: "submit" }, "Search"),
        ],
      },
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
