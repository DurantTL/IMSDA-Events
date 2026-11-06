import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** #1565: event access stays reachable through the rail's Events item, outside the Clubs tab row. */
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/clubs/summary",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));

import { AppShell } from "@/components/app-shell";

const ShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;
const clubsView = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {} };
const user = { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null };
const shell = (events: Parameters<typeof AppShell>[0]["events"]) => renderToStaticMarkup(
  createElement(ShellElement, { events, user, defaultEventId: events[0]?.id ?? null, adminRoleView: clubsView }, createElement("p", null, "content")),
);

describe("the Clubs view and event access", () => {
  it("offers the Events workspace for a Clubs Administrator with event membership", () => {
    const html = shell([{ id: "evt_a", slug: "a", name: "Event A", permissions: ["VIEW_SENSITIVE_DATA"] }]);
    expect(html).not.toContain('id="event-picker"');
    expect(html).toContain("Club summary");
    // The rail's Events item opens the first tab this person can open in the event (no event view, so Registrations)...
    const rail = html.split('id="primary-navigation"')[1]?.split("</nav>")[0] ?? "";
    expect(rail).toContain('href="/people?event=evt_a"');
    expect(rail).toContain("<span>Events</span>");
    // ...and the Clubs row never lists event pages.
    const tabs = html.split('data-staff-tabs="true"')[1]?.split("</nav>")[0] ?? "";
    expect(tabs).not.toContain("/people");
  });

  it("does not offer Events when there is no event membership or Events role", () => {
    const html = shell([]);
    expect(html).not.toContain('id="event-picker"');
    expect(html).toContain("Club summary");
    expect(html).not.toContain('href="/people');
    expect(html).not.toContain("<span>Events</span>");
  });
});
