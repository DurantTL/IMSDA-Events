import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calendarDateInEventTimeZone,
  evaluateEventRegistrationPhase,
  hasEventEnded,
  type EventLifecycleSource,
  type EventRegistrationPhase,
} from "@/modules/events/lifecycle";
import { evaluateLocationPhase } from "@/modules/event-locations/domain";
import { describePublicEventLifecycle } from "@/modules/events/public-domain";
import { closesRegistration, effectiveLifecycleState, eventLifecycleStates, isPublicState } from "@/modules/events/lifecycle-state";
import { eventAcceptsInvitationRegistration } from "@/modules/staff-invitations/repository";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));

/** The function exactly as it was before lifecycle states (#156), kept as the reference for legacy events. */
function previousPhase(event: Omit<EventLifecycleSource, "lifecycleState">, now: Date): EventRegistrationPhase {
  if (!event.isPublished) return "DRAFT";
  if (event.archivedAt) return "CLOSED";
  if (hasEventEnded(event, now)) return "CLOSED";
  const today = calendarDateInEventTimeZone(now, event.timezone);
  if (event.registrationOpensOn && today < event.registrationOpensOn) return "UPCOMING";
  if (event.registrationClosesOn && today > event.registrationClosesOn) return "CLOSED";
  return "OPEN";
}

const base: EventLifecycleSource = {
  isPublished: true,
  archivedAt: null,
  lifecycleState: null,
  timezone: "America/Chicago",
  registrationOpensOn: "2027-05-01",
  registrationClosesOn: "2027-10-01",
  waitlistEnabled: false,
  endsAt: new Date("2027-10-10T22:00:00.000Z"),
};

const nows = [
  "2027-04-30T12:00:00.000Z", "2027-05-01T05:00:00.000Z", "2027-05-01T06:30:00.000Z", "2027-07-15T12:00:00.000Z",
  "2027-10-01T12:00:00.000Z", "2027-10-02T04:00:00.000Z", "2027-10-02T06:00:00.000Z", "2027-10-10T12:00:00.000Z", "2027-10-11T06:00:00.000Z", "2028-01-01T00:00:00.000Z",
].map((value) => new Date(value));

describe("registration phase from the lifecycle state (#156)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-07-15T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("gives a legacy event (null state) exactly the phase it had before, across a matrix of dates", () => {
    const variants: Array<Partial<EventLifecycleSource>> = [
      {}, { isPublished: false }, { archivedAt: new Date("2027-06-01T00:00:00.000Z") }, { isPublished: false, archivedAt: new Date("2027-06-01T00:00:00.000Z") },
      { registrationOpensOn: null }, { registrationClosesOn: null }, { registrationOpensOn: null, registrationClosesOn: null, endsAt: null },
      { endsAt: undefined }, { lastDay: "2027-07-14" }, { timezone: "Pacific/Honolulu" },
    ];
    for (const variant of variants) {
      for (const now of nows) {
        const event = { ...base, ...variant };
        const { lifecycleState: _ignored, ...legacy } = event;
        void _ignored;
        expect(evaluateEventRegistrationPhase(event, now), JSON.stringify({ variant, now })).toBe(previousPhase(legacy, now));
      }
    }
  });

  it("closes registration for each closing state even with the dates wide open", () => {
    for (const state of eventLifecycleStates.filter(closesRegistration)) {
      expect(evaluateEventRegistrationPhase({ ...base, lifecycleState: state }, new Date("2027-07-15T12:00:00.000Z"))).toBe("CLOSED");
    }
  });

  it("leaves PUBLISHED and IN_PROGRESS to the dates, as before", () => {
    for (const state of ["PUBLISHED", "IN_PROGRESS"] as const) {
      expect(evaluateEventRegistrationPhase({ ...base, lifecycleState: state }, new Date("2027-07-15T12:00:00.000Z"))).toBe("OPEN");
      expect(evaluateEventRegistrationPhase({ ...base, lifecycleState: state }, new Date("2027-04-30T12:00:00.000Z"))).toBe("UPCOMING");
      expect(evaluateEventRegistrationPhase({ ...base, lifecycleState: state }, new Date("2027-10-02T12:00:00.000Z"))).toBe("CLOSED");
    }
  });

  it("reads DRAFT and TEST as not open, whether or not old code left isPublished true", () => {
    for (const state of ["DRAFT", "TEST"] as const) {
      expect(evaluateEventRegistrationPhase({ ...base, isPublished: false, lifecycleState: state })).toBe("DRAFT");
      // Old code published it (isPublished true) without touching the state: it is published, as that code meant.
      expect(evaluateEventRegistrationPhase({ ...base, isPublished: true, lifecycleState: state })).toBe("OPEN");
    }
  });

  it("reads a public state that old code unpublished as a draft", () => {
    for (const state of eventLifecycleStates.filter(isPublicState)) {
      expect(evaluateEventRegistrationPhase({ ...base, isPublished: false, lifecycleState: state })).toBe("DRAFT");
    }
  });

  it("keeps an archived event closed whatever its stored state", () => {
    for (const state of [null, "PUBLISHED", "REGISTRATION_CLOSED", "IN_PROGRESS"] as const) {
      expect(evaluateEventRegistrationPhase({ ...base, lifecycleState: state, archivedAt: new Date("2027-06-01T00:00:00.000Z") })).toBe("CLOSED");
    }
  });

  it("closes a location's registration when the event's state closes it", () => {
    const location = { firstDay: null, lastDay: null, registrationClosesOn: null };
    expect(evaluateLocationPhase({ ...base, lifecycleState: "PUBLISHED" }, location)).toBe("OPEN");
    expect(evaluateLocationPhase({ ...base, lifecycleState: "REGISTRATION_CLOSED" }, location)).toBe("CLOSED");
    expect(evaluateLocationPhase({ ...base, lifecycleState: "REGISTRATION_CLOSED" }, null)).toBe("CLOSED");
  });
});

