import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildCheckInBook, checkInBookCsv } from "@/modules/reporting/check-in-book";
import {
  attendeeRoleLabel,
  buildClubEventRecord,
  clubHeadcounts,
  YOUTH_GUEST_ROLE_CODE,
  YOUTH_GUEST_ROLE_LABEL,
  type BuildClubEventRecordInput,
} from "@/modules/reporting/club-event-reports";
import { buildClubPacket } from "@/modules/reporting/club-packet";
import {
  childRoleToPathfinder,
  clubGuestSchema,
  GUEST_CHILD_AGE_MESSAGE,
  guestAgeRuleProblem,
  guestAttendeeType,
  guestIsChild,
  guestIsYouthNotPathfinder,
  guestOwnedRole,
  guestsFromJson,
  normalizeLegacyChildGuest,
  snapshotIsYouthNotPathfinder,
} from "@/modules/club-registrations/domain";
import { calculateRosterLineItems, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { pickingAttendees } from "@/modules/honors/registration-picks";
import { isOfferedAsPathfinder } from "@/modules/event-scoring/service";
import { pointsRoleFor } from "@/modules/event-points/service";

const base = { id: "abc123def", firstName: "Robin", lastName: "Visitor", email: null };

const roleForm = {
  sections: [{ id: "s", title: "People", fields: [
    { id: "a", key: "attendee_type", label: "Roster role", helpText: "", type: "RADIO", scope: "ATTENDEE", required: true, options: ["Pathfinder", "TLT", "Staff", "Child"], choicePricesCents: { Pathfinder: 2500, TLT: 2500, Staff: 0, Child: 0 } },
  ] }],
} as unknown as RegistrationFormDefinition;

describe("event-only guests: Child under 10, optional Not a Pathfinder for 10 to 17 (#1728)", () => {
  it("allows Child only under 10 when a guest is added", () => {
    expect(guestAgeRuleProblem({ age: 9, guestType: "UNDERAGE" })).toBeNull();
    expect(guestAgeRuleProblem({ age: 10, guestType: "UNDERAGE" })).toBe(GUEST_CHILD_AGE_MESSAGE);
  });

  it("keeps a marked guest a youth, and allows the mark only for 10 to 17", () => {
    expect(guestAttendeeType({ age: 12, guestType: "YOUTH", notPathfinder: true })).toBe("YOUTH");
    expect(guestIsChild({ age: 12, guestType: "YOUTH", notPathfinder: true })).toBe(false);
    expect(guestIsYouthNotPathfinder({ age: 12, guestType: "YOUTH", notPathfinder: true })).toBe(true);
    expect(guestIsYouthNotPathfinder({ age: 12, guestType: "YOUTH" })).toBe(false);
    expect(guestIsYouthNotPathfinder({ age: 4, guestType: "UNDERAGE" })).toBe(false);
    for (const age of [10, 17]) expect(clubGuestSchema.safeParse({ ...base, age, guestType: "YOUTH", notPathfinder: true }).success).toBe(true);
    for (const age of [9, 18]) expect(clubGuestSchema.safeParse({ ...base, age, notPathfinder: true }).success).toBe(false);
    expect(clubGuestSchema.safeParse({ ...base, age: 30, guestType: "ADULT", notPathfinder: true }).success).toBe(false);
    expect(guestAgeRuleProblem({ age: 9, guestType: "YOUTH", notPathfinder: true })).not.toBeNull();
  });

  it("gives a marked guest no Child role, so the form's own role and price stand", () => {
    expect(guestOwnedRole(roleForm, { age: 12, guestType: "YOUTH", notPathfinder: true })).toEqual({});
    expect(guestOwnedRole(roleForm, { age: 4, guestType: "UNDERAGE" })).toEqual({ attendee_type: "Child" });
  });

  it("prices a marked 12-year-old as a Pathfinder ($25), a Child under 10 as a Child ($0)", () => {
    const total = (responses: Record<string, unknown>) => calculateRosterLineItems(roleForm, {}, [responses]).reduce((sum, item) => sum + item.amountCents, 0);
    expect(total({ attendee_type: "Pathfinder" })).toBe(2500);
    expect(total(guestOwnedRole(roleForm, { age: 4, guestType: "UNDERAGE" }))).toBe(0);
    // An old Child answer on a guest who is now a marked youth is turned into Pathfinder, so the price is a youth's.
    expect(total(childRoleToPathfinder(roleForm, { attendee_type: "Child" }))).toBe(2500);
    expect(childRoleToPathfinder(roleForm, { attendee_type: "Staff" })).toEqual({ attendee_type: "Staff" });
  });

  it("reads a draft guest saved as Child at 10 to 17 as a marked youth, and leaves younger ones alone", () => {
    const loaded = guestsFromJson([
      { ...base, age: 12, guestType: "UNDERAGE" },
      { ...base, id: "def456abc", age: 12 },
      { ...base, id: "ghi789abc", age: 4, guestType: "UNDERAGE" },
    ]);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]).toMatchObject({ guestType: "YOUTH", notPathfinder: true });
    expect(loaded[1]!.notPathfinder).toBeUndefined();
    expect(guestAttendeeType(loaded[1]!)).toBe("YOUTH");
    expect(loaded[2]).toMatchObject({ guestType: "UNDERAGE" });
    expect(normalizeLegacyChildGuest({ age: 18, guestType: "UNDERAGE" as const })).toMatchObject({ guestType: "UNDERAGE" });
  });

  it("reads a registered attendee as a marked youth by the mark, or by the old Child type from 10 to 17", () => {
    expect(snapshotIsYouthNotPathfinder({ temporary: true, temporaryAttendeeType: "YOUTH", ageOnEventDate: 12, notPathfinder: true })).toBe(true);
    expect(snapshotIsYouthNotPathfinder({ temporary: true, temporaryAttendeeType: "UNDERAGE", ageOnEventDate: 12 })).toBe(true);
    expect(snapshotIsYouthNotPathfinder({ temporary: true, temporaryAttendeeType: "UNDERAGE", ageOnEventDate: 5 })).toBe(false);
    expect(snapshotIsYouthNotPathfinder({ temporary: true, temporaryAttendeeType: "YOUTH", ageOnEventDate: 12, notPathfinder: false })).toBe(false);
    expect(snapshotIsYouthNotPathfinder({ temporaryAttendeeType: "UNDERAGE", ageOnEventDate: 12 })).toBe(false);
  });
});

