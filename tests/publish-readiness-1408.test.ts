import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1408: the publish checklist covers what silently blocks attendees. Synthetic data only. */
const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/more/event-settings",
}));

import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { CancellationUnavailableNote } from "@/components/cancellation-unavailable-note";
import { eventHasCancellationPolicy } from "@/modules/cancellation-policy/policy-in-effect";
import { transitionEventLifecycle } from "@/modules/events/lifecycle-repository";
import { EventOperationError } from "@/modules/events/operation-error";
import { CENTRAL_SENDER_MESSAGE, getEventPublishReadiness } from "@/modules/events/readiness";
import type { EventSettingsRecord } from "@/modules/events/repository";
import { campMeetingPreset } from "./support/camp-meeting-seeds";

const complete = {
  id: "evt_1", name: "Sample", slug: "sample", startsOn: "2027-06-01", endsOn: "2027-06-03", timezone: "America/Chicago",
  location: "Des Moines", supportContact: "help@example.test", audience: "GENERAL" as const, billingMode: "ATTENDEE_PAY" as const,
  centralSenderEmail: "events@example.test", attendeeTypesWithAgeRangeCount: 1, attendeeTypeNames: ["Adult", "Youth", "Child"], hasCancellationPolicy: true,
};

describe("required and recommended readiness items (#1408)", () => {
  it("splits what blocks from what is recommended, in the approved order", () => {
    const readiness = getEventPublishReadiness(complete, 1);
    expect(readiness.items.map((item) => item.id)).toEqual(["basics", "location", "support", "registration-form", "central-sender", "attendee-types"]);
    expect(readiness.recommendedItems.map((item) => item.id)).toEqual(["cancellation-policy", "public-info"]);
    expect(readiness.ready).toBe(true);
    expect(readiness.recommendedOpenCount).toBe(0);
  });

  it("a club event lists church billing and no attendee types; a general event the reverse", () => {
    const club = getEventPublishReadiness({ ...complete, audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE", attendeeTypesWithAgeRangeCount: 0 }, 1);
    expect(club.items.map((item) => item.id)).toEqual(["basics", "location", "support", "registration-form", "central-sender", "club-billing"]);
    expect(club.ready).toBe(true);
    const general = getEventPublishReadiness(complete, 1);
    expect(general.items.map((item) => item.id)).not.toContain("club-billing");
  });

  it("an unsaved or blank central sender blocks both kinds of event, and the done line names the address", () => {
    for (const centralSenderEmail of [null, "", "   "]) {
      for (const audience of ["GENERAL", "CLUB"] as const) {
        const readiness = getEventPublishReadiness({ ...complete, audience, billingMode: audience === "CLUB" ? "DEFERRED_ORGANIZATION_INVOICE" : "ATTENDEE_PAY", centralSenderEmail }, 1);
        expect(readiness.ready).toBe(false);
        expect(readiness.items.find((item) => item.id === "central-sender")).toMatchObject({
          complete: false,
          detail: "Confirmation and reminder emails wait until a system administrator saves the sender address.",
          actionLabel: "Ask a system administrator",
        });
      }
    }
    expect(getEventPublishReadiness(complete, 1).items.find((item) => item.id === "central-sender")).toMatchObject({ complete: true, detail: "Emails go out from events@example.test." });
  });

  it("a pure caller that has not loaded the sender leaves the item out; null means loaded and unsaved", () => {
    const { centralSenderEmail: _omitted, ...unloaded } = complete;
    void _omitted;
    expect(getEventPublishReadiness(unloaded, 1).items.map((item) => item.id)).not.toContain("central-sender");
    expect(getEventPublishReadiness({ ...unloaded, centralSenderEmail: null }, 1).items.map((item) => item.id)).toContain("central-sender");
  });

  it("a missing cancellation policy is recommended only: open, with its link, and never blocks", () => {
    const readiness = getEventPublishReadiness({ ...complete, hasCancellationPolicy: false }, 1);
    expect(readiness.ready).toBe(true);
    expect(readiness.recommendedOpenCount).toBe(1);
    expect(readiness.recommendedItems[0]).toMatchObject({
      id: "cancellation-policy",
      label: "Cancellation policy set",
      complete: false,
      detail: "Without one, attendees can't ask to cancel online. They see a line telling them to contact the support contact.",
      actionLabel: "Set a cancellation policy",
      href: "/finance/cancellation-policy?event=evt_1",
    });
  });
});

describe("the one cancellation policy rule (#1408)", () => {
  const client = (rows: unknown[]) => ({ eventCancellationPolicyVersion: { findMany: vi.fn().mockResolvedValue(rows) } }) as never;
  const rules = campMeetingPreset("2026-05-25");

  it("counts a parsed version whose effective time has arrived, and nothing else", async () => {
    const past = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-06-01T00:00:00Z");
    expect(await eventHasCancellationPolicy(client([{ id: "p", version: 1, effectiveFrom: past, rules }]), "e", now)).toBe(true);
    expect(await eventHasCancellationPolicy(client([]), "e", now)).toBe(false);
    expect(await eventHasCancellationPolicy(client([{ id: "p", version: 1, effectiveFrom: new Date("2027-01-01T00:00:00Z"), rules }]), "e", now)).toBe(false);
    expect(await eventHasCancellationPolicy(client([{ id: "p", version: 1, effectiveFrom: past, rules: { nonsense: true } }]), "e", now)).toBe(false);
  });
});

type Row = {
  name: string; slug: string; startsAt: Date; endsAt: Date; timezone: string; location: string | null; publicInfoUrl: string | null;
  supportContact: string | null; isPublished: boolean; audience: "GENERAL" | "CLUB"; billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE";
  archivedAt: Date | null; lifecycleState: string | null; lifecycleVersion: number;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  name: "Synthetic Retreat", slug: "synthetic-retreat", startsAt: new Date("2027-10-08T12:00:00.000Z"), endsAt: new Date("2027-10-10T12:00:00.000Z"),
  timezone: "America/Chicago", location: "Camp Heritage", publicInfoUrl: null, supportContact: "registration@example.test", isPublished: false,
  audience: "GENERAL", billingMode: "ATTENDEE_PAY", archivedAt: null, lifecycleState: null, lifecycleVersion: 0, ...overrides,
});

function mockPrisma(current: Row, options: { sender?: string | null; types?: Array<{ label: string; minimumAge: number | null }> } = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "event-1" }]),
    event: { findUnique: vi.fn().mockResolvedValue(current), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    registrationFormVersion: { count: vi.fn().mockResolvedValue(1) },
    platformSettings: { findUnique: vi.fn().mockResolvedValue({ defaultSenderEmail: options.sender === undefined ? "events@example.test" : options.sender }) },
    eventAttendeeType: { findMany: vi.fn().mockResolvedValue(options.types ?? [{ label: "Adult", minimumAge: 18 }]) },
    eventLifecycleTransition: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  dependencies.getPrisma.mockReturnValue({ $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) });
  return tx;
}

