import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headerLinks: vi.fn(),
  listPublicClubs: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/site-content/hub-content", async () => ({ getPublishedHubContent: async () => ({ ...(await import("@/modules/site-content/hub-content-domain")).defaultHubContent(), navLinks: [{ label: "Unexpected category", href: "/unexpected-category" }] }) }));
// The header's session links read cookies and the database (#1009); they have their own tests.
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: ({ navLinks }: { navLinks?: unknown }) => { mocks.headerLinks(navLinks); return null; } }));
vi.mock("@/modules/organizations/public-club-directory", () => ({
  listPublicClubs: mocks.listPublicClubs,
}));

import PublicClubsPage from "@/app/(public)/clubs/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPublicClubs.mockResolvedValue([]);
});

describe("public club-ministry front door (#1534)", () => {
  it("reuses public branding and keeps discovery, forms, new-club and account destinations", async () => {
    const html = renderToStaticMarkup(await PublicClubsPage());
    expect(html).toContain("<h1>Club ministry</h1>");
    expect(html).toContain('aria-label="IMAdventist home"');
    for (const href of ["/calendar", "/events", "#find-a-club", "/clubs/forms", "/clubs/register", "/account"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("No clubs are listed publicly yet");
    expect(html).toContain("Only clubs that choose a public listing appear here.");
    expect(mocks.listPublicClubs).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.headerLinks).toHaveBeenCalledExactlyOnceWith([]);
  });
  it("renders shared searches before hydration and provides a native GET search", async () => {
    const base = { churchName: "Synthetic Church", town: "Example", state: "IA", zip: "50309", meetingSchedule: "", latitude: null, longitude: null };
    mocks.listPublicClubs.mockResolvedValue([
      { ...base, id: "a", clubName: "Prairie Pathfinders" },
      { ...base, id: "b", clubName: "River Adventurers" },
    ]);
    const html = renderToStaticMarkup(await PublicClubsPage({ searchParams: Promise.resolve({ q: ["Prairie", "River"] }) }));
    expect(html).toContain("Prairie Pathfinders");
    expect(html).not.toContain("River Adventurers");
    expect(html).toContain('action="/clubs"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="Prairie"');
  });

});