describe("a marked guest takes no class seat, no score and no points (#1728)", () => {
  it("gives a marked guest, new or from an old draft, no class seat; an unmarked youth keeps one", () => {
    const people = pickingAttendees({
      roster: [],
      selectedMemberIds: [],
      guests: [
        { id: "guest-1", firstName: "Robin", lastName: "Visitor", age: 12, guestType: "YOUTH", notPathfinder: true },
        { id: "guest-2", firstName: "Kit", lastName: "Visitor", age: 12, guestType: "YOUTH" },
        { id: "guest-3", firstName: "Old", lastName: "Visitor", age: 12, guestType: "UNDERAGE" },
      ],
    });
    expect(people.map((person) => [person.clientId, person.consumesSeat])).toEqual([
      ["guest:guest-1", false], ["guest:guest-2", true], ["guest:guest-3", false],
    ]);
  });

  it("leaves a marked guest out of the Pathfinders offered for scoring, whatever their role", () => {
    const marked = { temporary: true, temporaryAttendeeType: "YOUTH", ageOnEventDate: 12, notPathfinder: true };
    const plain = { temporary: true, temporaryAttendeeType: "YOUTH", ageOnEventDate: 12 };
    expect(isOfferedAsPathfinder("Pathfinder", marked)).toBe(false);
    expect(isOfferedAsPathfinder("TLT", marked)).toBe(false);
    expect(isOfferedAsPathfinder("Pathfinder", plain)).toBe(true);
    expect(isOfferedAsPathfinder(undefined, plain)).toBe(true);
    expect(isOfferedAsPathfinder("Child", plain)).toBe(false);
  });

  it("never counts a marked guest as a Pathfinder or TLT present for attendance points", () => {
    const marked = { temporary: true, temporaryAttendeeType: "YOUTH", ageOnEventDate: 12, notPathfinder: true };
    const plain = { temporary: true, temporaryAttendeeType: "YOUTH", ageOnEventDate: 12 };
    expect(pointsRoleFor("Pathfinder", undefined, marked)).toBe("Child");
    expect(pointsRoleFor("TLT", undefined, marked)).toBe("Child");
    expect(pointsRoleFor("Pathfinder", undefined, plain)).toBe("Pathfinder");
    expect(pointsRoleFor("Staff", undefined, marked)).toBe("Staff");
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
      { id: "a2", firstName: "Robin", lastName: "Visitor", responses: { attendee_type: "Pathfinder", attendee_age: 13 }, youthGuestNotPathfinder: true },
      { id: "a3", firstName: "Tiny", lastName: "Visitor", responses: { attendee_type: "Child", attendee_age: 4 } },
      { id: "a4", firstName: "Old", lastName: "Visitor", responses: { attendee_type: "Child", attendee_age: 14 }, youthGuestNotPathfinder: true },
    ],
    amountOwedCents: 0,
    pricingSnapshot: {},
    lateRateLabel: null,
  });
  const record = buildClubEventRecord(input());

  it("counts them on the club page but not as a Pathfinder", () => {
    expect(clubHeadcounts(record.attendees)).toEqual({ pathfinder: 1, tlt: 0, staff: 0, child: 3, total: 4 });
  });

  it("labels only the marked guests as a youth guest", () => {
    expect(record.attendees.map((attendee) => attendeeRoleLabel(attendee))).toEqual(["Pathfinder", YOUTH_GUEST_ROLE_LABEL, "Child", YOUTH_GUEST_ROLE_LABEL]);
  });

  it("shows the short YG code on the club packet, not the full label", () => {
    const packet = buildClubPacket(record, {
      name: "Synthetic Camporee", conferenceName: "Synthetic Conference", startsOn: "2026-10-02T00:00:00.000Z", endsOn: "2026-10-04T00:00:00.000Z",
      timezone: "America/Chicago", earlyBirdDeadline: null, lateRateApplied: false,
    });
    expect(YOUTH_GUEST_ROLE_CODE).toBe("YG");
    expect(packet.attendees.find((attendee) => attendee.id === "a2")?.roleAbbreviation).toBe("YG");
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
    expect(book.pages[0]!.attendees.filter((attendee) => attendee.role === YOUTH_GUEST_ROLE_LABEL)).toHaveLength(2);
    expect(checkInBookCsv(book)).toContain(YOUTH_GUEST_ROLE_LABEL);
  });
});

describe("an old Child draft guest's answer is swapped after the server normalizes the draft (#1728)", () => {
  it("shows and prices the Pathfinder answer for a 10–17 guest saved as Child, and leaves a Child under 10 alone", async () => {
    const { legacyAdjustedAnswers } = await import("@/components/club-registration-workspace");
    const { guestsFromJson, clubGuestClientId } = await import("@/modules/club-registrations/domain");
    const guests = guestsFromJson([
      { id: "guestpat14", firstName: "Pat", lastName: "Sample", age: 14, email: null, guestType: "UNDERAGE" },
      { id: "guestkit06", firstName: "Kit", lastName: "Sample", age: 6, email: null, guestType: "UNDERAGE" },
    ]);
    expect(guests).toHaveLength(2);
    const answers = legacyAdjustedAnswers(
      { [clubGuestClientId("guestpat14")]: { attendee_type: "Child" }, [clubGuestClientId("guestkit06")]: { attendee_type: "Child" } },
      guests,
      roleForm,
    );
    expect(answers[clubGuestClientId("guestpat14")]).toEqual({ attendee_type: "Pathfinder" });
    expect(answers[clubGuestClientId("guestkit06")]).toEqual({ attendee_type: "Child" });
  });
});
