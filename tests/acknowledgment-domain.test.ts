import { describe, expect, it } from "vitest";
import {
  APPROVED_REQUEST_METADATA_KEYS,
  acknowledgmentFields,
  approvedRequestMetadata,
  decideActing,
  evidenceRequestHash,
  hasLiveAcceptance,
  holdAcknowledgmentAnswers,
  latestLiveAction,
  normalizePaperLocation,
  planAcknowledgments,
  policyContent,
  resolveAcknowledgmentStatus,
  sha256,
  staffEvidenceKey,
  submissionEvidenceKey,
  statusLabels,
  textContent,
  withdrawalRequestHash,
  type HistoryRow,
} from "@/modules/acknowledgments/domain";
import { RECONSENT_RULE, type ReconsentRule } from "@/modules/acknowledgments/reconsent-rule";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

// Obviously synthetic wording; no legal text.
const WORDING = "Synthetic acknowledgment wording.\nSecond line.";

function definition(extra: Array<Record<string, unknown>> = []) {
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic acknowledgment form",
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5 },
    sections: [{
      id: "sec_one", title: "Everything", description: "", fields: [
        { id: "f_first", key: "first_name", label: "First name", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: "f_program", key: "wants_program", label: "Program?", type: "RADIO", scope: "REGISTRATION", required: false, options: ["Yes", "No"] },
        { id: "f_activity", key: "attending_activity", label: "Activity?", type: "RADIO", scope: "ATTENDEE", required: false, options: ["Yes", "No"] },
        { id: "f_reg", key: "reg_ack", label: "Registration acknowledgment", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], acknowledgment: { source: "TEXT", text: WORDING } },
        { id: "f_program_ack", key: "program_ack", label: "Program acknowledgment", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" }, acknowledgment: { source: "TEXT", text: WORDING } },
        { id: "f_att", key: "att_ack", label: "Attendee acknowledgment", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], acknowledgment: { source: "POLICY_VERSION", policyVersionId: "version-1" } },
        { id: "f_att_cond", key: "att_cond_ack", label: "Conditional attendee acknowledgment", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], conditional: { fieldKey: "attending_activity", operator: "EQUALS", value: "Yes" }, acknowledgment: { source: "TEXT", text: WORDING } },
        ...extra,
      ],
    }],
  });
}

describe("what was shown (#150)", () => {
  it("records the exact wording and a hash of exactly those characters", () => {
    const content = textContent(WORDING);
    expect(content).toMatchObject({ source: "TEXT", shownText: WORDING, policyVersionId: null });
    expect(content.contentHash).toBe(sha256(WORDING));
    expect(content.contentRef).toBe(`text:${sha256(WORDING)}`);
    // One changed character is different content.
    expect(textContent(`${WORDING}.`).contentRef).not.toBe(content.contentRef);
  });

  it("references a policy version by id and carries no text", () => {
    const content = policyContent({ id: "version-7", contentHash: "a".repeat(64) });
    expect(content).toEqual({ source: "POLICY_VERSION", shownText: null, policyVersionId: "version-7", contentHash: "a".repeat(64), contentRef: "policy:version-7" });
  });
});

describe("approved request metadata", () => {
  it("keeps only the approved keys, as short strings", () => {
    const kept = approvedRequestMetadata({
      userAgentHash: "abc", formVersionId: "v1", submissionKey: "k1",
      ipAddress: "203.0.113.9", userAgent: "Synthetic/1.0", headers: { cookie: "secret" }, referrer: "https://example.test",
    });
    expect(Object.keys(kept).sort()).toEqual([...APPROVED_REQUEST_METADATA_KEYS].sort());
    expect(JSON.stringify(kept)).not.toMatch(/203\.0\.113\.9|Synthetic\/1\.0|secret|example\.test/);
  });

  it("drops non-strings and empty values, and caps length", () => {
    expect(approvedRequestMetadata({ userAgentHash: 12, formVersionId: "", submissionKey: "x".repeat(500) })).toEqual({ submissionKey: "x".repeat(200) });
    expect(approvedRequestMetadata(null)).toEqual({});
    expect(approvedRequestMetadata(undefined)).toEqual({});
  });
});

