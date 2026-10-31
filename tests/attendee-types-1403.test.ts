import { describe, expect, it } from "vitest";
import { matchLegacyAttendeeTypeAnswer } from "@/modules/attendee-types/legacy-answer";
import { starterEventTemplates, starterPayload } from "@/modules/event-templates/starters";
import { getFormTemplate } from "@/modules/forms/definition";
import { getEventPublishReadiness } from "@/modules/events/readiness";
import {
  AudienceAccumulator,
  classifyAttendeeType,
  type AttendeeAgeClass,
  type AudienceEvaluationContext,
  type AudienceRegistrationRow,
} from "@/modules/communications/audience-resolve";
import {
  SCHEDULE_EXCLUSION_LABELS,
  decideRecipientEligibility,
  refusedYouthTargetReasons,
  refusedYouthTargets,
  targetKey,
  type CurrentAudienceView,
  type YouthCheckRegistration,
} from "@/modules/communications/scheduled-email-domain";
import { normalizeAudienceQuery } from "@/modules/communications/audience-query";

const starter = (key: string) => starterEventTemplates.find((entry) => entry.starterKey === key)!;

describe("matching the legacy attendee_type answer to an event's types (#1403)", () => {
  const types = [
    { id: "t1", code: "ADULT", label: "Adult" },
    { id: "t2", code: "TEEN", label: "Teen" },
    { id: "t3", code: "CHILD", label: "Child" },
  ];

  it("matches the label or the code, trimmed and ignoring case", () => {
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "Adult" }, types)?.id).toBe("t1");
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "  teen " }, types)?.id).toBe("t2");
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "CHILD" }, types)?.id).toBe("t3");
  });

  it("never guesses: no match, a blank, a non-string or a partial match stays untyped", () => {
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "Worker" }, types)).toBeNull();
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "Adults" }, types)).toBeNull();
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "" }, types)).toBeNull();
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: 3 }, types)).toBeNull();
    expect(matchLegacyAttendeeTypeAnswer({}, types)).toBeNull();
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "Adult" }, [])).toBeNull();
  });

  it("an answer that matches two types is not guessed", () => {
    expect(matchLegacyAttendeeTypeAnswer({ attendee_type: "Adult" }, [...types, { id: "t4", code: "OTHER", label: "adult" }])).toBeNull();
  });
});

describe("starter attendee types (#1403)", () => {
  it("Women's Retreat carries Adult, Teen and Child with the form's own answer labels", () => {
    const payload = starterPayload(starter("womens_retreat"));
    expect(payload.attendeeTypes.map((type) => [type.code, type.label, type.minimumAge, type.maximumAge])).toEqual([
      ["ADULT", "Adult", 18, null], ["TEEN", "Teen", 13, 17], ["CHILD", "Child", null, 12],
    ]);
    const form = getFormTemplate("womens_retreat_export")!.definition;
    const answerField = form.sections.flatMap((section) => section.fields).find((field) => field.key === "attendee_type")!;
    expect([...answerField.options].sort()).toEqual(payload.attendeeTypes.map((type) => type.label).sort());
    expect(payload.attendeeTypes.map((type) => classifyAttendeeType(type))).toEqual(["ADULT", "MINOR", "MINOR"]);
  });

  it("Camp Meeting and Man Camp carry Adult, Youth and Child, and ask a required Age group question", () => {
    for (const [key, formKey] of [["camp_meeting", "camp_meeting_export"], ["man_camp", "man_camp_export"]] as const) {
      const payload = starterPayload(starter(key));
      expect(payload.attendeeTypes.map((type) => [type.code, type.label, type.minimumAge, type.maximumAge])).toEqual([
        ["ADULT", "Adult", 18, null], ["YOUTH", "Youth", 13, 17], ["CHILD", "Child", null, 12],
      ]);
      const field = getFormTemplate(formKey)!.definition.sections.flatMap((section) => section.fields).find((entry) => entry.key === "age_group")!;
      expect(field).toMatchObject({ type: "RADIO", scope: "ATTENDEE", required: true, optionSource: "ATTENDEE_TYPES", options: [] });
    }
  });

  it("only the four general starters have types; no club starter and no other starter does", () => {
    const typed = starterEventTemplates.filter((entry) => starterPayload(entry).attendeeTypes.length > 0).map((entry) => entry.starterKey).sort();
    expect(typed).toEqual(["camp_meeting", "man_camp", "womens_retreat"]);
    for (const entry of starterEventTemplates.filter((item) => item.audience === "CLUB")) {
      expect(starterPayload(entry).attendeeTypes).toEqual([]);
    }
  });
});

