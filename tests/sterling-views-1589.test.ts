// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSterlingView, sterlingViewHref, sterlingViews } from "@/modules/background-checks/sterling-views";

/**
 * Sterling Volunteers as one screening task with three views (#1589 part D): People to follow up (default), Needs a
 * look and Youth and children's events. Presentation only: the same sign-in and Clubs administration checks, and each
 * view reads only what it shows.
 */
const mocks = vi.hoisted(() => ({
  user: { current: { id: "usr_synthetic", globalRole: "SYSTEM_ADMIN" } as { id: string; globalRole: string } | null },
  clubsAdmin: { current: true },
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }),
  listPeople: vi.fn(),
  summary: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => "/admin/organizations/background-checks",
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: mocks.user.current }) }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: async () => mocks.clubsAdmin.current }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/components/background-check-import-panel", () => ({ BackgroundCheckImportPanel: () => createElement("p", null, "UPLOAD-PANEL") }));
vi.mock("@/components/background-check-review-panel", () => ({ BackgroundCheckReviewPanel: () => createElement("p", null, "REVIEW-PANEL") }));
vi.mock("@/components/sterling-follow-up", () => ({ SterlingFollowUp: () => createElement("p", null, "FOLLOW-UP-LIST") }));
vi.mock("@/modules/background-checks/repository", () => ({ backgroundCheckSummary: mocks.summary }));
vi.mock("@/modules/background-checks/reminders", () => ({ listSterlingActionPeople: mocks.listPeople }));

import BackgroundChecksPage from "@/app/(workspace)/admin/organizations/background-checks/page";

async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(await BackgroundChecksPage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  mocks.user.current = { id: "usr_synthetic", globalRole: "SYSTEM_ADMIN" };
  mocks.clubsAdmin.current = true;
  mocks.listPeople.mockReset().mockResolvedValue({
    items: [], total: 0, page: 1, pageCount: 1, pageSize: 50, from: 0, to: 0,
    counts: { expiring: 2, notCurrent: 3, all: 9, current: 4 },
  });
  mocks.summary.mockReset().mockResolvedValue({
    lastRecordedAt: null,
    reviewCount: 5,
    unmatchedCount: 0,
    events: [{ id: "evt_synthetic", name: "Synthetic Camporee", startsOn: "2027-04-01", adults: 12, needed: 2 }],
  });
});

describe("the Sterling Volunteers views model", () => {
  it("defaults to People to follow up and ignores unknown views", () => {
    expect(parseSterlingView(undefined)).toBe("follow-up");
    expect(parseSterlingView("nope")).toBe("follow-up");
    expect(parseSterlingView(["events", "review"])).toBe("events");
    expect(parseSterlingView("review")).toBe("review");
  });

  it("keeps the default view's address bare and puts the others in ?view", () => {
    expect(sterlingViewHref("follow-up")).toBe("/admin/organizations/background-checks");
    expect(sterlingViewHref("review")).toBe("/admin/organizations/background-checks?view=review");
    expect(sterlingViewHref("events")).toBe("/admin/organizations/background-checks?view=events");
  });

  it("labels three views, marks the current one, and counts Needs a look", () => {
    const views = sterlingViews("review", 5);
    expect(views.map((view) => view.label)).toEqual(["People to follow up", "Needs a look (5)", "Youth and children’s events"]);
    expect(views.filter((view) => view.current).map((view) => view.key)).toEqual(["review"]);
  });
});

describe("the Sterling Volunteers page", () => {
  it("sends a signed-out visitor to sign in and a user without Clubs administration to no-access", async () => {
    mocks.user.current = null;
    await expect(render()).rejects.toThrow("REDIRECT:/login");
    mocks.user.current = { id: "usr_synthetic", globalRole: "STAFF" };
    mocks.clubsAdmin.current = false;
    await expect(render()).rejects.toThrow("REDIRECT:/no-access");
    expect(mocks.summary).not.toHaveBeenCalled();
  });

  it("opens on People to follow up with its filters, the upload and the view strip", async () => {
    const html = await render();
    expect(html).toContain("UPLOAD-PANEL");
    expect(html).toContain("FOLLOW-UP-LIST");
    expect(html).toContain("Expiring soon (2)");
    expect(html).toContain("All (9)");
    expect(html).toContain('aria-label="Sterling Volunteers views"');
    expect(html).toMatch(/aria-current="true"[^>]*>People to follow up</);
    expect(html).not.toContain("REVIEW-PANEL");
    expect(html).not.toContain("Synthetic Camporee");
    expect(mocks.listPeople).toHaveBeenCalledTimes(1);
  });

  it("shows only the review panel on Needs a look, without reading the follow-up list", async () => {
    const html = await render({ view: "review" });
    expect(html).toContain("REVIEW-PANEL");
    expect(html).toContain("UPLOAD-PANEL");
    expect(html).not.toContain("FOLLOW-UP-LIST");
    expect(html).toMatch(/aria-current="true"[^>]*>Needs a look \(5\)</);
    expect(mocks.listPeople).not.toHaveBeenCalled();
  });

  it("shows the events table on its own view, keeping the view in its sort links", async () => {
    const html = await render({ view: "events" });
    expect(html).toContain("Synthetic Camporee");
    expect(html).toContain("view=events");
    expect(html).not.toContain("FOLLOW-UP-LIST");
    expect(html).not.toContain("REVIEW-PANEL");
    expect(mocks.listPeople).not.toHaveBeenCalled();
  });

  it("keeps the screening notes on every view, folded under How the status is used", async () => {
    for (const view of ["follow-up", "review", "events"]) {
      const html = await render(view === "follow-up" ? {} : { view });
      expect(html).toContain("<summary>How the status is used</summary>");
      expect(html).toContain("registration is never blocked");
    }
  });
});

describe("the Sterling Volunteers upload actions", () => {
  it("keep a 44px tap target on desktop too, over the shared 36px desktop rule", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("components/background-check-import-panel.module.css", "utf8");
    expect(css).toMatch(/\.actions > :is\(a, button\)\s*\{\s*min-height: var\(--target-touch, 44px\);/);
    const panel = readFileSync("components/background-check-import-panel.tsx", "utf8");
    expect(panel).toContain("styles.actions");
  });
});
