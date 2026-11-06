// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), pathname: "/admin/clubs", search: "year=2026-27&page=3", busy: false, linkProps: [] as Record<string, unknown>[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/link", () => ({
  default: (props: Record<string, unknown> & { children?: ReactNode }) => {
    nav.linkProps.push(props);
    const { children, href, className } = props as { children?: ReactNode; href: string; className?: string };
    return createElement("a", { href, className, onClick: props.onClick as never }, children);
  },
}));
vi.mock("@/components/search-as-you-type", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/search-as-you-type")>();
  return { ...actual, useListNavigation: () => ({ ...actual.useListNavigation(), pending: nav.busy || actual.useListNavigation().pending }) };
});

import { GetFilterForm, filterFormHref } from "@/components/get-filter-form";
import { GuardedLink } from "@/components/guarded-link";
import { resolveLinkScroll } from "@/components/link-guard";
import { PhoneHiddenSortLink } from "@/components/phone-hidden-sort-link";
import { registerUnsavedChanges, setLeaveConfirmer } from "@/components/unsaved-changes-registry";
import { click, flush, mount, type Mounted } from "./helpers/dom-render";

let mounted: Mounted | undefined;
beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.pathname = "/admin/clubs";
  nav.search = "year=2026-27&page=3";
  nav.busy = false;
  nav.linkProps.length = 0;
  window.history.replaceState(null, "", "/admin/clubs?year=2026-27&page=3");
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

describe("resolveLinkScroll (#1557)", () => {
  it("keeps the place for the same page with a different query", () => {
    expect(resolveLinkScroll("/admin/clubs?sort=name", "/admin/clubs")).toBe(false);
    expect(resolveLinkScroll("?month=2026-10", "/admin/clubs")).toBe(false);
    expect(resolveLinkScroll("/admin/clubs/?page=2", "/admin/clubs")).toBe(false);
  });
  it("keeps the router default for another page, another site or a hash link", () => {
    expect(resolveLinkScroll("/admin/people", "/admin/clubs")).toBeUndefined();
    expect(resolveLinkScroll("https://example.org/admin/clubs", "/admin/clubs")).toBeUndefined();
    expect(resolveLinkScroll("/admin/clubs?sort=name#records", "/admin/clubs")).toBeUndefined();
    expect(resolveLinkScroll("/admin/clubs", null)).toBeUndefined();
  });
  it("scrolls to the top when the target is the exact address already shown", () => {
    expect(resolveLinkScroll("/admin/clubs?year=2026-27&page=3", "/admin/clubs", undefined, "?page=3&year=2026-27")).toBeUndefined();
    expect(resolveLinkScroll("/admin/clubs", "/admin/clubs", undefined, "")).toBeUndefined();
    expect(resolveLinkScroll("/admin/clubs?sort=name", "/admin/clubs", undefined, "?year=2026-27")).toBe(false);
    expect(resolveLinkScroll("/admin/clubs", "/admin/clubs", true, "")).toBe(true);
  });
  it("lets an explicit scroll prop win", () => {
    expect(resolveLinkScroll("/admin/clubs?sort=name", "/admin/clubs", true)).toBe(true);
    expect(resolveLinkScroll("/admin/people", "/admin/clubs", false)).toBe(false);
  });
});

describe("GuardedLink scroll (#1557)", () => {
  it("keeps scroll for a same-page query change and still scrolls for another page", async () => {
    mounted = await mount(createElement("div", null,
      createElement(GuardedLink, { href: "/admin/clubs?sort=name" }, "Sort"),
      createElement(GuardedLink, { href: "/admin/people" }, "People"),
      createElement(GuardedLink, { href: "/admin/people", scroll: false }, "Quiet"),
      createElement(GuardedLink, { href: "/admin/clubs?tab=a", scroll: true }, "Top")));
    const [sort, people, quiet, top] = Array.from(mounted.container.querySelectorAll("a"));
    await click(sort!);
    expect(nav.push).toHaveBeenLastCalledWith("/admin/clubs?sort=name", { scroll: false });
    await click(people!);
    expect(nav.push).toHaveBeenLastCalledWith("/admin/people", { scroll: undefined });
    await click(quiet!);
    expect(nav.push).toHaveBeenLastCalledWith("/admin/people", { scroll: false });
    await click(top!);
    expect(nav.push).toHaveBeenLastCalledWith("/admin/clubs?tab=a", { scroll: true });
  });
});

describe("sort link scroll (#1557)", () => {
  it("does not scroll to the top", () => {
    renderToStaticMarkup(createElement(PhoneHiddenSortLink, { href: "/admin/clubs?sort=name&dir=asc" } as never, "Name"));
    expect(nav.linkProps[0]).toMatchObject({ href: "/admin/clubs?sort=name&dir=asc", scroll: false });
  });
});

