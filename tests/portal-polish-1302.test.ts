// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalClubDirectory, portalDirectoryHref } from "@/modules/club-rosters/portal-directory";
import { PortalClubDirectory } from "@/components/portal-club-directory";
import { AccountWorkspaceMenu } from "@/components/account-workspace-menu";
import { AccountContent } from "@/components/account-content";

const mocks = vi.hoisted(() => ({ path: "/account/clubs/one", search: "", pending: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return h("a", props, children);
  },
  useLinkStatus: () => ({ pending: mocks.pending }),
}));

const clubs = Array.from({ length: 25 }, (_, index) => ({
  organizationId: `club-${index}`, name: `Synthetic club ${String(index).padStart(2, "0")}`,
  sponsoringChurch: index === 24 ? "Cedar & Oak" : "Synthetic church", city: "Bayport",
}));

describe("authorized portal directory", () => {
  it("paginates twelve clubs and preserves actual own-club and view-only destinations", () => {
    const roles = new Map([["club-0", "REPORTER" as const]]);
    const page = portalClubDirectory(clubs, roles, "", 1);
    expect(page.items).toHaveLength(12);
    expect(page.pageCount).toBe(3);
    expect(page.items[0]).toMatchObject({ href: "/account/clubs/club-0", roleLabel: "Reporter" });
    expect(page.items[1]).toMatchObject({ href: "/account/area/club-1", roleLabel: "View only" });
    expect(portalClubDirectory(clubs, roles, "", 2).from).toBe(13);
    expect(portalClubDirectory(clubs, roles, "", 999).items).toHaveLength(1);
    expect(portalClubDirectory(clubs, roles, "", NaN).page).toBe(1);
  });

  it("searches club, church and city before pagination without widening the input population", () => {
    expect(portalClubDirectory(clubs, new Map(), " Cedar & Oak ", 1).total).toBe(1);
    expect(portalClubDirectory(clubs, new Map(), "bayport", 1).total).toBe(25);
    expect(portalClubDirectory(clubs.slice(0, 2), new Map(), "club 24", 1).total).toBe(0);
    expect(clubs[0].name).toBe("Synthetic club 00");
    expect(portalDirectoryHref("Cedar & Oak", 2)).toBe("/account/clubs?q=Cedar+%26+Oak&page=2");
    expect(portalDirectoryHref("", 1)).toBe("/account/clubs");
  });

  it("renders named opening controls and query-preserving page links, with an honest empty state", () => {
    const slice = portalClubDirectory(clubs, new Map(), "Bayport", 2);
    const html = renderToStaticMarkup(h(PortalClubDirectory, { slice, query: "Bayport", total: clubs.length }));
    expect(html).toContain("Showing 13–24 of 25 matching clubs");
    expect(html).toContain("Open club");
    expect(html).toContain('href="/account/clubs?q=Bayport&amp;page=3"');
    expect(html).toContain('href="/account/area/club-12"');
    expect(html).not.toContain("/admin/");
    expect(renderToStaticMarkup(h(PortalClubDirectory, {
      slice: portalClubDirectory(clubs, new Map(), "No such club", 1), query: "No such club", total: 25,
    }))).toContain("No club, church or city matches");
  });
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  mocks.path = "/account/clubs/one"; mocks.search = ""; mocks.pending = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it("keeps account destinations reachable and closes the menu by Escape, outside press and focus departure", async () => {
  await act(async () => root.render(h(AccountWorkspaceMenu, { items: [
    { href: "/account/registrations", label: "My registrations" },
    { href: "/account/clubs", label: "My club", matchChildren: true },
  ] })));
  expect(host.querySelector('[href="/account/clubs"]')?.getAttribute("aria-current")).toBe("page");
  expect(host.querySelector('[href="/account/registrations"]')).not.toBeNull();
  expect(host.querySelector('[href="/account/profile"]')).toBeNull();
  const details = host.querySelector("details")!;
  details.open = true;
  await act(async () => details.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(host.querySelector("summary"));
  details.open = true;
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(details.open).toBe(false);
  details.open = true;
  const outside = document.createElement("button"); document.body.append(outside);
  host.querySelector("summary")!.focus();
  await act(async () => outside.focus());
  expect(details.open).toBe(false);
  outside.remove();
});

it("reuses the mounted account surface and focus, ignores search typing and respects reduced motion", async () => {
  let reduced = false;
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  const render = () => act(async () => root.render(h(AccountContent, null, h("input", { defaultValue: "Synthetic draft" }))));
  await render();
  const surface = host.querySelector<HTMLElement>("#account-content")!;
  Object.defineProperty(surface, "animate", { value: animate });
  const input = host.querySelector("input")!; input.value = "Unsaved changes"; input.focus();
  mocks.search = "q=Cedar"; await render();
  expect(animate).not.toHaveBeenCalled();
  mocks.path = "/account/registrations"; await render();
  expect(animate).toHaveBeenCalledOnce();
  expect(host.querySelector("#account-content")).toBe(surface);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Unsaved changes");
  reduced = true; mocks.path = "/account/profile"; await render();
  expect(animate).toHaveBeenCalledOnce();
});