const configure = { userId: "usr_1", permissions: ["CONFIGURE_EVENT"] as const };
const publish = (from: "DRAFT" | "TEST" = "DRAFT") => transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", expectedFromState: from, actor: configure, now: new Date("2027-07-01T12:00:00Z") });

async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error; }
  return null;
}

beforeEach(() => vi.clearAllMocks());

describe("the server gate enforces the required items (#1408)", () => {
  it("blocks a missing, null or blank central sender with the administrator message, for general and club events", async () => {
    for (const sender of [null, "", "   "]) {
      mockPrisma(row(), { sender });
      const general = await failure(publish());
      expect(general).toBeInstanceOf(EventOperationError);
      expect(general).toMatchObject({ code: "EVENT_NOT_READY", message: CENTRAL_SENDER_MESSAGE });
      expect((general as Error).message).toContain("Ask a system administrator to set this up");
    }
    mockPrisma(row({ audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" }), { sender: null, types: [] });
    expect(await failure(publish())).toMatchObject({ code: "EVENT_NOT_READY", message: CENTRAL_SENDER_MESSAGE });
  });

  it("keeps the sender sentence when something else is missing too", async () => {
    mockPrisma(row({ location: null }), { sender: null });
    const error = (await failure(publish())) as Error;
    expect(error.message).toContain("event location");
    expect(error.message).toContain("Ask a system administrator to set this up");
  });

  it("blocks a general event with no adult attendee type, and not a club event", async () => {
    mockPrisma(row(), { types: [{ label: "Child", minimumAge: null }] });
    expect(await failure(publish())).toMatchObject({ code: "EVENT_NOT_READY", message: expect.stringContaining("attendee types set") });
    mockPrisma(row(), { types: [] });
    expect(await failure(publish())).toMatchObject({ code: "EVENT_NOT_READY" });

    const clubTx = mockPrisma(row({ audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" }), { types: [] });
    await expect(publish()).resolves.toMatchObject({ changed: true, toState: "PUBLISHED" });
    expect(clubTx.event.updateMany).toHaveBeenCalled();
  });

  it("a club event still needs church billing", async () => {
    mockPrisma(row({ audience: "CLUB", billingMode: "ATTENDEE_PAY" }), { types: [] });
    expect(await failure(publish())).toMatchObject({ code: "EVENT_NOT_READY", message: "Club registration uses church billing — choose it before publishing." });
  });

  it("always loads the sender and the types before deciding (never skips a required item)", async () => {
    const tx = mockPrisma(row());
    await publish();
    expect(tx.platformSettings.findUnique).toHaveBeenCalled();
    expect(tx.eventAttendeeType.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "event-1", isActive: true } }));
  });

  it("publishes once everything is set, from DRAFT or TEST, and records the new items as evidence", async () => {
    for (const from of ["DRAFT", "TEST"] as const) {
      const tx = mockPrisma(row({ lifecycleState: from === "TEST" ? "TEST" : null }));
      await expect(publish(from)).resolves.toMatchObject({ changed: true });
      const evidence = tx.eventLifecycleTransition.create.mock.calls[0]![0].data.evidence as { publishReadiness: Array<{ id: string }> };
      expect(evidence.publishReadiness.map((item) => item.id)).toEqual(expect.arrayContaining(["central-sender", "attendee-types"]));
    }
  });

  it("never touches an event that is already public: no re-check, and moves between public states are not gated", async () => {
    // Already published: the transition is a no-op that reads nothing of the required items.
    const noop = mockPrisma(row({ isPublished: true, lifecycleState: "PUBLISHED" }), { sender: null, types: [] });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", actor: configure, legacy: { alreadyDone: (state) => state === "PUBLISHED" } })).resolves.toMatchObject({ changed: false });
    expect(noop.platformSettings.findUnique).not.toHaveBeenCalled();
    expect(noop.event.updateMany).not.toHaveBeenCalled();

    // Closed registration back to published: not a readiness transition, so a cleared sender cannot hold it.
    const reopen = mockPrisma(row({ isPublished: true, lifecycleState: "REGISTRATION_CLOSED" }), { sender: null, types: [] });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "PUBLISHED", expectedFromState: "REGISTRATION_CLOSED", actor: configure, now: new Date("2027-07-01T12:00:00Z") })).resolves.toMatchObject({ changed: true });
    expect(reopen.platformSettings.findUnique).not.toHaveBeenCalled();

    // And unpublishing never needs them either.
    const down = mockPrisma(row({ isPublished: true, lifecycleState: "PUBLISHED" }), { sender: null, types: [] });
    await expect(transitionEventLifecycle({ eventId: "event-1", toState: "DRAFT", actor: configure, legacy: { alreadyDone: (state) => state === "DRAFT" } })).resolves.toMatchObject({ changed: true });
    expect(down.event.updateMany).toHaveBeenCalled();
  });
});