describe("acting for another person (#131 authority only)", () => {
  const authority = { id: "auth-1", adultPersonId: "dad" };

  it("lets a registration-level acknowledgment through: it is the registrant's own", () => {
    expect(decideActing({ subject: { personId: null, status: "ADULT" }, actedByPersonId: "dad", authority: null })).toEqual({ allowed: true, actingForAnother: false, guardianAuthorityId: null });
  });

  it("lets an adult acknowledge for themselves, and a person of unknown age too", () => {
    expect(decideActing({ subject: { personId: "dad", status: "ADULT" }, actedByPersonId: "dad", authority: null })).toMatchObject({ allowed: true, actingForAnother: false });
    expect(decideActing({ subject: { personId: "una", status: "UNKNOWN" }, actedByPersonId: "una", authority: null })).toMatchObject({ allowed: true });
  });

  it("lets the declared responsible adult acknowledge for a minor, and names the authority", () => {
    expect(decideActing({ subject: { personId: "kid", status: "MINOR" }, actedByPersonId: "dad", authority })).toEqual({ allowed: true, actingForAnother: true, guardianAuthorityId: "auth-1" });
  });

  it.each([
    ["the account holder, who was not declared", { personId: "kid", status: "MINOR" as const }, "mum", authority],
    ["the minor's own tick", { personId: "kid", status: "MINOR" as const }, "kid", authority],
    ["a minor with nobody declared", { personId: "kid", status: "MINOR" as const }, "dad", null],
    ["a minor whose declared adult is the minor", { personId: "kid", status: "MINOR" as const }, "kid", { id: "auth-2", adultPersonId: "kid" }],
  ])("refuses %s", (_label, subject, actor, found) => {
    expect(decideActing({ subject, actedByPersonId: actor, authority: found })).toMatchObject({ allowed: false, code: "ACTING_FOR_MINOR_NOT_AUTHORIZED" });
  });

  it("refuses acknowledging for another adult: nothing records that authority", () => {
    expect(decideActing({ subject: { personId: "uncle", status: "ADULT" }, actedByPersonId: "dad", authority: null })).toMatchObject({ allowed: false, code: "ACTING_FOR_ANOTHER_NOT_AUTHORIZED" });
    expect(decideActing({ subject: { personId: "una", status: "UNKNOWN" }, actedByPersonId: "dad", authority: null })).toMatchObject({ allowed: false, code: "ACTING_FOR_ANOTHER_NOT_AUTHORIZED" });
  });

  it("an actor who is merely the account holder and a household member is refused the same as a stranger", () => {
    // The function's whole input is the subject, the actor and the declared authority: household membership and
    // account-holder status have nowhere to enter, so the same inputs always give the same answer.
    const stranger = decideActing({ subject: { personId: "kid", status: "MINOR" }, actedByPersonId: "stranger", authority });
    const accountHolder = decideActing({ subject: { personId: "kid", status: "MINOR" }, actedByPersonId: "account-holder", authority });
    expect(accountHolder).toEqual(stranger);
    expect(accountHolder).toMatchObject({ allowed: false });
  });
});