describe("GetFilterForm (#1557)", () => {
  const form = () => createElement(GetFilterForm, { action: "/admin/clubs", className: "year" },
    createElement("select", { name: "year", defaultValue: "2025-26" },
      createElement("option", { value: "2026-27" }, "2026-27"),
      createElement("option", { value: "2025-26" }, "2025-26")),
    createElement("input", { name: "q", type: "hidden", value: "" }),
    createElement("button", { type: "submit" }, "Show"));

  it("without script is still a plain GET form to the same action", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain('action="/admin/clubs"');
    expect(html).toContain('method="get"');
    expect(html).not.toContain("aria-busy");
  });

  it("with script pushes the filters into the address without scrolling to the top", async () => {
    mounted = await mount(form());
    await click(mounted.container.querySelector("button")!);
    // Empty fields stay out of the address and the page goes back to 1.
    expect(nav.push).toHaveBeenCalledWith("/admin/clubs?year=2025-26", { scroll: false });
  });

  it("does nothing when the address already has these filters", async () => {
    window.history.replaceState(null, "", "/admin/clubs?year=2025-26");
    mounted = await mount(form());
    await click(mounted.container.querySelector("button")!);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("leaves a submit button with its own formaction to the browser", async () => {
    mounted = await mount(createElement(GetFilterForm, { action: "/admin/clubs" }, createElement("button", { type: "submit", formAction: "/elsewhere" }, "Go")));
    // jsdom cannot really submit a form; the browser's own submit is what this test leaves alone.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await click(mounted.container.querySelector("button")!);
    quiet.mockRestore();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("resets the controls to the address when Back changes the search params (rule B2)", async () => {
    mounted = await mount(form());
    const select = mounted.container.querySelector("select") as HTMLSelectElement;
    select.value = "2026-27";
    expect(select.value).toBe("2026-27");
    nav.search = "year=2025-26";
    await mounted.root.render(form());
    await flush();
    expect(select.value).toBe("2025-26");
  });

  it("keeps a choice not applied yet when something else on the page changes the address", async () => {
    mounted = await mount(form());
    const select = mounted.container.querySelector("select") as HTMLSelectElement;
    select.value = "2026-27";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    nav.search = "year=2025-26&q=casey";
    await mounted.root.render(form());
    await flush();
    expect(select.value).toBe("2026-27");
  });

  it("resets a choice not applied yet when Back or Forward changes the address", async () => {
    mounted = await mount(form());
    const select = mounted.container.querySelector("select") as HTMLSelectElement;
    select.value = "2026-27";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    window.dispatchEvent(new PopStateEvent("popstate"));
    nav.search = "year=2025-26";
    await mounted.root.render(form());
    await flush();
    expect(select.value).toBe("2025-26");
  });

  it("asks before pushing when a form has unsaved changes, and Cancel changes nothing (rule B6)", async () => {
    const stop = registerUnsavedChanges("Leave this page?");
    let answer = false;
    const asked: string[] = [];
    const restore = setLeaveConfirmer(async (message) => { asked.push(message); return answer; });
    try {
      mounted = await mount(form());
      await click(mounted.container.querySelector("button")!);
      await flush();
      expect(asked).toEqual(["Leave this page?"]);
      expect(nav.push).not.toHaveBeenCalled();
      answer = true;
      await click(mounted.container.querySelector("button")!);
      await flush();
      expect(nav.push).toHaveBeenCalledWith("/admin/clubs?year=2025-26", { scroll: false });
    } finally {
      restore();
      stop();
    }
  });

  it("shows a busy state while the list is loading", () => {
    nav.busy = true;
    const html = renderToStaticMarkup(form());
    expect(html).toContain('aria-busy="true"');
  });

  it("builds the address from the action path and its fields", () => {
    expect(filterFormHref("/admin/people", [["role", "a"], ["role", "b"], ["q", " "]])).toBe("/admin/people?role=a&role=b");
    expect(filterFormHref("/admin/people", [])).toBe("/admin/people");
  });
});

describe("people list status row (#1557)", () => {
  it("puts the count and the active chips in one row, in a row that is always one chip tall", async () => {
    const { readFileSync } = await import("node:fs");
    const directory = readFileSync("components/people-directory.tsx", "utf8");
    const row = directory.slice(directory.indexOf("styles.statusRow"), directory.indexOf("</div>", directory.indexOf("styles.statusRow")));
    expect(row).toContain("id={PEOPLE_STATUS_ID}");
    expect(row).toContain('aria-live="polite"');
    expect(row).toContain("<PeopleActiveFilters");
    expect(readFileSync("components/people-active-filters.tsx", "utf8")).toContain("if (chips.length === 0) return null;");
    const css = readFileSync("components/people-directory.module.css", "utf8");
    // The row is always one chip tall, and on a phone the chips scroll sideways instead of wrapping to a new row.
    expect(css).toMatch(/\.statusRow \{[^}]*min-height: 54px/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.statusRow \.activeBar \{[^}]*overflow-x: auto/);
    expect(css).toMatch(/\.statusRow \.activeList \{[^}]*flex-wrap: nowrap[^}]*min-width: max-content/);
    // Search or Apply and Clear filters share one row on a phone, so Clear filters appearing never adds a row.
    expect(readFileSync("components/people-quick-filters.tsx", "utf8")).toMatch(/className=\{styles\.searchActions\}>[\s\S]*?Clear filters<\/Link>[\s\S]*?<\/div>/);
    expect(css).toMatch(/\.searchActions \{[^}]*flex-basis: 100%[^}]*flex-wrap: nowrap/);
  });
});
