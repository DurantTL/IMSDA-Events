// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/people",
}));
vi.mock("@/components/use-accessible-dialog", () => ({ useAccessibleDialog: () => ({ current: null }) }));
const mocks = vi.hoisted(() => ({ resolveEventContext: vi.fn(), listRegistrations: vi.fn(), isClubAudienceEvent: vi.fn() }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: mocks.listRegistrations }));
vi.mock("@/modules/events/repository", () => ({ isClubAudienceEvent: mocks.isClubAudienceEvent }));

import AttendeeListingPage from "@/app/(workspace)/people/attendees/page";
import { PeopleWorkspace } from "@/components/people-workspace";
import { StaffInvitationList } from "@/components/staff-invitation-list";
import { SEARCH_DEBOUNCE_MS } from "@/components/search-as-you-type";
import { attendeeFiltersSet, parseAttendeeListingQuery } from "@/modules/registrations/attendee-listing";
import type { RegistrationRecord } from "@/modules/registrations/repository";
import type { InvitationListRow } from "@/modules/staff-invitations/repository";
import { buttonByText, mount, typeInto, type Mounted } from "./helpers/dom-render";

describe("attendeeFiltersSet", () => {
  it("is false for the defaults and true for any narrowing", () => {
    expect(attendeeFiltersSet(parseAttendeeListingQuery({}))).toBe(false);
    expect(attendeeFiltersSet(parseAttendeeListingQuery({ view: "meals", sort: "name" }))).toBe(false);
    expect(attendeeFiltersSet(parseAttendeeListingQuery({ q: "zzzz" }))).toBe(true);
    expect(attendeeFiltersSet(parseAttendeeListingQuery({ dietary: "1" }))).toBe(true);
    expect(attendeeFiltersSet(parseAttendeeListingQuery({ statuses: ["CONFIRMED", "CANCELLED"] }))).toBe(true);
  });
});

describe("/people/attendees empty states", () => {
  const render = async (params: Record<string, string>) => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt 1", name: "Synthetic Event" }, permissions: ["VIEW_SENSITIVE_DATA"] });
    mocks.listRegistrations.mockResolvedValue([]);
    mocks.isClubAudienceEvent.mockResolvedValue(false);
    return renderToStaticMarkup(await AttendeeListingPage({ searchParams: Promise.resolve(params) }));
  };

  it("filters set and no rows: nothing matches, with Clear filters back to the unfiltered list", async () => {
    const html = await render({ event: "evt 1", q: "zzzz" });
    expect(html).toContain("No attendees match &quot;zzzz&quot;");
    expect(html).toMatch(/<a[^>]*href="\/people\/attendees\?event=evt%201"[^>]*>Clear filters<\/a>/);
    expect(html).not.toContain("yet");
    expect(html).not.toContain(">Reset<");
  });

  it("no filters and no rows: nothing yet, no Clear filters", async () => {
    const html = await render({ event: "evt 1" });
    expect(html).toContain("No attendees yet");
    expect(html).not.toContain("Clear filters");
  });
});

const invite = (index: number): InvitationListRow => ({
  id: `inv-${index}`, email: `person${index}@example.test`, firstName: "Pat", lastName: `Sample${index}`, group: "STAFF", status: "NOT_SENT",
  sentAt: null, sendCount: 0, registeredAt: null, confirmationCode: null, usable: true, reissuable: false, reinvitable: false,
} as unknown as InvitationListRow);
const counts = { NOT_SENT: 2 } as never;

function registration(index: number): RegistrationRecord {
  return {
    id: `registration-${index}`, confirmationCode: `TEST-${String(index).padStart(4, "0")}`, status: "CONFIRMED",
    accountHolder: { firstName: "Pat", lastName: `Example${index}`, email: `pat${index}@example.test`, phone: "" },
    attendees: [{ id: `attendee-${index}`, firstName: "Casey", lastName: `Sample${index}`, email: "", phone: "", attendeeType: "ATTENDEE", checkedIn: false, checkedInAt: null }],
    payments: [], totalAmountCents: 0, balanceCents: 0, attendeeCount: 1, checkedInCount: 0, messages: [], adjustments: [],
  } as unknown as RegistrationRecord;
}

let mounted: Mounted;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => { await mounted?.unmount(); vi.useRealTimers(); });
const searchBox = () => mounted.container.querySelector<HTMLInputElement>('input[type="search"], input[placeholder]')!;
const pause = () => act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1); });

describe("staff invitation list: nothing matches", () => {
  const list = (truncated: boolean) => createElement(StaffInvitationList, { eventId: "e1", rows: [invite(1), invite(2)], counts, truncated, canSend: true });

  it("states the total and clears the search", async () => {
    mounted = await mount(list(false));
    await typeInto(searchBox(), "zzzz");
    await pause();
    const text = mounted.container.textContent ?? "";
    expect(text).toContain('No invitations match "zzzz"');
    expect(text).toContain("This list has 2 invitations.");
    expect(text).not.toContain("Nobody is invited yet");
    await act(async () => { buttonByText(mounted.container, "Clear filters").click(); });
    await pause();
    expect(mounted.container.textContent).not.toContain("No invitations match");
  });

  it("leaves the total out when the list is truncated", async () => {
    mounted = await mount(list(true));
    await typeInto(searchBox(), "zzzz");
    await pause();
    expect(mounted.container.textContent).toContain('No invitations match "zzzz"');
    expect(mounted.container.textContent).not.toContain("This list has");
  });

  it("nothing yet links to the import section", async () => {
    mounted = await mount(createElement(StaffInvitationList, { eventId: "e1", rows: [], counts, truncated: false, canSend: true }));
    expect(mounted.container.querySelector('a[href="#staff-invite-import-title"]')?.textContent).toBe("Import a CSV");
  });
});

describe("/people toolbar Clear filters", () => {
  const workspace = (extra: Record<string, unknown> = {}) => createElement(PeopleWorkspace, {
    eventId: "event-1", eventSlug: "synthetic-retreat", eventTimezone: "America/Chicago", waitlistEnabled: false,
    initialRegistrations: [registration(1), registration(2)], canEdit: true, canEmail: true, ...extra,
  });
  const toolbarClear = () => [...mounted.container.querySelectorAll("button")].filter((b) => b.textContent === "Clear filters" && b.classList.contains("text-button"));

  it("shows only while a client filter is active and rows are visible", async () => {
    mounted = await mount(workspace());
    expect(toolbarClear()).toHaveLength(0);
    await typeInto(mounted.container.querySelector<HTMLInputElement>("input[placeholder]")!, "Example1");
    await pause();
    expect(toolbarClear()).toHaveLength(1);
    await typeInto(mounted.container.querySelector<HTMLInputElement>("input[placeholder]")!, "zzzz");
    await pause();
    expect(toolbarClear()).toHaveLength(0);
    expect(mounted.container.textContent).toContain('No registrations match "zzzz"');
    expect(mounted.container.textContent).toContain("The event has 2 registrations.");
  });

  it("is not shown when the server narrowed the list (the search bar has its own)", async () => {
    mounted = await mount(workspace({ serverFiltered: true, pageScoped: true, serverQuery: "Example" }));
    await typeInto(mounted.container.querySelector<HTMLInputElement>("input[placeholder]")!, "Example1");
    await pause();
    expect(toolbarClear()).toHaveLength(0);
  });
});