describe("which acknowledgments a submission gives (conditions and repeating sections)", () => {
  const attendees = [
    { clientId: "a1", responses: { first_name: "Ann", attending_activity: "Yes", att_ack: true, att_cond_ack: true } },
    { clientId: "a2", responses: { first_name: "Bob", attending_activity: "No", att_ack: true, att_cond_ack: true } },
    { clientId: "a3", responses: { first_name: "Cy", att_ack: false } },
  ];

  it("finds every acknowledgment field, in order", () => {
    expect(acknowledgmentFields(definition()).map((field) => field.key)).toEqual(["reg_ack", "program_ack", "att_ack", "att_cond_ack"]);
  });

  it("gives one per ticked, visible field: registration once, attendee fields once per attendee", () => {
    const planned = planAcknowledgments(definition(), { registrationResponses: { wants_program: "Yes", reg_ack: true, program_ack: true }, attendees });
    expect(planned.map((item) => `${item.field.key}:${item.attendeeClientId ?? "registration"}`)).toEqual([
      "reg_ack:registration",
      "program_ack:registration",
      "att_ack:a1",
      "att_ack:a2",
      "att_cond_ack:a1",
    ]);
  });

  it("records nothing for a conditional field its condition hides, even if it was ticked", () => {
    const planned = planAcknowledgments(definition(), { registrationResponses: { wants_program: "No", reg_ack: true, program_ack: true }, attendees });
    expect(planned.some((item) => item.field.key === "program_ack")).toBe(false);
    // Bob's activity is "No": his conditional acknowledgment is hidden, Ann's is not.
    expect(planned.filter((item) => item.field.key === "att_cond_ack").map((item) => item.attendeeClientId)).toEqual(["a1"]);
  });

  it("records nothing for an unticked box or a value that is not exactly true", () => {
    const planned = planAcknowledgments(definition(), {
      registrationResponses: { reg_ack: "true" },
      attendees: [{ clientId: "a1", responses: { att_ack: "yes" } }, { clientId: "a2", responses: { att_ack: false } }],
    });
    expect(planned).toEqual([]);
  });
});

