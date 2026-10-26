import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** #1225 review: a Clubs Administrator with any event membership keeps the event picker and sidebar in the Clubs view. */
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
  it("keeps the event picker and event sidebar for a Clubs Administrator who holds an event membership (any role)", () => {
    const html = shell([{ id: "evt_a", slug: "a", name: "Event A", permissions: ["VIEW_SENSITIVE_DATA"] }]);
    expect(html).toContain('id="event-picker"');
    expect(html).toContain("Clubs summary");
    expect(html).toContain('href="/people?event=evt_a"');
  });

  it("hides the event picker and event sidebar only when there is no event at all", () => {
    const html = shell([]);
    expect(html).not.toContain('id="event-picker"');
    expect(html).toContain("Clubs summary");
    expect(html).not.toContain('href="/people');
  });
});