describe("an adult registered on a Women's Retreat starter event is reachable (#1403)", () => {
  const payload = starterPayload(starter("womens_retreat"));
  const context: AudienceEvaluationContext = {
    isOrganizationBilled: false,
    tagNames: new Map(),
    attendeeTypeLabels: new Map(payload.attendeeTypes.map((type) => [type.code, type.label])),
    attendeeAge: new Map<string, AttendeeAgeClass>(payload.attendeeTypes.map((type) => [type.code, classifyAttendeeType(type)])),
    selection: { attendeeTypes: [], tagIds: [] },
    searchReasons: [],
  };
  const row = (attendeeType: string): AudienceRegistrationRow => ({
    registrationId: "r1", confirmationCode: "R1", status: "CONFIRMED", totalCents: 0, netPaidCents: 0,
    contact: { name: "Pat Example", email: "pat@example.test" }, hasPublicSubmission: false, tagIds: [],
    attendees: [{ attendeeId: "a1", attendeeType, name: "Pat Example", email: "pat@example.test", hasResponses: true, tagIds: [] }],
    groupLeader: null, organizationContact: null,
  });
  const run = (attendeeType: string) => {
    const accumulator = new AudienceAccumulator(normalizeAudienceQuery({ roles: ["ATTENDEE"] }), context, "evt");
    accumulator.consider(row(attendeeType));
    return accumulator.finalize(new Map());
  };

  it("the answer 'Adult' maps to the ADULT type, which is counted as a recipient", () => {
    const type = matchLegacyAttendeeTypeAnswer({ attendee_type: "Adult" }, payload.attendeeTypes)!;
    expect(type.code).toBe("ADULT");
    const result = run(type.code);
    expect(result.recipients.map((recipient) => recipient.email)).toEqual(["pat@example.test"]);
    expect(result.exclusions).toEqual([]);
  });

  it("a Teen is still excluded as a minor, and an untyped attendee as an unknown age with its cause", () => {
    const teen = run("TEEN");
    expect(teen.recipients).toEqual([]);
    expect(teen.exclusions[0]).toMatchObject({ code: "MINOR_ATTENDEE", blockedAge: "MINOR" });
    const untyped = run("");
    expect(untyped.recipients).toEqual([]);
    expect(untyped.exclusions[0]).toMatchObject({ code: "MINOR_ATTENDEE", blockedAge: "UNKNOWN", unknownCauses: { noType: 1, noRange: 0 } });
  });

  it("an attendee with a type that has no age range is an unknown age for that reason", () => {
    const accumulator = new AudienceAccumulator(normalizeAudienceQuery({ roles: ["ATTENDEE"] }), {
      ...context, attendeeAge: new Map<string, AttendeeAgeClass>([["GUEST", "UNKNOWN"]]),
    }, "evt");
    accumulator.consider(row("GUEST"));
    expect(accumulator.finalize(new Map()).exclusions[0]).toMatchObject({ blockedAge: "UNKNOWN", unknownCauses: { noType: 0, noRange: 1 } });
  });
});

