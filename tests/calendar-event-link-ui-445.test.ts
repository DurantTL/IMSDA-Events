import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CalendarEntryRegistration } from "@/components/calendar-entry-registration";
import { CalendarDatesConfirmation, CalendarLinkBanner } from "@/components/calendar-link-banner";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { StartFromTemplate } from "@/components/start-from-template";
import type { CalendarLinkNotice } from "@/modules/calendar/event-links";
import type { CalendarAdminEntry, CalendarAdminEvent } from "@/modules/calendar/repository";

const entry: CalendarAdminEntry = {
  id: "entry-1",
  title: "Womens Retreat",
  description: "A weekend away.",
  startsOn: "2026-10-09",
  endsOn: "2026-10-11",
  timeLabel: "",
  location: "Camp Example",
  category: "",
  linkUrl: null,
  status: "SCHEDULED",
  entryType: "STANDARD",
  repeat: null,
  repeatExceptions: [],
  isPublished: true,
  sourceFeedId: "feed-1",
  sourceFeedName: "Synthetic Google calendar",
  isHiddenLocally: false,
  sourceRemovedAt: null,
  locallyEditedFields: [],
  updatedAt: "2026-10-01T00:00:00.000Z",
  canLinkToEvent: true,
  linkedEvent: null,
  datesDifferFromEvent: false,
  linkedIneligible: false,
  possibleMatch: null,
};
const events: CalendarAdminEvent[] = [
  { id: "event-1", name: "Women's Retreat 2026", startsOn: "2026-10-09", endsOn: "2026-10-11", isPublished: true, showOnCalendar: true, calendarCategory: "", linkedEntryId: null, linkedEntryTitle: null },
];
const send = async () => true;
const render = (overrides: Partial<CalendarAdminEntry>) =>
  renderToStaticMarkup(createElement(CalendarEntryRegistration, { entry: { ...entry, ...overrides }, events, saving: false, send }));

