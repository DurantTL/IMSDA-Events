import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/more/event-settings",
}));
import { EventClubOptionsGroup } from "@/components/event-club-options-group";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { EventTeamSettingsPanel } from "@/components/event-team-settings-panel";
import { pageOwnsHeader, pagesWithOwnHeader } from "@/components/page-header-routes";
import { getEventPublishReadiness } from "@/modules/events/readiness";
import type { EventSettingsRecord } from "@/modules/events/repository";

// #1586 part 1: the inside of Event settings. Synthetic data only.
const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const fields = {
  id: "event-1", name: "Synthetic Camporee", slug: "synthetic-camporee", startsOn: "2027-10-08", endsOn: "2027-10-10",
  timezone: "America/Chicago", location: "Camp Heritage", capacity: 350, publicInfoUrl: null, supportContact: "registration@imsda.org",
  tagline: null, subtitle: null, helpEmail: null, hubTitle: null, hubIntro: null, refundPolicy: null,
  hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null,
  approvedPaymentInstructions: null, isPublished: false, archivedAt: null, showOnCalendar: true,
  registrationOpensOn: "2027-05-01", registrationClosesOn: "2027-10-01", paymentDueOn: null, waitlistEnabled: false,
  collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false,
  attendeeEditPolicy: "VERIFY_EVERY_EDIT" as const, billingMode: "ATTENDEE_PAY" as const, audience: "GENERAL" as const,
  seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false, autoPromoteWaitlist: false,
  featured: false, featuredOrder: null, featureUntil: null, publishedFormCount: 1, attendeeTypesWithAgeRangeCount: 1,
  attendeeTypeNames: ["Adult"], centralSenderEmail: "events@example.test", hasCancellationPolicy: true, publishedForms: [],
  createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z",
};

function render(overrides: Partial<typeof fields> = {}, mode: "edit" | "create" = "edit") {
  const merged = { ...fields, ...overrides };
  const event = { ...merged, readiness: getEventPublishReadiness(merged, merged.publishedFormCount), warnings: [] } as unknown as EventSettingsRecord;
  return renderToStaticMarkup(createElement(EventSettingsWorkspace, mode === "edit" ? { mode, initialEvent: event } : { mode, initialEvent: null }));
}

describe("Event settings header (#1586)", () => {
  it("draws the page's one h1 through PageHeader, with the status beside it and no old eyebrow", () => {
    const markup = render();
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1[^>]*>Event settings<\/h1>/);
    expect(markup).toContain("data-page-header");
    expect(markup).toMatch(/page-header-actions[^>]*>.*Private draft/);
    expect(markup).not.toContain("Event setup</p>");
    expect(render({ isPublished: true })).toMatch(/page-header-actions[^>]*>.*Published/);
  });

  it("lists the route so the shell draws no second h1", () => {
    expect(pagesWithOwnHeader.map((entry) => entry.pattern)).toContain("/more/event-settings");
    expect(pageOwnsHeader("/more/event-settings")).toBe(true);
  });

  it("keeps the create-mode intro, which sits under the Create an event header", () => {
    const markup = render({}, "create");
    expect(markup).not.toContain("<h1");
    expect(markup).toContain("New event setup");
  });
});

describe("One filled button (#1586)", () => {
  it("keeps Save event settings as the only submit button in the workspace", () => {
    const markup = render();
    expect(markup.match(/type="submit"/g)).toHaveLength(1);
    expect(markup).toContain("Save event settings");
  });

  it("makes Save team rules an outlined button", () => {
    const markup = renderToStaticMarkup(createElement(EventTeamSettingsPanel, { eventId: "event-1", initialSettings: null }));
    expect(markup).toMatch(/<button class="secondary-button"[^>]*type="submit"[^>]*>Save team rules/);
    expect(markup).not.toContain("primary-button");
  });
});

describe("Club event options and the jump bar (#1586)", () => {
  it("adds Locations to the jump bar for every event and Club event options only for club events", () => {
    const general = render();
    expect(general).toContain('href="#event-locations"');
    expect(general).not.toContain('href="#club-event-options"');
    const club = render({ audience: "CLUB" as never });
    expect(club).toContain('href="#event-locations"');
    expect(club).toContain('href="#club-event-options"');
    expect(render({ audience: "CLUB" as never }, "edit")).toContain("Club event options");
  });

  it("groups the club panels under one h2, with the panels' headings one level below", () => {
    const markup = renderToStaticMarkup(createElement(EventClubOptionsGroup, null, createElement(EventTeamSettingsPanel, { eventId: "event-1", initialSettings: null })));
    expect(markup).toContain('id="club-event-options"');
    expect(markup.match(/<h2/g)).toHaveLength(1);
    expect(markup).toMatch(/<h2[^>]*>Club event options<\/h2>/);
    expect(markup).toContain("apply to this event only");
    expect(markup).toMatch(/<h3[^>]*id="team-settings-heading"/);
  });

  it("renders the group only for club events on the page, and keeps each panel's own save", () => {
    const page = read("app/(workspace)/more/event-settings/page.tsx");
    expect(page).toMatch(/settings\.audience === "CLUB" && \(\s*<EventClubOptionsGroup>/);
    expect(page).toContain("<EventTeamSettingsPanel");
    expect(page).toContain("<EventGeneralLinkPanel");
    expect(read("components/event-general-link-panel.tsx")).toMatch(/<h3 id="general-link-heading"/);
  });
});