describe("why a youth target is refused (#1403)", () => {
  const registration = (age: "MINOR" | "UNKNOWN"): YouthCheckRegistration => ({
    registrationId: "reg-1", accountHolderPersonId: "parent", holderEmail: "parent@example.test", snapshotEmail: "",
    attendees: [{ personId: "p1", email: "p1@example.test", age }],
  });
  const target = { email: "p1@example.test", registrationId: "reg-1", roles: ["ATTENDEE"] };
  const nobody = { personIds: new Set(["p1"]), emails: new Set(["p1@example.test"]) };

  it("an untyped attendee is refused as an unknown age, not as youth", () => {
    const reasons = refusedYouthTargetReasons([target], new Map([["reg-1", registration("UNKNOWN")]]), nobody);
    expect([...reasons]).toEqual([[targetKey("p1@example.test", "reg-1"), "UNKNOWN"]]);
  });

  it("a known minor is still refused as youth", () => {
    const reasons = refusedYouthTargetReasons([target], new Map([["reg-1", registration("MINOR")]]), {
      ...nobody, knownMinorPersonIds: new Set(["p1"]), knownMinorEmails: new Set(["p1@example.test"]),
    });
    expect([...reasons.values()]).toEqual(["MINOR"]);
  });

  it("a known minor elsewhere in the event is youth even when this row alone reads unknown", () => {
    const reasons = refusedYouthTargetReasons([target], new Map([["reg-1", registration("UNKNOWN")]]), {
      ...nobody, knownMinorEmails: new Set(["p1@example.test"]),
    });
    expect([...reasons.values()]).toEqual(["MINOR"]);
  });

  it("an attendee whose type has no adult range is named for that, and an untyped one is not", () => {
    const typed: YouthCheckRegistration = { ...registration("UNKNOWN"), attendees: [{ personId: "p1", email: "p1@example.test", age: "UNKNOWN", typed: true }] };
    const evidence = { personIds: new Set(["p1"]), emails: new Set(["p1@example.test"]), untypedPersonIds: new Set<string>(), untypedEmails: new Set<string>() };
    expect([...refusedYouthTargetReasons([target], new Map([["reg-1", typed]]), evidence).values()]).toEqual(["UNKNOWN_NO_RANGE"]);
    const untyped = { ...evidence, untypedPersonIds: new Set(["p1"]), untypedEmails: new Set(["p1@example.test"]) };
    expect([...refusedYouthTargetReasons([target], new Map([["reg-1", { ...typed, attendees: [{ ...typed.attendees[0]!, typed: false }] }]]), untyped).values()]).toEqual(["UNKNOWN"]);
  });

  it("refuses exactly the same targets as before", () => {
    for (const age of ["MINOR", "UNKNOWN"] as const) {
      const registrations = new Map([["reg-1", registration(age)]]);
      expect([...refusedYouthTargets([target], registrations, nobody)]).toEqual([...refusedYouthTargetReasons([target], registrations, nobody).keys()]);
    }
  });

  it("at send time the unknown-age subset is named as such, and everything else stays youth", () => {
    const key = targetKey("p1@example.test", "reg-1");
    const view = (unknownAgeTargets?: Set<string>): CurrentAudienceView => ({
      targets: new Map(), registrations: new Map([["reg-1", { active: true }]]), exclusionByEmail: new Map(),
      registrationsWithOtherTarget: new Set(), minorTargets: new Set([key]), unknownAgeTargets, isOrganizationBilled: false,
    });
    const reviewed = { registrationId: "reg-1", email: "p1@example.test", roles: ["ATTENDEE"] };
    const decide = (current: CurrentAudienceView) => decideRecipientEligibility(reviewed, "EVENT_ANNOUNCEMENT", current, "BEFORE_EVENT_START");
    expect(decide(view(new Set([key])))).toBe("AGE_UNKNOWN_RECIPIENT");
    expect(decide(view())).toBe("MINOR_RECIPIENT");
    expect(decide({ ...view(new Set([key])), unknownNoRangeTargets: new Set([key]) })).toBe("AGE_UNKNOWN_NO_RANGE");
    expect(SCHEDULE_EXCLUSION_LABELS.AGE_UNKNOWN_RECIPIENT).toBe("Age unknown (no attendee type)");
    expect(SCHEDULE_EXCLUSION_LABELS.MINOR_RECIPIENT).toMatch(/^Youth/);
  });
});

describe("publish readiness: attendee types (#1403)", () => {
  const base = {
    name: "Sample", slug: "sample", startsOn: "2027-06-01", endsOn: "2027-06-03", timezone: "America/Chicago",
    location: "Des Moines", supportContact: "help@example.test", id: "evt_1",
  };
  const find = (readiness: ReturnType<typeof getEventPublishReadiness>) => readiness.optionalItems.find((item) => item.id === "attendee-types");

  it("a general event lists 'Attendee types set', undone without a ranged type, with a link to attendee setup", () => {
    const readiness = getEventPublishReadiness({ ...base, audience: "GENERAL", billingMode: "ATTENDEE_PAY", attendeeTypesWithAgeRangeCount: 0 }, 1);
    expect(find(readiness)).toMatchObject({ label: "Attendee types set", complete: false, href: "/more/attendee-configuration?event=evt_1" });
    // Never blocks publishing.
    expect(readiness.ready).toBe(true);
    expect(readiness.items.map((item) => item.id)).not.toContain("attendee-types");
  });

  it("is done once an active type has an age range", () => {
    expect(find(getEventPublishReadiness({ ...base, audience: "GENERAL", attendeeTypesWithAgeRangeCount: 2 }, 1))?.complete).toBe(true);
  });

  it("a club event never lists it", () => {
    expect(find(getEventPublishReadiness({ ...base, audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE", attendeeTypesWithAgeRangeCount: 0 }, 1))).toBeUndefined();
  });

  it("a caller that has not loaded the count leaves it out", () => {
    expect(find(getEventPublishReadiness({ ...base, audience: "GENERAL" }, 1))).toBeUndefined();
  });
});