describe("public pages and personal links by state (#156)", () => {
  const publicInput = { ...base, capacity: null as number | null };
  const now = new Date("2027-07-15T12:00:00.000Z");

  it("is visible exactly for the public states, and a draft or test event reads as closed to the public", () => {
    for (const state of eventLifecycleStates.filter((candidate) => candidate !== "ARCHIVED")) {
      const effective = effectiveLifecycleState({ lifecycleState: state, isPublished: isPublicState(state), archivedAt: null });
      expect(effective).toBe(state);
      const summary = describePublicEventLifecycle({ ...publicInput, isPublished: isPublicState(state), lifecycleState: state }, 0, now);
      if (state === "PUBLISHED" || state === "IN_PROGRESS") expect(summary.phase).toBe("OPEN");
      else expect(summary.phase).toBe(isPublicState(state) ? "CLOSED" : "DRAFT");
    }
  });

  it("says registration closed, without a possibly-future closing date, when the state closes it", () => {
    const summary = describePublicEventLifecycle({ ...publicInput, lifecycleState: "REGISTRATION_CLOSED" }, 0, now);
    expect(summary.phase).toBe("CLOSED");
    expect(summary.detail).toBe("Online registration is no longer available. Contact the event team if you need help.");
    expect(summary.action).toBe("NONE");
  });

  it("keeps the dated wording for an event closed by its dates", () => {
    const summary = describePublicEventLifecycle({ ...publicInput, registrationClosesOn: "2027-07-01" }, 0, now);
    expect(summary.detail).toContain("July 1, 2027");
  });

  it("takes no personal-link registrations once the state closes registration", () => {
    const event = { isPublished: true, archivedAt: null, audience: "GENERAL" as const, timezone: "America/Chicago", endsAt: base.endsAt!, lifecycleState: null as null | "REGISTRATION_CLOSED" | "PUBLISHED" };
    expect(eventAcceptsInvitationRegistration(event, now)).toBe(true);
    expect(eventAcceptsInvitationRegistration({ ...event, lifecycleState: "PUBLISHED" }, now)).toBe(true);
    expect(eventAcceptsInvitationRegistration({ ...event, lifecycleState: "REGISTRATION_CLOSED" }, now)).toBe(false);
  });
});
