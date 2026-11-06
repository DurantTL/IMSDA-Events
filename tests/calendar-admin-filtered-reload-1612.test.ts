// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarAdminWorkspace } from "@/components/calendar-admin-workspace";
import { CalendarFeedsPanel } from "@/components/calendar-feeds-panel";
import { notOnPublicFilterLabel } from "@/components/calendar-category-select";
import type { CalendarAdminFeed } from "@/modules/calendar/feeds";
import type { CalendarCategoryChoices } from "@/modules/calendar/filter-groups";
import type { CalendarAdminEntry } from "@/modules/calendar/repository";
import { mount, type Mounted } from "./helpers/dom-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin/calendar", useSearchParams: () => new URLSearchParams() }));

const entry = { id: "e1", title: "Synthetic Rally", description: "", startsOn: "2099-05-01", endsOn: "2099-05-01", timeLabel: "", location: "Camp Example", category: "Youth", linkUrl: "", status: "SCHEDULED", entryType: "STANDARD", repeat: null, repeatExceptions: [], isPublished: true, sourceFeedId: null, sourceFeedName: null, isHiddenLocally: false, sourceRemovedAt: null, locallyEditedFields: [], updatedAt: "2026-01-01T00:00:00.000Z", canLinkToEvent: true, linkedEvent: null, datesDifferFromEvent: false, linkedIneligible: false, possibleMatch: null } as CalendarAdminEntry;
let mounted: Mounted;
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal("fetch", fetchMock); });
afterEach(async () => { await mounted?.unmount(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("a filtered Calendar admin link keeps its list (#1612)", () => {
  for (const category of ["Youth", "__none__"]) {
    it(`does not refetch the unfiltered list when opened with ?category=${category} (StrictMode runs effects twice)`, async () => {
      window.history.replaceState(null, "", `/admin/calendar?category=${category}`);
      mounted = await mount(createElement(StrictMode, null, createElement(CalendarAdminWorkspace, { initialEntries: [entry], initialEvents: [], initialQueryKey: `category=${category}` })));
      const listCalls = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.startsWith("/api/admin/calendar/entries"));
      expect(listCalls.filter((url) => !url.includes(`category=${category}`))).toEqual([]);
      expect(mounted.container.textContent).toContain("Synthetic Rally");
    });
  }
});

describe("the imported calendar's default category (#1612)", () => {
  const choices: CalendarCategoryChoices = { options: ["Pathfinders", "Conference"], matched: ["Pathfinders", "Conference"] } as unknown as CalendarCategoryChoices;
  const feed = { id: "f1", name: "Synthetic Feed", urlHint: "…abcd", defaultCategory: "Old Custom", defaultEntryType: "STANDARD", publishNewItems: false, isEnabled: true, refreshMinutes: 60 } as unknown as CalendarAdminFeed;

  it("is a dropdown, not free text", async () => {
    mounted = await mount(createElement(CalendarFeedsPanel, { choices, initialFeeds: [], onEntriesChange: () => {} }));
    const select = mounted.container.querySelector<HTMLSelectElement>('select[name="defaultCategory"]');
    expect(select).not.toBeNull();
    expect(mounted.container.querySelector('input[name="defaultCategory"]')).toBeNull();
    expect([...select!.options].map((option) => option.value)).toEqual(["Pathfinders", "Conference", ""]);
  });

  it("keeps an existing unmatched value with its mark when editing", async () => {
    mounted = await mount(createElement(CalendarFeedsPanel, { choices, initialFeeds: [feed], onEntriesChange: () => {} }));
    const edit = [...mounted.container.querySelectorAll("button")].find((button) => /edit/i.test(button.textContent ?? ""));
    expect(edit).toBeDefined();
    const { click } = await import("./helpers/dom-render");
    await click(edit!);
    const select = mounted.container.querySelector<HTMLSelectElement>('select[name="defaultCategory"]')!;
    expect(select.value).toBe("Old Custom");
    expect(select.selectedOptions[0].textContent).toBe(`Old Custom (${notOnPublicFilterLabel})`);
  });
});
