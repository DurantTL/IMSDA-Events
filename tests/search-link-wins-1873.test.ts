// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/account/area-clubs/reports",
  useSearchParams: () => new URLSearchParams("month=2026-10"),
}));

import { AreaClubSearchForm } from "@/components/area-club-search-form";
import { SEARCH_DEBOUNCE_MS } from "@/components/search-as-you-type";
import { click, flush, mount, typeInto, type Mounted } from "./helpers/dom-render";

// #1873: typed text still waiting for its pause must not take the person back to the list after they click a link.
let mounted: Mounted | undefined;
let link: HTMLAnchorElement;
beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  window.history.replaceState(null, "", "/account/area-clubs/reports?month=2026-10");
  link = document.createElement("a");
  link.href = "/account/area/club-1/reports/2026-10";
  link.textContent = "Open the record";
  // jsdom does not navigate; the app's router would. Only the search's own navigation is under test.
  link.addEventListener("click", (event) => event.preventDefault());
  document.body.appendChild(link);
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  link.remove();
});

async function renderSearch() {
  mounted = await mount(createElement(AreaClubSearchForm, { basePath: "/account/area-clubs/reports", label: "Search clubs by name", month: "2026-10", query: "", shown: 3, total: 3 }));
  return mounted.container.querySelector<HTMLInputElement>("#area-club-search")!;
}

describe("a clicked link wins over a pending typed search (#1873)", () => {
  it("applies the typed search after its pause when nothing else happens", async () => {
    const input = await renderSearch();
    await typeInto(input, "Trailblazers");
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(nav.replace).toHaveBeenCalledWith("/account/area-clubs/reports?month=2026-10&q=Trailblazers", { scroll: false });
  });

  it("drops the pending search when a link outside the search form is clicked", async () => {
    const input = await renderSearch();
    await typeInto(input, "Trailblazers");
    await click(link);
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("keeps the pending search when the click is not on a link", async () => {
    const input = await renderSearch();
    await typeInto(input, "Trailblazers");
    await click(document.body);
    await flush(SEARCH_DEBOUNCE_MS + 50);
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});