describe("retries", () => {
  const identity = { eventId: "e1", registrationId: "r1", registrationAttendeeId: "a1", fieldKey: "att_ack", actedByPersonId: "p1", channel: "ONLINE" as const, contentRef: "policy:v1" };

  it("hashes what a request means, not when it arrived", () => {
    expect(evidenceRequestHash(identity)).toBe(evidenceRequestHash({ ...identity }));
    expect(evidenceRequestHash(identity)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["the channel", { channel: "PAPER" as const }],
    ["the person who acknowledged", { actedByPersonId: "p2" }],
    ["the content", { contentRef: "policy:v2" }],
    ["the attendee", { registrationAttendeeId: "a2" }],
    ["the field", { fieldKey: "other" }],
    ["the registration", { registrationId: "r2" }],
  ])("tells a different request apart by %s", (_label, change) => {
    expect(evidenceRequestHash({ ...identity, ...change })).not.toBe(evidenceRequestHash(identity));
  });

  it("derives the same keys on a retried submission and different ones per field and attendee", () => {
    expect(submissionEvidenceKey("sub-1", "field-1", "a1")).toBe(submissionEvidenceKey("sub-1", "field-1", "a1"));
    expect(submissionEvidenceKey("sub-1", "field-1", "a1")).not.toBe(submissionEvidenceKey("sub-1", "field-1", "a2"));
    expect(submissionEvidenceKey("sub-1", "field-1", null)).not.toBe(submissionEvidenceKey("sub-1", "field-2", null));
    expect(staffEvidenceKey("req-1")).toBe("staff:req-1");
    expect(staffEvidenceKey("req-1")).not.toBe(submissionEvidenceKey("req-1", "f", null));
  });
});

describe("historical status resolution", () => {
  const policy = (evidenceVersionNumber: number, effectiveNumber: number | null, laterVersionIsMaterial: boolean) => ({
    evidence: { source: "POLICY_VERSION" as const },
    policy: { evidenceVersionNumber, effective: effectiveNumber === null ? null : { versionNumber: effectiveNumber }, laterVersionIsMaterial },
  });

  it("is not acknowledged without evidence", () => {
    expect(resolveAcknowledgmentStatus({ evidence: null })).toBe("NOT_ACKNOWLEDGED");
  });

  it("stands for text, for the version still in force, and when no version is in force", () => {
    expect(resolveAcknowledgmentStatus({ evidence: { source: "TEXT" } })).toBe("ACKNOWLEDGED");
    expect(resolveAcknowledgmentStatus(policy(1, 1, false))).toBe("ACKNOWLEDGED");
    expect(resolveAcknowledgmentStatus(policy(1, null, true))).toBe("ACKNOWLEDGED");
    // A version that has not taken effect yet (the in-force one is older than what they saw) changes nothing.
    expect(resolveAcknowledgmentStatus(policy(2, 1, true))).toBe("ACKNOWLEDGED");
  });

  it("keeps an earlier acknowledgment standing after a non-material later version", () => {
    expect(resolveAcknowledgmentStatus(policy(1, 2, false))).toBe("ACKNOWLEDGED_EARLIER_VERSION");
  });

  it("asks for a new acknowledgment after a material later version", () => {
    expect(resolveAcknowledgmentStatus(policy(1, 2, true))).toBe("REACKNOWLEDGMENT_REQUIRED");
    expect(resolveAcknowledgmentStatus(policy(1, 3, true))).toBe("REACKNOWLEDGMENT_REQUIRED");
  });
});

describe("the declared re-consent rule (#130)", () => {
  const policy = (evidenceVersionNumber: number, effectiveNumber: number, laterVersionIsMaterial: boolean) => ({
    evidence: { source: "POLICY_VERSION" as const },
    policy: { evidenceVersionNumber, effective: { versionNumber: effectiveNumber }, laterVersionIsMaterial },
  });
  const requireAll: ReconsentRule = { materialChange: "REQUIRE_FRESH_AGREEMENT", nonMaterialChange: "REQUIRE_FRESH_AGREEMENT" };
  const carryAll: ReconsentRule = { materialChange: "CARRY_FORWARD", nonMaterialChange: "CARRY_FORWARD" };

  it("declares that a material change needs a fresh agreement and a non-material one carries forward", () => {
    expect(RECONSENT_RULE).toEqual({ materialChange: "REQUIRE_FRESH_AGREEMENT", nonMaterialChange: "CARRY_FORWARD" });
  });

  it("defaults to the declared rule", () => {
    expect(resolveAcknowledgmentStatus(policy(1, 2, true))).toBe("REACKNOWLEDGMENT_REQUIRED");
    expect(resolveAcknowledgmentStatus(policy(1, 2, true), RECONSENT_RULE)).toBe("REACKNOWLEDGMENT_REQUIRED");
  });

  it("follows the rule both ways for a material change", () => {
    expect(resolveAcknowledgmentStatus(policy(1, 2, true), requireAll)).toBe("REACKNOWLEDGMENT_REQUIRED");
    expect(resolveAcknowledgmentStatus(policy(1, 2, true), carryAll)).toBe("ACKNOWLEDGED_EARLIER_VERSION");
  });

  it("never requires a fresh agreement for a non-material change under the declared rule", () => {
    expect(resolveAcknowledgmentStatus(policy(1, 2, false), RECONSENT_RULE)).toBe("ACKNOWLEDGED_EARLIER_VERSION");
    expect(resolveAcknowledgmentStatus(policy(1, 5, false), carryAll)).toBe("ACKNOWLEDGED_EARLIER_VERSION");
  });

  it("changes nothing while the version they saw is still in force", () => {
    expect(resolveAcknowledgmentStatus(policy(2, 2, true), requireAll)).toBe("ACKNOWLEDGED");
  });
});

describe("status from the history: decline and withdrawal (#130)", () => {
  const day = (offset: number) => new Date(Date.UTC(2027, 0, 1 + offset)).toISOString();
  const row = (overrides: Partial<HistoryRow> & { id?: string }): HistoryRow & { id?: string } => ({
    action: "ACKNOWLEDGE", acknowledgedAt: day(10), recordedAt: day(10), ...overrides,
  });
  const kindAt = (rows: HistoryRow[], offset: number) => latestLiveAction(rows, new Date(day(offset)))?.kind ?? null;

  it("has labels for the new statuses", () => {
    expect(statusLabels.DECLINED).toBe("Declined");
    expect(statusLabels.WITHDRAWN).toBe("Withdrawn");
    expect(resolveAcknowledgmentStatus({ evidence: { source: "TEXT", action: "DECLINE" } })).toBe("DECLINED");
    expect(resolveAcknowledgmentStatus({ evidence: { source: "POLICY_VERSION", action: "WITHDRAWAL" } })).toBe("WITHDRAWN");
  });

  it("is withdrawn only from the withdrawal moment: the acceptance stays valid before it", () => {
    const rows = [row({ withdrawal: { withdrawnAt: day(20), recordedAt: day(25) } })];
    expect(kindAt(rows, 5)).toBeNull();
    expect(kindAt(rows, 15)).toBe("ACKNOWLEDGE");
    expect(kindAt(rows, 19)).toBe("ACKNOWLEDGE");
    expect(kindAt(rows, 20)).toBe("WITHDRAWAL");
    expect(kindAt(rows, 400)).toBe("WITHDRAWAL");
  });

  it("is accepted again after accept, withdraw, re-accept, and keeps each past answer", () => {
    const rows = [
      row({ withdrawal: { withdrawnAt: day(20), recordedAt: day(20) } }),
      row({ acknowledgedAt: day(30), recordedAt: day(30) }),
    ];
    expect(kindAt(rows, 15)).toBe("ACKNOWLEDGE");
    expect(kindAt(rows, 25)).toBe("WITHDRAWAL");
    expect(kindAt(rows, 35)).toBe("ACKNOWLEDGE");
    expect(latestLiveAction(rows)?.kind).toBe("ACKNOWLEDGE");
  });

  it("skips an acceptance voided by the moment, with its withdrawal, but not before the void", () => {
    const rows = [row({ voidedAt: day(22), withdrawal: { withdrawnAt: day(20), recordedAt: day(20) } })];
    expect(kindAt(rows, 21)).toBe("WITHDRAWAL");
    expect(kindAt(rows, 23)).toBeNull();
  });

  it("lets the latest of a decline and an acceptance win", () => {
    const rows = [row({ action: "DECLINE", acknowledgedAt: day(5), recordedAt: day(5) }), row({ acknowledgedAt: day(10) })];
    expect(kindAt(rows, 7)).toBe("DECLINE");
    expect(kindAt(rows, 12)).toBe("ACKNOWLEDGE");
  });

  it("settles a tie at the same moment in favor of what was recorded last", () => {
    const rows = [row({ acknowledgedAt: day(10), recordedAt: day(10), withdrawal: { withdrawnAt: day(10), recordedAt: day(11) } })];
    expect(kindAt(rows, 10)).toBe("WITHDRAWAL");
  });

  it("knows whether an acceptance is still live", () => {
    expect(hasLiveAcceptance([row({})])).toBe(true);
    expect(hasLiveAcceptance([row({ voidedAt: day(11) })])).toBe(false);
    expect(hasLiveAcceptance([row({ withdrawal: { withdrawnAt: day(11) } })])).toBe(false);
    expect(hasLiveAcceptance([row({ action: "DECLINE" })])).toBe(false);
  });
});

describe("paper location and request hashes (#130)", () => {
  it("requires a trimmed 1 to 200 character location for paper and refuses it elsewhere", () => {
    expect(normalizePaperLocation("PAPER", "  Synthetic office, binder  ")).toEqual({ ok: true, value: "Synthetic office, binder" });
    expect(normalizePaperLocation("PAPER", "   ")).toMatchObject({ ok: false, code: "PAPER_LOCATION_REQUIRED" });
    expect(normalizePaperLocation("PAPER", null)).toMatchObject({ ok: false, code: "PAPER_LOCATION_REQUIRED" });
    expect(normalizePaperLocation("PAPER", "x".repeat(201))).toMatchObject({ ok: false, code: "PAPER_LOCATION_REQUIRED" });
    expect(normalizePaperLocation("PAPER", "x".repeat(200))).toMatchObject({ ok: true });
    expect(normalizePaperLocation("STAFF_ENTERED", "Synthetic office")).toMatchObject({ ok: false, code: "PAPER_LOCATION_NOT_ALLOWED" });
    expect(normalizePaperLocation("STAFF_ENTERED", null)).toEqual({ ok: true, value: null });
    expect(normalizePaperLocation("ONLINE", "  ")).toEqual({ ok: true, value: null });
  });

  it("keeps an acknowledgment's request hash unchanged, and tells a decline or another location apart", () => {
    const base = { eventId: "e", registrationId: "r", registrationAttendeeId: null, fieldKey: "k", actedByPersonId: "p", channel: "STAFF_ENTERED" as const, contentRef: "text:abc" };
    expect(evidenceRequestHash({ ...base, action: "ACKNOWLEDGE", paperLocation: null })).toBe(evidenceRequestHash(base));
    expect(evidenceRequestHash({ ...base, action: "DECLINE" })).not.toBe(evidenceRequestHash(base));
    const paper = { ...base, channel: "PAPER" as const };
    expect(evidenceRequestHash({ ...paper, paperLocation: "Synthetic binder" })).not.toBe(evidenceRequestHash({ ...paper, paperLocation: "Another binder" }));
    const withdrawal = { eventId: "e", registrationId: "r", evidenceId: "ev", actedByPersonId: null, channel: "STAFF_ENTERED" as const, paperLocation: null };
    expect(withdrawalRequestHash(withdrawal)).not.toBe(withdrawalRequestHash({ ...withdrawal, evidenceId: "ev-2" }));
  });
});

describe("amendments hold acknowledgment answers", () => {
  const form = definition();
  const stored = {
    registration: { reg_ack: true, wants_program: "No" },
    attendee: (id: string) => (id === "att-1" ? { first_name: "Ann", att_ack: true } : null),
  };

  it("restores stored answers, so an amendment can neither change nor remove one", () => {
    const { input, keys } = holdAcknowledgmentAnswers(form, {
      responses: { reg_ack: false, wants_program: "Yes" },
      attendees: [{ attendeeId: "att-1", responses: { first_name: "Ann", att_ack: false } }],
    }, stored);
    expect(input.responses).toEqual({ reg_ack: true, wants_program: "Yes" });
    expect(input.attendees[0]!.responses).toEqual({ first_name: "Ann", att_ack: true });
    expect(keys).toEqual(["reg_ack", "program_ack", "att_ack", "att_cond_ack"]);
  });

  it("gives a new attendee, and an acknowledgment never stored, none", () => {
    const { input } = holdAcknowledgmentAnswers(form, {
      responses: { program_ack: true },
      attendees: [{ attendeeId: null, responses: { first_name: "New", att_ack: true } }, { attendeeId: "att-1", responses: { first_name: "Ann", att_cond_ack: true } }],
    }, stored);
    expect(input.responses).toEqual({ reg_ack: true });
    expect(input.attendees[0]!.responses).toEqual({ first_name: "New" });
    expect(input.attendees[1]!.responses).toEqual({ first_name: "Ann", att_ack: true });
  });

  it("leaves a form without acknowledgments untouched", () => {
    const plain = registrationFormDefinitionSchema.parse({
      title: "Plain form", confirmationMessage: "Received.",
      sections: [{ id: "sec_plain", title: "Plain section", description: "", fields: [{ id: "f_name", key: "name", label: "Name", type: "TEXT", scope: "REGISTRATION", required: false, options: [] }] }],
    });
    const original = { responses: { name: "x" }, attendees: [] };
    const held = holdAcknowledgmentAnswers(plain, original, stored);
    expect(held.input).toBe(original);
    expect(held.keys).toEqual([]);
  });
});
