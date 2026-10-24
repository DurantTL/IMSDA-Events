import { describe, expect, it } from "vitest";
import { calculateCancellation, type CalculationFacts } from "@/modules/cancellation-policy/calculator";
import { parseCancellationRules } from "@/modules/cancellation-policy/rules";
import { campMeetingPreset } from "./support/camp-meeting-seeds";
import {
  canonicalState,
  canTransition,
  diffRegistrationState,
  hasChangeConflict,
  nextStatuses,
  openStatuses,
  registrantActionSchema,
  registrantProposal,
  registrationStateOf,
  requestStatuses,
  scopeKeyOf,
  scopesOverlap,
  staffActionSchema,
  requestStatusDetails,
} from "@/modules/cancellation-requests/domain";
import { DEFAULT_MESSAGE_TEMPLATES, renderMessageTemplate } from "@/modules/communications/templates";

/**
 * #170: the pure rules of the cancellation request workflow. Synthetic data only.
 */

const rules = parseCancellationRules(campMeetingPreset("2026-05-25"));
const policy = { id: "pv-1", version: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"), rules };

function facts(overrides: Partial<CalculationFacts> = {}): CalculationFacts {
  return {
    evaluatedAt: "2026-05-01T15:00:00.000Z",
    clock: "SERVER",
    eventTimezone: "America/Chicago",
    registration: { id: "reg-1", confirmationCode: "SYN001", status: "CONFIRMED" },
    attendees: [{ id: "att-1", position: 0 }, { id: "att-2", position: 1 }],
    charges: [
      { id: "line:a", source: "PRICING_LINE", label: "Registration, attendee one", amountCents: 10_000, category: "REGISTRATION", fieldKey: "a", attendeeId: "att-1" },
      { id: "line:b", source: "PRICING_LINE", label: "Registration, attendee two", amountCents: 10_000, category: "REGISTRATION", fieldKey: "b", attendeeId: "att-2" },
    ],
    registrationPaidCents: 20_000,
    depositCents: 5_000,
    depositSource: "RECORDED_DEPOSIT",
    noShowFirstNight: false,
    ...overrides,
  };
}

describe("request statuses and who may move them (#170)", () => {
  it("has exactly the seven statuses of the issue", () => {
    expect([...requestStatuses]).toEqual(["REQUESTED", "UNDER_REVIEW", "INFORMATION_NEEDED", "APPROVED", "DECLINED", "WITHDRAWN", "SUPERSEDED"]);
    expect([...openStatuses]).toEqual(["REQUESTED", "UNDER_REVIEW", "INFORMATION_NEEDED"]);
  });

  it("lets only staff approve or decline, and never the registrant or the system", () => {
    for (const from of openStatuses) {
      expect(canTransition(from, "APPROVED", "STAFF")).toBe(true);
      expect(canTransition(from, "DECLINED", "STAFF")).toBe(true);
      expect(canTransition(from, "APPROVED", "REGISTRANT")).toBe(false);
      expect(canTransition(from, "DECLINED", "REGISTRANT")).toBe(false);
      expect(canTransition(from, "APPROVED", "SYSTEM")).toBe(false);
      expect(canTransition(from, "DECLINED", "SYSTEM")).toBe(false);
    }
  });

  it("lets a registrant only withdraw, and the system only supersede", () => {
    for (const from of openStatuses) {
      expect(nextStatuses(from, "REGISTRANT")).toEqual(["WITHDRAWN"]);
      expect(nextStatuses(from, "SYSTEM")).toEqual(["SUPERSEDED"]);
    }
  });

  it("treats the four end states as final for everyone", () => {
    for (const from of ["APPROVED", "DECLINED", "WITHDRAWN", "SUPERSEDED"] as const) {
      for (const actor of ["STAFF", "REGISTRANT", "SYSTEM"] as const) expect(nextStatuses(from, actor)).toEqual([]);
    }
  });

  it("gives every status a plain sentence that says nothing about the reason or an amount", () => {
    for (const status of requestStatuses) {
      expect(requestStatusDetails[status]).not.toMatch(/\$|\d/);
    }
  });
});

describe("scope keys and overlap (#170)", () => {
  it("is the same key whatever the order of the ids", () => {
    const one = scopeKeyOf({ scope: "ATTENDEE", attendeeIds: ["b", "a"], chargeIds: [] });
    const two = scopeKeyOf({ scope: "ATTENDEE", attendeeIds: ["a", "b", "a"], chargeIds: [] });
    expect(one).toBe(two);
    expect(scopeKeyOf({ scope: "FULL_REGISTRATION", attendeeIds: ["a"], chargeIds: [] })).toBe("FULL_REGISTRATION");
  });

  it("overlaps when the whole registration is involved or when ids are shared", () => {
    const full = { scope: "FULL_REGISTRATION", attendeeIds: [], chargeIds: [] } as const;
    const a = { scope: "ATTENDEE", attendeeIds: ["a"], chargeIds: [] } as const;
    const b = { scope: "ATTENDEE", attendeeIds: ["b"], chargeIds: [] } as const;
    const ab = { scope: "ATTENDEE", attendeeIds: ["a", "b"], chargeIds: [] } as const;
    const component = { scope: "COMPONENT", attendeeIds: [], chargeIds: ["line:x"] } as const;
    expect(scopesOverlap(full, a)).toBe(true);
    expect(scopesOverlap(a, b)).toBe(false);
    expect(scopesOverlap(a, ab)).toBe(true);
    expect(scopesOverlap(a, component)).toBe(true);
    expect(scopesOverlap(component, { scope: "COMPONENT", attendeeIds: [], chargeIds: ["line:y"] })).toBe(false);
  });

  it("uses the effective scope, so choosing every attendee is the whole registration", () => {
    const result = calculateCancellation({ facts: facts(), selection: { scope: "ATTENDEE", attendeeIds: ["att-1", "att-2"] }, policyVersions: [policy] });
    expect(result.scope?.effective).toBe("FULL_REGISTRATION");
    expect(scopeKeyOf({ scope: result.scope!.effective, attendeeIds: result.scope!.attendeeIds, chargeIds: result.scope!.chargeIds })).toBe("FULL_REGISTRATION");
  });
});

const stateOf = (state: ReturnType<typeof registrationStateOf>) => canonicalState(state);

describe("registration state and what changed (#170)", () => {
  it("records ids and amounts only", () => {
    const state = registrationStateOf(facts());
    expect(state).toEqual({
      registrationStatus: "CONFIRMED",
      attendeeIds: ["att-1", "att-2"],
      charges: [
        { id: "line:a", amountCents: 10_000, attendeeId: "att-1", category: "REGISTRATION", fieldKey: "a" },
        { id: "line:b", amountCents: 10_000, attendeeId: "att-2", category: "REGISTRATION", fieldKey: "b" },
      ],
      paidCents: 20_000,
      depositCents: 5_000,
    });
    expect(JSON.stringify(state)).not.toContain("Registration, attendee");
  });

  it("reports no conflicts when nothing changed", () => {
    expect(diffRegistrationState(registrationStateOf(facts()), registrationStateOf(facts()))).toEqual([]);
  });

  it("treats a charge moving to another attendee, or changing its category or field, as a change, though id and amount are the same", () => {
    const then = registrationStateOf(facts());
    const mutate = (change: Partial<CalculationFacts["charges"][number]>) => {
      const base = facts();
      return registrationStateOf({ ...base, charges: base.charges.map((charge, index) => (index === 0 ? { ...charge, ...change } : charge)) });
    };
    for (const change of [{ attendeeId: "att-2" }, { category: "MEAL" as const }, { fieldKey: "other_field" }, { attendeeId: null }]) {
      const conflicts = diffRegistrationState(then, mutate(change));
      expect(conflicts.map((conflict) => [conflict.code, conflict.severity]), JSON.stringify(change)).toEqual([["CHARGES_CHANGED", "CHANGE"]]);
    }
    expect(stateOf(then)).not.toBe(stateOf(mutate({ attendeeId: "att-2" })));
  });

  it("flags a removed attendee, a changed charge, a payment and a status change as changes", () => {
    const then = registrationStateOf(facts());
    const now = registrationStateOf(facts({
      registration: { id: "reg-1", confirmationCode: "SYN001", status: "WAITLISTED" },
      attendees: [{ id: "att-1", position: 0 }],
      charges: [{ id: "line:a", source: "PRICING_LINE", label: "x", amountCents: 12_000, category: "REGISTRATION", fieldKey: "a", attendeeId: "att-1" }],
      registrationPaidCents: 12_000,
      depositCents: 0,
    }));
    const codes = diffRegistrationState(then, now).map((conflict) => conflict.code).sort();
    expect(codes).toEqual(["ATTENDEES_CHANGED", "CHARGES_CHANGED", "DEPOSIT_CHANGED", "PAYMENTS_CHANGED", "REGISTRATION_STATUS_CHANGED"]);
    expect(hasChangeConflict(diffRegistrationState(then, now))).toBe(true);
    expect(hasChangeConflict([{ code: "OVERLAPPING_OPEN_REQUEST", severity: "NOTE", message: "n" }])).toBe(false);
  });
});

describe("what the registrant is shown (#170)", () => {
  it("shows the outcome and the notice, and leaves out the rules JSON and the raw facts", () => {
    const result = calculateCancellation({ facts: facts(), selection: { scope: "ATTENDEE", attendeeIds: ["att-1"] }, policyVersions: [policy] });
    const proposal = registrantProposal(result);
    expect(proposal.status).toBe("CALCULATED");
    expect(proposal.refundCents).toBe(result.money.refundCents);
    expect(proposal.afterDeadline).toBe(false);
    expect(proposal.notice).toMatch(/not a decision/);
    const text = JSON.stringify(proposal);
    expect(text).not.toContain("allowedScopes");
    expect(text).not.toContain("registrationPaidCents");
    expect(text).not.toContain("SYN001");
  });

  it("says plainly that a request after the last deadline is after the deadline", () => {
    const result = calculateCancellation({ facts: facts({ evaluatedAt: "2026-06-10T15:00:00.000Z" }), selection: { scope: "FULL_REGISTRATION" }, policyVersions: [policy] });
    const proposal = registrantProposal(result);
    expect(proposal.afterDeadline).toBe(true);
    expect(proposal.depositOutcome).toBe("FORFEITED");
    expect(proposal.registrationWouldBeCancelled).toBe(true);
  });

  it("gives an unavailable calculation no lines and no explanation", () => {
    const result = calculateCancellation({ facts: facts(), selection: { scope: "ATTENDEE", attendeeIds: ["somebody-else"] }, policyVersions: [policy] });
    const proposal = registrantProposal(result);
    expect(proposal.status).toBe("INVALID_SELECTION");
    expect(proposal.lines).toEqual([]);
    expect(proposal.explanation).toEqual([]);
  });
});

describe("what a person may send (#170)", () => {
  const selection = { scope: "FULL_REGISTRATION" as const };

  it("needs a reason, a contact method and a request key to submit", () => {
    const ok = { action: "submit", selection, reason: "A family emergency.", contactMethod: "EMAIL", idempotencyKey: "key-12345678", expectedRefundCents: 1000 };
    expect(registrantActionSchema.safeParse(ok).success).toBe(true);
    expect(registrantActionSchema.safeParse({ ...ok, reason: "  " }).success).toBe(false);
    expect(registrantActionSchema.safeParse({ ...ok, contactMethod: "TEXT" }).success).toBe(false);
    expect(registrantActionSchema.safeParse({ ...ok, idempotencyKey: "short" }).success).toBe(false);
    expect(registrantActionSchema.safeParse({ ...ok, status: "APPROVED" }).success).toBe(false);
  });

  it("cannot name a registration, an event, a status or a clock", () => {
    for (const extra of [{ registrationId: "other" }, { eventId: "other" }, { status: "APPROVED" }, { asOf: "2020-01-01T00:00:00Z" }, { noShowFirstNight: true }]) {
      expect(registrantActionSchema.safeParse({ action: "preview", selection, ...extra }).success).toBe(false);
    }
  });

  it("makes staff give a reason to approve or decline and say what is needed to ask for information", () => {
    expect(staffActionSchema.safeParse({ action: "APPROVE", reason: "" }).success).toBe(false);
    expect(staffActionSchema.safeParse({ action: "APPROVE" }).success).toBe(false);
    expect(staffActionSchema.safeParse({ action: "DECLINE", reason: " " }).success).toBe(false);
    expect(staffActionSchema.safeParse({ action: "REQUEST_INFORMATION" }).success).toBe(false);
    expect(staffActionSchema.safeParse({ action: "APPROVE", reason: "Within the policy." }).success).toBe(true);
    expect(staffActionSchema.safeParse({ action: "START_REVIEW" }).success).toBe(true);
    // There is no automated or bulk action.
    expect(staffActionSchema.safeParse({ action: "AUTO_APPROVE" }).success).toBe(false);
    expect(staffActionSchema.safeParse({ action: "APPROVE_ALL", reason: "x" }).success).toBe(false);
  });
});

describe("status emails (#170)", () => {
  const context = {
    recipient_name: "Avery Synthetic",
    event_name: "Synthetic Event",
    confirmation_code: "SYN001",
    contact_email: "office@example.test",
    portal_url: "https://events.example.test/manage/preview",
    request_status: "Approved",
    request_status_detail: requestStatusDetails.APPROVED,
  };

  it.each(["CANCELLATION_REQUEST_RECEIVED", "CANCELLATION_REQUEST_UPDATED"] as const)("%s renders completely and shows only a status", (key) => {
    const template = DEFAULT_MESSAGE_TEMPLATES[key];
    const rendered = renderMessageTemplate({ subject: template.subject, body: template.body }, context);
    expect(rendered.isComplete).toBe(true);
    expect(rendered.unresolvedTokens).toEqual([]);
    expect(rendered.body).toContain("Approved");
    expect(rendered.body).not.toMatch(/\$\s?\d/);
    expect(template.body).not.toMatch(/\{\{(refund_amount|payment_amount|total_amount|balance_amount|payment_status_block|attendee_summary)\}\}/);
  });
});