describe("the readiness panel (#1408)", () => {
  const fields = {
    ...complete, capacity: 350, publicInfoUrl: null, tagline: null, subtitle: null, helpEmail: null, hubTitle: null, hubIntro: null, refundPolicy: null,
    hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null, approvedPaymentInstructions: null,
    isPublished: false, archivedAt: null, showOnCalendar: true, registrationOpensOn: "2027-05-01", registrationClosesOn: "2027-10-01", paymentDueOn: null,
    waitlistEnabled: false, collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false, attendeeEditPolicy: "VERIFY_EVERY_EDIT" as const,
    seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false, autoPromoteWaitlist: false, featured: false, featuredOrder: null, featureUntil: null,
    publishedFormCount: 1, publishedForms: [], createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z",
  };
  const render = (overrides: Record<string, unknown> = {}) => {
    const event = { ...fields, ...overrides, warnings: [] } as unknown as EventSettingsRecord;
    return renderToStaticMarkup(createElement(EventSettingsWorkspace, { mode: "edit", initialEvent: event, canDeleteEvent: false }));
  };

  it("shows the two groups, sr-only status text, and 'Ready to publish' with the recommended count", () => {
    const markup = render({ hasCancellationPolicy: false });
    expect(markup).toContain("Ready to publish");
    expect(markup).toContain("Required before publishing");
    expect(markup).toContain("Recommended");
    expect(markup).toContain("doesn’t block publishing");
    expect(markup).toContain('<span class="sr-only">Done: </span>Central email sender saved');
    expect(markup).toContain('<span class="sr-only">Not done: </span>Cancellation policy set');
    expect(markup).toContain("Every required item is done.");
    expect(markup).toContain("1 recommended item is still open; you can publish without it.");
    expect(markup).toContain("Set a cancellation policy");
    expect(markup).toContain("Emails go out from events@example.test.");
    expect(markup).toContain("Adult, Youth, Child.");
  });

  it("counts required items and offers the next missing one with a link", () => {
    const markup = render({ centralSenderEmail: null, attendeeTypesWithAgeRangeCount: 0, attendeeTypeNames: [] });
    expect(markup).toContain("4 of 6 required ready");
    expect(markup).toContain("Publishing needs 2 required items first.");
    expect(markup).toContain("Ask a system administrator");
    expect(markup).toContain("Set attendee types");
    expect(markup).toContain("Confirmation and reminder emails wait until a system administrator saves the sender address.");
    expect(markup).toContain('aria-disabled="true"');
  });

  it("leads the publish box with the sender when it is the first thing missing", () => {
    const markup = render({ centralSenderEmail: null });
    expect(markup).toContain("Publishing needs 1 required item first.");
    expect(markup).toContain("ask a system administrator to set this up");
  });
});

describe("the attendee note when there is no cancellation policy (#1408)", () => {
  it("states the line and the support contact as plain text", () => {
    const markup = renderToStaticMarkup(createElement(CancellationUnavailableNote, { supportContact: "help@example.test" }));
    expect(markup).toContain("Cancellation isn");
    expect(markup).toContain("To cancel or change plans, contact the event team");
    expect(markup).toContain("help@example.test");
    expect(markup).not.toContain("<a ");
  });

  it("drops the contact when the event has none", () => {
    expect(renderToStaticMarkup(createElement(CancellationUnavailableNote, { supportContact: "  " }))).toContain("contact the event team.");
  });
});
