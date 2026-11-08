import { describe, expect, it } from "vitest";
import { buildCheckInBook, checkInBookCsv } from "@/modules/reporting/check-in-book";
import {
  attendeeRoleLabel,
  buildClubEventRecord,
  clubHeadcounts,
  YOUTH_GUEST_ROLE_LABEL,
  type BuildClubEventRecordInput,
} from "@/modules/reporting/club-event-reports";
import { buildClubPacket } from "@/modules/reporting/club-packet";
import {
  clubGuestSchema,
  GUEST_CHILD_AGE_MESSAGE,
  guestAgeRuleProblem,
  guestAttendeeType,
  guestIsChild,
  guestIsYouthNotPathfinder,
  guestOwnedRole,
  guestsFromJson,
} from "@/modules/club-registrations/domain";
import { pickingAttendees } from "@/modules/honors/registration-picks";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";

const base = { id: "abc123def", firstName: "Robin", lastName: "Visitor", email: null };

describe("event-only guests: Child under 10, optional Not a Pathfinder for 10 to 17 (#1728)", () => {
  it("allows Child only under 10 when a guest is added", () => {
    expect(guestAgeRuleProblem({ age: 9, guestType: "UNDERAGE" })).toBeNull();
    expect(guestAgeRuleProblem({ age: 10, guestType: "UNDERAGE" })).toBe(GUEST_CHILD_AGE_MESSAGE);
    expect(guestAgeRuleProblem({ age: 15, guestType: "UNDERAGE" })).toBe(GUEST_CHILD_AGE_MESSAGE);
  });

  it("keeps 10 to 17 a Pathfinder by default, and stores the mark only for 10 to 17", () => {
    expect(guestAttendeeType({ age: 12, guestType: "YOUTH" })).toBe("YOUTH");
    expect(guestAttendeeType({ age: 12, guestType: "YOUTH", notPathfinder: true })).toBe("UNDERAGE");
    expect(guestIsYouthNotPathfinder({ age: 12, guestType: "YOUTH", notPathfinder: true })).toBe(true);
    expect(guestIsYouthNotPathfinder({ age: 4, guestType: "UNDERAGE" })).toBe(false);
    expect(clubGuestSchema.safeParse({ ...base, age: 10, guestType: "YOUTH", notPathfinder: true }).success).toBe(true);
    expect(clubGuestSchema.safeParse({ ...base, age: 17, guestType: "YOUTH", notPathfinder: true }).success).toBe(true);
    expect(clubGuestSchema.safeParse({ ...base, age: 9, guestType: "YOUTH", notPathfinder: true }).success).toBe(false);
    expect(clubGuestSchema.safeParse({ ...base, age: 18, notPathfinder: true }).success).toBe(false);
    expect(clubGuestSchema.safeParse({ ...base, age: 30, guestType: "ADULT", notPathfinder: true }).success).toBe(false);
    expect(guestAgeRuleProblem({ age: 9, guestType: "YOUTH", notPathfinder: true })).not.toBeNull();
    // An adult is never turned into a youth guest.
    expect(guestAttendeeType({ age: 30, guestType: "ADULT", notPathfinder: true })).toBe("ADULT");
  });

  it("registers a marked guest with the Child role, so the totals do not count a Pathfinder", () => {
    const definition = {
      sections: [{ id: "s", title: "People", fields: [
        { id: "a", key: "attendee_type", label: "Roster role", helpText: "", type: "RADIO", scope: "ATTENDEE", required: true, options: ["Pathfinder", "TLT", "Staff", "Child"] },
      ] }],
    } as unknown as RegistrationFormDefinition;
    expect(guestIsChild({ age: 12, guestType: "YOUTH", notPathfinder: true })).toBe(true);
    expect(guestOwnedRole(definition, { age: 12, guestType: "YOUTH", notPathfinder: true })).toEqual({ attendee_type: "Child" });
    expect(guestOwnedRole(definition, { age: 12, guestType: "YOUTH" })).toEqual({});
  });

  it("loads a draft with the old Child choice at 10 or older, and with no choice at all, unchanged", () => {
    const loaded = guestsFromJson([
      { ...base, age: 12, guestType: "UNDERAGE" },
      { ...base, id: "def456abc", age: 12 },
      { ...base, id: "ghi789abc", age: 12, guestType: "YOUTH", notPathfinder: true },
    ]);
    expect(loaded).toHaveLength(3);
    expect(guestAttendeeType(loaded[0]!)).toBe("UNDERAGE");
    expect(guestAttendeeType(loaded[1]!)).toBe("YOUTH");
    expect(guestAttendeeType(loaded[2]!)).toBe("UNDERAGE");
  });

  it("gives a marked guest no class seat and a plain Pathfinder guest a seat", () => {
    const people = pickingAttendees({
      roster: [],
      selectedMemberIds: [],
      guests: [
        { id: "guest-1", firstName: "Robin", lastName: "Visitor", age: 12, guestType: "YOUTH", notPathfinder: true },
        { id: "guest-2", firstName: "Kit", lastName: "Visitor", age: 12, guestType: "YOUTH" },
      ],
    });
    expect(people.map((person) => [person.clientId, person.attendeeType, person.consumesSeat])).toEqual([
      ["guest:guest-1", "UNDERAGE", false], ["guest:guest-2", "YOUTH", true],
    ]);
  });
});

