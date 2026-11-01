import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/people",
}));
vi.mock("@/components/use-accessible-dialog", () => ({ useAccessibleDialog: () => ({ current: null }) }));

import { EmptyState, NoMatchesState } from "@/components/empty-state";
import { PeopleWorkspace } from "@/components/people-workspace";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("EmptyState modes (#1449, rule 4)", () => {
  it("nothing matches: names the search, offers Clear filters, never 'yet' or a create action", () => {
    const html = renderToStaticMarkup(createElement(NoMatchesState, { noun: "registrations", query: "Jordan Ellis", known: "The event has 42 registrations.", clear: { href: "/people?event=e1" } }));
    expect(html).toContain("No registrations match &quot;Jordan Ellis&quot;");
    expect(html).toContain("The event has 42 registrations. Check the spelling");
    expect(html).toMatch(/<a[^>]*class="primary-button"[^>]*href="\/people\?event=e1"[^>]*>Clear filters<\/a>/);
    expect(html).not.toMatch(/yet|Start registration/i);
    expect(html).not.toContain('role="status"');
  });

  it("without text it says 'these filters', and a client list gets a button", () => {
    const html = renderToStaticMarkup(createElement(NoMatchesState, { noun: "invitations", clear: { onClick: () => undefined } }));
    expect(html).toContain("No invitations match these filters");
    expect(html).toContain(">Clear filters</button>");
    expect(html).not.toContain("Check the spelling");
  });

  it("nothing yet is unchanged: why, plus the create action only when allowed", () => {
    const props = { title: "No things yet", action: { label: "Add one", href: "/add" }, hint: "Ask an admin." };
    const allowed = renderToStaticMarkup(createElement(EmptyState, { ...props, canCreate: true }));
    expect(allowed).toContain("Add one");
    expect(allowed).toContain('role="status"');
    const denied = renderToStaticMarkup(createElement(EmptyState, props));
    expect(denied).not.toContain("Add one");
    expect(denied).toContain("Ask an admin.");
  });
});

describe("PeopleWorkspace empty states (#1449)", () => {
  const render = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(PeopleWorkspace, {
    eventId: "event-1", eventSlug: "synthetic-retreat", eventTimezone: "America/Chicago", waitlistEnabled: false,
    initialRegistrations: [], canEdit: true, canEmail: true, ...extra,
  }));

  it("a server search that found nothing says so and clears back to the unfiltered list", () => {
    const html = render({ serverFiltered: true, pageScoped: true, serverQuery: "zzzz" });
    expect(html).toContain("No registrations match &quot;zzzz&quot;");
    expect(html).not.toContain("No registrations yet");
    // The toolbar keeps its own Start registration; the empty state itself must not offer it.
    const emptyState = html.slice(html.indexOf('class="empty-state panel"'));
    expect(emptyState).not.toContain("Start registration");
    expect(emptyState).toContain('href="/people?event=event-1"');
    expect(html).toContain("Clear filters");
  });

  it("an event with no registrations and no filter stays 'nothing yet'", () => {
    const html = render({});
    expect(html).toContain("No registrations yet");
    expect(html).not.toContain("Clear filters");
  });
});

describe("list files render the shared empty states (source scan)", () => {
  const files = [
    "components/people-workspace.tsx",
    "app/(workspace)/people/attendees/page.tsx",
    "components/people-directory.tsx",
    "app/(workspace)/admin/organizations/directory/page.tsx",
    "components/staff-invitation-list.tsx",
  ];
  it.each(files)("%s uses NoMatchesState and none of the old wording", (file) => {
    const source = read(file);
    expect(source).toContain("NoMatchesState");
    expect(source).toMatch(/EmptyState/);
    for (const old of ["No matching registrations", "Nobody matches these filters", "Try fewer words or clear the filters", "No attendees match these filters", "No staff logins or website accounts", "Clear search and filter"]) {
      expect(source, old).not.toContain(old);
    }
    expect(source).not.toMatch(/>Reset</);
    expect(source).not.toMatch(/>Clear all</);
    expect(source).not.toMatch(/<(p|div) className="empty-state(?: panel)?">/);
  });

  it("every Clear label on the filtered staff lists says Clear filters", () => {
    expect(read("components/people-active-filters.tsx")).not.toContain(">Clear all<");
    expect(read("components/operations-search-bar.tsx")).toContain("Clear filters</Link>");
  });

  it("the invitation list's nothing-yet state links to the import section that exists", () => {
    expect(read("components/staff-invitation-list.tsx")).toContain('href: "#staff-invite-import-title"');
    expect(read("components/staff-invitation-import.tsx")).toContain('id="staff-invite-import-title"');
  });
});
