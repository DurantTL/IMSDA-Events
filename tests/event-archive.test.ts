import { describe, expect, it } from "vitest";
import {
  decideEventArchiveAccess,
  isEventArchived,
  withoutArchivedEvents,
} from "@/modules/events/archive";
import { selectEventContext, type EventSelectionCandidate } from "@/modules/events/context-selection";
import { evaluateEventRegistrationPhase } from "@/modules/events/lifecycle";

/** Archiving an event (#635): permissions, pickers, default selection, closed registration, unarchive. */

const NOW = new Date("2027-01-15T12:00:00.000Z");
const ARCHIVED_AT = new Date("2027-01-01T00:00:00.000Z");

function event(id: string, startsAt: string, overrides: Partial<EventSelectionCandidate> = {}): EventSelectionCandidate {
  return {
    id,
    startsAt: new Date(startsAt),
    isPublished: true,
    archivedAt: null,
    timezone: "America/Chicago",
    registrationOpensOn: null,
    registrationClosesOn: null,
    waitlistEnabled: false,
    ...overrides,
  };
}

describe("who may archive", () => {
  it("allows a system administrator and the event's own Event Admin", () => {
    expect(decideEventArchiveAccess({ globalRole: "SYSTEM_ADMIN", eventRole: null }).allowed).toBe(true);
    expect(decideEventArchiveAccess({ globalRole: null, eventRole: "EVENT_ADMIN" }).allowed).toBe(true);
  });

  it("refuses every other role and an account with no role on the event", () => {
    for (const eventRole of ["REGISTRATION_STAFF", "FINANCE_MANAGER", "CHECK_IN_STAFF", "COMMUNICATIONS", "VIEWER", null]) {
      const decision = decideEventArchiveAccess({ globalRole: null, eventRole });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toMatch(/system administrator or this event's Event Admin/);
    }
  });
});

describe("pickers and default selection", () => {
  const past = event("past", "2026-06-01T12:00:00.000Z", { archivedAt: ARCHIVED_AT });
  const current = event("current", "2027-02-01T12:00:00.000Z");
  const other = event("other", "2027-06-01T12:00:00.000Z");

  it("leaves archived events out of a picker list", () => {
    expect(withoutArchivedEvents([past, current, other]).map((e) => e.id)).toEqual(["current", "other"]);
    expect(isEventArchived(past)).toBe(true);
    expect(isEventArchived(current)).toBe(false);
  });

  it("never picks an archived event as the nearest, even when it is the closest", () => {
    const nearArchived = event("near", "2027-01-15T12:00:00.000Z", { archivedAt: ARCHIVED_AT });
    const selection = selectEventContext({ events: [nearArchived, current, other], now: NOW });
    expect(selection).toMatchObject({ kind: "nearest", event: { id: "current" } });
  });

  it("ignores a remembered archived event", () => {
    const selection = selectEventContext({ events: [past, current, other], lastUsedEventId: "past", now: NOW });
    expect(selection).toMatchObject({ kind: "nearest", event: { id: "current" } });
  });

  it("treats an account whose only live event is one of several as having a single event", () => {
    expect(selectEventContext({ events: [past, current], now: NOW })).toMatchObject({ kind: "only", event: { id: "current" } });
  });

  it("shows the picker when every event is archived", () => {
    expect(selectEventContext({ events: [past], now: NOW })).toEqual({ kind: "picker" });
  });

  it("still opens an archived event that is requested by id, so reports and exports stay readable", () => {
    expect(selectEventContext({ events: [past, current], requestedEventId: "past", now: NOW }))
      .toMatchObject({ kind: "requested", event: { id: "past" } });
  });

  it("restores an event to selection when it is unarchived", () => {
    const restored = { ...past, archivedAt: null };
    expect(withoutArchivedEvents([restored, current]).map((e) => e.id)).toEqual(["past", "current"]);
    expect(selectEventContext({ events: [restored], lastUsedEventId: "past", now: NOW }))
      .toMatchObject({ kind: "only", event: { id: "past" } });
    expect(selectEventContext({ events: [restored, current], lastUsedEventId: "past", now: NOW }))
      .toMatchObject({ kind: "cookie", event: { id: "past" } });
  });
});

describe("registration for an archived event", () => {
  const open = event("open", "2027-02-01T12:00:00.000Z", { endsAt: new Date("2027-02-03T12:00:00.000Z") });

  it("is closed whatever the dates say, and never open when unpublished", () => {
    expect(evaluateEventRegistrationPhase(open, NOW)).toBe("OPEN");
    expect(evaluateEventRegistrationPhase({ ...open, archivedAt: ARCHIVED_AT }, NOW)).toBe("CLOSED");
    expect(evaluateEventRegistrationPhase({ ...open, isPublished: false, archivedAt: ARCHIVED_AT }, NOW)).toBe("DRAFT");
  });

  it("reopens exactly as before once unarchived", () => {
    const archived = { ...open, archivedAt: ARCHIVED_AT };
    expect(evaluateEventRegistrationPhase({ ...archived, archivedAt: null }, NOW)).toBe(evaluateEventRegistrationPhase(open, NOW));
  });
});