describe("calendar item registration actions (#445)", () => {
  it("offers Add registration (the Create event flow, filled in from the item) and Link to existing event", () => {
    const html = render({});
    expect(html).toContain('href="/event-setup?fromCalendarEntry=entry-1"');
    expect(html).toContain("Add registration");
    expect(html).toContain("Link to existing event");
    expect(html).not.toContain("Possible match");
  });

  it("flags a possible match with Link, Not the same and Add registration, and links nothing by itself", () => {
    const html = render({ possibleMatch: { id: "event-1", name: "Women's Retreat 2026", startsOn: "2026-10-09", endsOn: "2026-10-11", isPublished: true } });
    expect(html).toContain("Possible match:");
    expect(html).toContain("Nothing is linked automatically.");
    expect(html).toContain(">Link<");
    expect(html).toContain(">Not the same<");
    expect(html).toContain("Add registration");
    // The picker is offered beside the suggestion, not only after Not the same.
    expect(html).toContain("Link to existing event");
  });

  it("warns, without unlinking, when a linked item has become a deadline, closure or repeating item", () => {
    const linkedEvent = { id: "event-1", name: "Women's Retreat 2026", slug: "womens-retreat-2026", isArchived: false, isPublished: true, showOnCalendar: true, startsOn: "2026-10-09", endsOn: "2026-10-11" };
    const html = render({ linkedEvent, linkedIneligible: true, canLinkToEvent: false, entryType: "DEADLINE" });
    expect(html).toContain("calendar-linked-ineligible");
    expect(html).toContain("stays linked until you unlink it");
    expect(html).toContain("Unlink event");
    expect(render({ linkedEvent })).not.toContain("calendar-linked-ineligible");
  });

  it("still shows the link to an archived event, marked archived, with Unlink", () => {
    const html = render({
      linkedEvent: { id: "event-1", name: "Women's Retreat 2026", slug: "womens-retreat-2026", isArchived: true, isPublished: true, showOnCalendar: true, startsOn: "2026-10-09", endsOn: "2026-10-11" },
      datesDifferFromEvent: true,
    });
    expect(html).toContain("archived, ");
    expect(html).toContain("The event is archived and off the calendar, so this item shows on its own.");
    expect(html).not.toContain("shows this pair once");
    expect(html).not.toContain("update or keep them");
    expect(html).toContain("Unlink event");
  });

  it("shows a linked item with its event and Unlink, and says the pair shows once", () => {
    const html = render({
      linkedEvent: { id: "event-1", name: "Women's Retreat 2026", slug: "womens-retreat-2026", isArchived: false, isPublished: true, showOnCalendar: true, startsOn: "2026-10-09", endsOn: "2026-10-11" },
      datesDifferFromEvent: true,
      sourceRemovedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(html).toContain("Women&#x27;s Retreat 2026");
    expect(html).toContain("The calendar shows this pair once, as the event with Register");
    expect(html).toContain("Unlink event");
    expect(html).toContain('href="/more/event-settings?event=event-1"');
    expect(html).toContain("update or keep them");
    expect(html).toContain("Google no longer lists this item. The event was not changed.");
    expect(html).not.toContain("Add registration");
  });

  it("offers nothing for a closure, a deadline or a repeating item", () => {
    expect(render({ canLinkToEvent: false, entryType: "CLOSURE" })).toBe("");
  });
});

describe("the event's date banner (#445)", () => {
  const notice: CalendarLinkNotice = {
    sourceRemoved: false,
    datePrompt: {
      entryId: "entry-1",
      message: "Google Calendar moved this event to November 7–9, 2026. Update the registration dates?",
      itemStartsOn: "2026-11-07",
      itemEndsOn: "2026-11-09",
      eventStartsOn: "2026-10-09",
      eventEndsOn: "2026-10-11",
      preview: {
        changes: [{ label: "Event dates", from: "October 9–11, 2026", to: "November 7–9, 2026" }],
        unchanged: [{ label: "Registration closes", value: "October 5, 2026", needsAttention: false, note: "" }],
        notes: ["This event has 3 registrations. Update changes none of them."],
        blockedReason: null,
      },
      pricingNote: "Prices and any deadline written into a registration form stay as they are. Review them after updating.",
    },
  };
  const banner = (props: Partial<{ notice: CalendarLinkNotice }> = {}) =>
    renderToStaticMarkup(createElement(CalendarLinkBanner, { eventId: "event-1", notice, ...props }));

  it("asks the question, previews what changes and what stays, and offers Update and Keep", () => {
    const html = banner();
    expect(html).toContain("Google Calendar moved this event to November 7–9, 2026. Update the registration dates?");
    expect(html).toContain("October 9–11, 2026 becomes November 7–9, 2026");
    expect(html).toContain("Registration closes: October 5, 2026");
    expect(html).toContain("Update to November 7–9, 2026");
    expect(html).toContain("Keep current dates");
    expect(html).toContain("Prices and any deadline written into a registration form stay as they are.");
    expect(html).toContain("This event has 3 registrations.");
  });

  it("shows the confirmation from the page's own address, so it survives the reload", () => {
    const updated = renderToStaticMarkup(createElement(CalendarDatesConfirmation, { outcome: "updated" }));
    expect(updated).toContain("Registration dates updated");
    expect(updated).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(CalendarDatesConfirmation, { outcome: "kept" }))).toContain("Keeping the current registration dates");
    const banner = readFileSync(path.join(process.cwd(), "components/calendar-link-banner.tsx"), "utf8");
    expect(banner).toContain("calendarDates=${decision === \"update\" ? \"updated\" : \"kept\"}");
    expect(banner).toContain("router.refresh()");
  });

  it("disables Update, and says why, when the new dates can't work", () => {
    const blocked = { ...notice, datePrompt: { ...notice.datePrompt!, preview: { ...notice.datePrompt!.preview, blockedReason: "Registration is set to open after the new last day." } } };
    const html = banner({ notice: blocked });
    expect(html).toContain("Registration is set to open after the new last day.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Update to/);
  });

  it("warns, without any action, when the item is gone from Google", () => {
    const html = banner({ notice: { datePrompt: null, sourceRemoved: true } });
    expect(html).toContain("no longer in Google Calendar");
    expect(html).toContain("not removed or cancelled");
    expect(html).not.toContain("Keep current dates");
  });
});

describe("Add registration prefills the Create event flow (#445)", () => {
  const prefill = { entryId: "entry-1", title: "Womens Retreat", startsOn: "2026-10-09", endsOn: "2026-10-11", location: "Camp Example" };

  it("starts the blank form with the item's title, dates and location", () => {
    const html = renderToStaticMarkup(createElement(EventSettingsWorkspace, { mode: "create", initialEvent: null, calendarPrefill: prefill }));
    expect(html).toContain('value="Womens Retreat"');
    expect(html).toContain('value="womens-retreat"');
    expect(html).toContain('value="2026-10-09"');
    expect(html).toContain('value="2026-10-11"');
    expect(html).toContain('value="Camp Example"');
  });

  it("starts the template form with the item's title and dates", () => {
    const template = { id: "template-1", name: "Synthetic template", description: "", audience: "GENERAL", status: "PUBLISHED", canApply: true, versions: [] } as never;
    const html = renderToStaticMarkup(createElement(StartFromTemplate, { templates: [template], calendarPrefill: prefill }));
    expect(html).toContain('value="Womens Retreat"');
    expect(html).toContain('value="womens-retreat"');
    expect(html).toContain('value="2026-10-09"');
    expect(html).toContain('value="2026-10-11"');
  });

  it("sends the item's id with the save, and nothing else about the link", () => {
    const workspace = readFileSync(path.join(process.cwd(), "components/event-settings-workspace.tsx"), "utf8");
    const template = readFileSync(path.join(process.cwd(), "components/start-from-template.tsx"), "utf8");
    expect(workspace).toContain('mode === "create" && calendarPrefill ? { calendarEntryId: calendarPrefill.entryId }');
    expect(template).toContain("calendarEntryId: calendarPrefill.entryId");
  });
});

describe("calendar registration controls on a phone (#445)", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

  it("makes the link, Add registration and banner buttons 44px tap targets on a phone", () => {
    const phone = css.slice(css.indexOf("Calendar items and registration events (#445)"));
    const block = phone.slice(phone.indexOf("@media (max-width: 600px)"), phone.indexOf("/* Passkeys */"));
    expect(block).toContain(".calendar-entry-link .secondary-button");
    expect(block).toContain(".calendar-link-actions .primary-button");
    expect(block).toContain("min-height: 44px");
    expect(block).toContain(".calendar-link-picker select");
  });
});
