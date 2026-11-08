import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/navigation-link", () => ({ NavigationLink: ({ href, children, className }: { href: string; children: unknown; className?: string }) => createElement("a", { href, className }, children as never) }));

import { FormsCreateSection } from "@/components/forms-create/forms-create-section";
import { buildFormCreateEvents, formCreateChoices } from "@/modules/forms-hub/create-choices";
import { formsHubKindLabels } from "@/modules/forms-hub/rows";

describe("create choices (#1571)", () => {
  it("lists the four purposes with the existing creation pages", () => {
    expect(formCreateChoices.map((c) => [c.title, c.href, c.needsEvent])).toEqual([
      ["Registration form", "/registration-builder", true],
      ["Event information form", "/information-forms", true],
      ["General information form", "/admin/information-forms", false],
      ["Club form", "/admin/club-forms", false],
    ]);
  });

  it("tells a failed read from no events", () => {
    expect(buildFormCreateEvents(null)).toEqual({ state: "unavailable" });
    expect(buildFormCreateEvents([])).toEqual({ state: "empty" });
    expect(buildFormCreateEvents([{ id: "e1", name: "Synthetic Camp", startsAt: new Date("2099-01-01"), endsAt: new Date("2099-01-02") }])).toEqual({ state: "ready", events: [{ id: "e1", name: "Synthetic Camp" }] });
  });

  it("puts upcoming events first, soonest first, then past events, most recent first", () => {
    const at = (id: string, start: string, end: string) => ({ id, name: id, startsAt: new Date(start), endsAt: new Date(end) });
    const built = buildFormCreateEvents([
      at("old", "2026-01-01", "2026-01-02"), at("later", "2026-12-01", "2026-12-02"), at("older", "2025-01-01", "2025-01-02"), at("soon", "2026-11-10", "2026-11-12"),
    ], new Date("2026-11-08T12:00:00Z"));
    expect(built).toMatchObject({ state: "ready" });
    expect(built.state === "ready" && built.events.map((e) => e.id)).toEqual(["soon", "later", "old", "older"]);
  });

  it("labels directory kinds truthfully", () => {
    expect(formsHubKindLabels).toEqual({ CLUB: "Club form", GENERAL: "General information form", EVENT: "Event information form" });
  });
});

describe("FormsCreateSection", () => {
  const ready = buildFormCreateEvents([{ id: "e1", name: "Synthetic Camp", startsAt: new Date("2099-01-01"), endsAt: new Date("2099-01-02") }]);

  it("renders four cards, two GET forms with an event select, and two links", () => {
    const html = renderToStaticMarkup(createElement(FormsCreateSection, { events: ready }));
    expect(html.match(/data-testid="forms-create-card"/g)).toHaveLength(4);
    expect(html.match(/<form [^>]*action="\/(registration-builder|information-forms)"[^>]*method="get"|<form [^>]*method="get"[^>]*action="\/(registration-builder|information-forms)"/g)).toHaveLength(2);
    expect(html.match(/<select [^>]*name="event"/g)).toHaveLength(2);
    expect(html).toContain('<option value="e1">Synthetic Camp</option>');
    expect(html).toContain('href="/admin/information-forms"');
    expect(html).toContain('href="/admin/club-forms"');
    expect(html).toContain("built inside each event");
    expect(html).toContain("<h3");
    expect(html).toContain('aria-labelledby="forms-create-registration-label forms-create-registration-title"');
    expect(html).toContain('aria-labelledby="forms-create-event-information-label forms-create-event-information-title"');
    expect(html).not.toContain("styles.button");
  });

  it("shows Unavailable instead of the select when events could not be read", () => {
    const html = renderToStaticMarkup(createElement(FormsCreateSection, { events: { state: "unavailable" } }));
    expect(html).toContain("Unavailable");
    expect(html).toContain("Reload the page");
    expect(html).not.toContain("<select");
    expect(html).toContain('href="/admin/club-forms"');
  });

  it("says so when there are no events", () => {
    const html = renderToStaticMarkup(createElement(FormsCreateSection, { events: { state: "empty" } }));
    expect(html).toContain("no events yet");
    expect(html).toContain('href="/event-setup"');
    expect(html).not.toContain("<select");
  });
});