describe("a marked guest on the packet, the check-in book and the totals (#1728)", () => {
  const input = (): BuildClubEventRecordInput => ({
    organizationId: "org-1",
    organizationName: "Trailblazers",
    sponsoringChurch: "Synthetic SDA",
    registrationId: "reg-1",
    confirmationCode: "CAMP-001",
    status: "CONFIRMED",
    submittedAt: "2026-09-01T00:00:00.000Z",
    registrationResponses: { director_name: "Dana Director", email: "dana@example.test", phone: "(515) 555-0100" },
    attendees: [
      { id: "a1", firstName: "Jamie", lastName: "Lee", responses: { attendee_type: "Pathfinder", attendee_age: 12 } },
      { id: "a2", firstName: "Robin", lastName: "Visitor", responses: { attendee_type: "Child", attendee_age: 13 }, youthGuestNotPathfinder: true },
      { id: "a3", firstName: "Tiny", lastName: "Visitor", responses: { attendee_type: "Child", attendee_age: 4 } },
    ],
    amountOwedCents: 0,
    pricingSnapshot: {},
    lateRateLabel: null,
  });
  const record = buildClubEventRecord(input());

  it("counts them on the club page but not as a Pathfinder", () => {
    expect(clubHeadcounts(record.attendees)).toEqual({ pathfinder: 1, tlt: 0, staff: 0, child: 2, total: 3 });
  });

  it("labels only the marked guest as a youth guest", () => {
    expect(record.attendees.map((attendee) => attendeeRoleLabel(attendee))).toEqual(["Pathfinder", YOUTH_GUEST_ROLE_LABEL, "Child"]);
    expect(YOUTH_GUEST_ROLE_LABEL).toBe("Youth guest (not a Pathfinder)");
  });

  it("shows the label on the club packet", () => {
    const packet = buildClubPacket(record, {
      name: "Synthetic Camporee", conferenceName: "Synthetic Conference", startsOn: "2026-10-02T00:00:00.000Z", endsOn: "2026-10-04T00:00:00.000Z",
      timezone: "America/Chicago", earlyBirdDeadline: null, lateRateApplied: false,
    });
    expect(packet.attendees.find((attendee) => attendee.id === "a2")?.roleAbbreviation).toBe(YOUTH_GUEST_ROLE_LABEL);
    expect(packet.attendees.find((attendee) => attendee.id === "a3")?.roleAbbreviation).toBe("Ch");
    expect(packet.headcounts.pathfinder).toBe(1);
  });

  it("shows the label on the check-in book and its CSV", () => {
    const book = buildCheckInBook({
      event: { name: "Synthetic Camporee", startsOn: "2026-10-02T00:00:00.000Z", endsOn: "2026-10-04T00:00:00.000Z", timezone: "America/Chicago" },
      mode: "CLUB",
      clubs: [record],
      registrations: [],
    });
    expect(book.pages[0]!.attendees.map((attendee) => attendee.role).sort()).toEqual(["Child", "Pathfinder", YOUTH_GUEST_ROLE_LABEL].sort());
    expect(checkInBookCsv(book)).toContain(YOUTH_GUEST_ROLE_LABEL);
  });
});
