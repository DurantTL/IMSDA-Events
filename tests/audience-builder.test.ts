import { describe, expect, it } from "vitest";
import {
  AUDIENCE_QUERY_VERSION,
  AudienceFilterNotAvailableError,
  assertQueryAvailable,
  audienceQueryHash,
  describeAvailableFilters,
  normalizeAudienceQuery,
  type AudienceCapabilities,
  type AudienceDomain,
} from "@/modules/communications/audience-query";
import {
  AudienceAccumulator,
  pageAudienceList,
  type AudienceRegistrationRow,
  type AudienceSuppressionCode,
} from "@/modules/communications/audience-resolve";

const context = { isOrganizationBilled: false, tagNames: new Map([["tag-vip", "VIP"]]) };

function row(overrides: Partial<AudienceRegistrationRow> & { registrationId: string }): AudienceRegistrationRow {
  return {
    confirmationCode: overrides.registrationId.toUpperCase(),
    status: "CONFIRMED",
    totalCents: 10000,
    netPaidCents: 10000,
    contact: { name: "Pat Example", email: "pat@example.test" },
    hasPublicSubmission: false,
    tagIds: [],
    attendees: [],
    groupLeader: null,
    organizationContact: null,
    ...overrides,
  };
}

function attendee(id: string, extra: Partial<AudienceRegistrationRow["attendees"][number]> = {}) {
  return {
    attendeeId: id,
    attendeeType: "ADULT",
    name: `Attendee ${id}`,
    email: `${id}@example.test`,
    checkedIn: false,
    hasResponses: true,
    tagIds: [] as string[],
    ...extra,
  };
}

function run(rows: AudienceRegistrationRow[], input: unknown, suppressions = new Map<string, AudienceSuppressionCode>()) {
  const query = normalizeAudienceQuery(input);
  const accumulator = new AudienceAccumulator(query, context, "evt");
  for (const item of rows) accumulator.consider(item);
  return accumulator.finalize(suppressions);
}

const caps = (permissions: string[], domains: AudienceDomain[] = ["REGISTRATION"]): AudienceCapabilities => ({
  permissions: new Set(permissions),
  domains: new Set(domains),
});

describe("audience query contract", () => {
  it("normalizes to one canonical form and a stable hash", () => {
    const a = normalizeAudienceQuery({ roles: ["ATTENDEE", "REGISTRATION_CONTACT"], tagIds: ["b", "a", "a"] });
    const b = normalizeAudienceQuery({ tagIds: ["a", "b"], roles: ["REGISTRATION_CONTACT", "ATTENDEE"], lifecycles: ["CONFIRMED", "SUBMITTED"] });
    expect(a).toEqual(b);
    expect(audienceQueryHash(a)).toBe(audienceQueryHash(b));
    expect(audienceQueryHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(AUDIENCE_QUERY_VERSION).toBe("audience-query/1");
  });

  it("rejects unknown keys, so a protected field can never be a filter", () => {
    for (const key of ["noteContains", "medicalFlag", "consentEvidence", "screeningStatus", "privateEventMembers", "allergies"]) {
      expect(() => normalizeAudienceQuery({ [key]: ["x"] })).toThrow();
    }
    expect(() => normalizeAudienceQuery({ lifecycles: ["DRAFT"] })).toThrow();
  });

  it("refuses a dimension the caller may not use with one fixed message that names nothing", () => {
    const query = normalizeAudienceQuery({ tagIds: ["tag-secret-name"], checkInStates: ["CHECKED_IN"] });
    let failure: unknown;
    try {
      assertQueryAvailable(query, caps(["MANAGE_COMMUNICATIONS"]));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AudienceFilterNotAvailableError);
    const message = (failure as Error).message;
    expect(message).not.toMatch(/tag|secret|check|CHECKED/i);
    expect(() => assertQueryAvailable(query, caps(["VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN"]))).not.toThrow();
  });

  it("refuses a role whose domain the event lacks, identically", () => {
    const query = normalizeAudienceQuery({ roles: ["GROUP_LEADER"] });
    expect(() => assertQueryAvailable(query, caps([]))).toThrow(AudienceFilterNotAvailableError);
    expect(() => assertQueryAvailable(query, caps([], ["REGISTRATION", "GROUPS"]))).not.toThrow();
  });

  it("offers only available dimensions, with no value for a forbidden one", () => {
    const options = { tags: [{ id: "tag-vip", name: "VIP" }], attendeeTypes: ["ADULT"] };
    const limited = describeAvailableFilters(caps(["MANAGE_COMMUNICATIONS"]), options);
    const dimensions = limited.filters.map((filter) => filter.dimension);
    expect(dimensions).toEqual(["lifecycles", "attendeeTypes", "balanceStates"]);
    expect(JSON.stringify(limited)).not.toContain("VIP");
    expect(limited.roles.map((role) => role.role)).toEqual(["REGISTRATION_CONTACT", "ATTENDEE"]);
    const full = describeAvailableFilters(
      caps(["VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN", "MANAGE_REGISTRATION"], ["REGISTRATION", "GROUPS", "ORGANIZATIONS"]),
      options,
    );
    expect(full.filters.map((filter) => filter.dimension)).toContain("tagIds");
    expect(full.roles).toHaveLength(4);
  });
});

describe("audience resolution", () => {
  it("de-duplicates by email, keeping every role and each registration's own balance", () => {
    const result = run([
      row({
        registrationId: "r1",
        totalCents: 20000,
        netPaidCents: 5000,
        contact: { name: "Pat Example", email: "Shared@Example.test " },
        attendees: [attendee("a1", { email: "shared@example.test", name: "Pat Example" })],
      }),
      row({
        registrationId: "r2",
        totalCents: 8000,
        netPaidCents: 0,
        contact: { name: "Pat Example", email: "shared@example.test" },
      }),
    ], { roles: ["REGISTRATION_CONTACT", "ATTENDEE"] });
    expect(result.recipients).toHaveLength(1);
    const [recipient] = result.recipients;
    expect(recipient!.email).toBe("shared@example.test");
    expect(recipient!.roles).toEqual(["ATTENDEE", "REGISTRATION_CONTACT"]);
    expect(recipient!.registrations.map((entry) => [entry.registrationId, entry.roles, entry.balanceCents])).toEqual([
      ["r1", ["ATTENDEE", "REGISTRATION_CONTACT"], 15000],
      ["r2", ["REGISTRATION_CONTACT"], 8000],
    ]);
    expect(result.counts.messageTargetCount).toBe(2);
    expect(result.counts.totalBalanceCents).toBe(23000);
    expect(result.counts.duplicateMergedCount).toBe(2);
    expect(recipient!.reasons.some((reason) => reason.dimension === "roles" && reason.value === "ATTENDEE")).toBe(true);
  });

  it("gives the same audience and fingerprint whatever order rows arrive in", () => {
    const rows = [
      row({ registrationId: "r1", contact: { name: "A", email: "a@example.test" } }),
      row({ registrationId: "r2", contact: { name: "B", email: "b@example.test" } }),
      row({ registrationId: "r3", contact: { name: "A2", email: "a@example.test" } }),
    ];
    const forward = run(rows, {});
    const backward = run([...rows].reverse(), {});
    expect(backward.fingerprint).toBe(forward.fingerprint);
    expect(backward.recipients).toEqual(forward.recipients);
    expect(forward.recipients[0]!.displayName).toBe("A");
  });

  it("changes the fingerprint when a balance, address, tag state or suppression changes, but not for a name", () => {
    const base = [row({ registrationId: "r1", totalCents: 5000, netPaidCents: 0 })];
    const original = run(base, {});
    expect(run([{ ...base[0]!, netPaidCents: 100 }], {}).fingerprint).not.toBe(original.fingerprint);
    expect(run([{ ...base[0]!, contact: { name: "Pat", email: "new@example.test" } }], {}).fingerprint).not.toBe(original.fingerprint);
    expect(run(base, {}, new Map([["pat@example.test", "PROVIDER_BOUNCED"]])).fingerprint).not.toBe(original.fingerprint);
    expect(run([{ ...base[0]!, contact: { name: "Renamed Person", email: "pat@example.test" } }], {}).fingerprint).toBe(original.fingerprint);
  });

  it("explains every exclusion: missing, invalid and suppressed addresses", () => {
    const result = run([
      row({ registrationId: "r1", contact: { name: "No Email", email: null } }),
      row({ registrationId: "r2", contact: { name: "Bad", email: "not-an-email" } }),
      row({ registrationId: "r3", contact: { name: "Out", email: "out@example.test" } }),
      row({ registrationId: "r4", contact: { name: "Bounce", email: "bounce@example.test" } }),
      row({ registrationId: "r5", contact: { name: "Fine", email: "fine@example.test" } }),
    ], {}, new Map<string, AudienceSuppressionCode>([["out@example.test", "OPTED_OUT_EVENT"], ["bounce@example.test", "PROVIDER_BOUNCED"]]));
    expect(result.recipients.map((recipient) => recipient.email)).toEqual(["fine@example.test"]);
    expect(result.exclusions.map((exclusion) => exclusion.code).sort()).toEqual([
      "INVALID_EMAIL", "NO_EMAIL", "OPTED_OUT_EVENT", "PROVIDER_BOUNCED",
    ]);
    for (const exclusion of result.exclusions) {
      expect(exclusion.label.length).toBeGreaterThan(0);
      expect(exclusion.reasons.length).toBeGreaterThan(0);
    }
    expect(result.counts.exclusionCount).toBe(4);
    expect(result.counts.consideredRegistrationCount).toBe(5);
  });

  it("qualifies only by the supported normalized dimensions, each with its reason", () => {
    const rows = [
      row({ registrationId: "r1", totalCents: 5000, netPaidCents: 0, tagIds: ["tag-vip"], attendees: [attendee("a1", { checkedIn: true })] }),
      row({ registrationId: "r2", totalCents: 5000, netPaidCents: 5000, attendees: [attendee("a2")] }),
      row({ registrationId: "r3", status: "CANCELLED", totalCents: 5000, netPaidCents: 0 }),
    ];
    const due = run(rows, { balanceStates: ["BALANCE_DUE"] });
    expect(due.recipients.map((recipient) => recipient.registrations[0]!.registrationId)).toEqual(["r1"]);
    expect(due.recipients[0]!.reasons.map((reason) => `${reason.dimension}:${reason.value}`)).toEqual([
      "balanceStates:BALANCE_DUE", "lifecycles:CONFIRMED", "roles:REGISTRATION_CONTACT",
    ]);
    expect(run(rows, { tagIds: ["tag-vip"] }).counts.recipientCount).toBe(1);
    expect(run(rows, { checkInStates: ["NOT_CHECKED_IN"] }).recipients.map((recipient) => recipient.registrations[0]!.registrationId)).toEqual(["r2"]);
    expect(run(rows, { lifecycles: ["CANCELLED"] }).counts.recipientCount).toBe(1);
  });

  it("readiness is only the normalized status, never what a response says", () => {
    const rows = [
      row({ registrationId: "r1", hasPublicSubmission: true, attendees: [attendee("a1", { hasResponses: false })] }),
      row({ registrationId: "r2", hasPublicSubmission: true, attendees: [attendee("a2", { hasResponses: true })] }),
    ];
    const result = run(rows, { readinessStates: ["ATTENDEE_RESPONSES_INCOMPLETE"] });
    expect(result.recipients.map((recipient) => recipient.registrations[0]!.registrationId)).toEqual(["r1"]);
  });

  it("restricted notes, medical and consent data have no way in: rows carry none and the output holds none", () => {
    const hostile = {
      ...row({ registrationId: "r1", attendees: [attendee("a1")] }),
      // Fields a careless loader might attach. The resolver never reads them and never copies them out.
      restrictedNote: "RESTRICTED-NOTE-BODY",
      allergies: "PEANUT-ALLERGY-DETAIL",
      consentEvidence: "CONSENT-EVIDENCE-TEXT",
      privateEventMembers: ["private-member@example.test"],
    } as unknown as AudienceRegistrationRow;
    const result = run([hostile], { roles: ["REGISTRATION_CONTACT", "ATTENDEE"] });
    const serialized = JSON.stringify(result);
    for (const secret of ["RESTRICTED-NOTE-BODY", "PEANUT-ALLERGY-DETAIL", "CONSENT-EVIDENCE-TEXT", "private-member@example.test"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("an organization-billed event never reports a balance due", () => {
    const query = normalizeAudienceQuery({ balanceStates: ["BALANCE_DUE"] });
    const billed = new AudienceAccumulator(query, { ...context, isOrganizationBilled: true }, "evt");
    billed.consider(row({ registrationId: "r1", totalCents: 5000, netPaidCents: 0 }));
    expect(billed.finalize().counts.recipientCount).toBe(0);
  });

  it("groups several unreachable attendees of one registration into one explained exclusion", () => {
    const result = run([
      row({ registrationId: "r1", attendees: [attendee("a1", { email: null }), attendee("a2", { email: null })] }),
    ], { roles: ["ATTENDEE"] });
    expect(result.exclusions).toHaveLength(1);
    expect(result.exclusions[0]!.contactCount).toBe(2);
  });
});

describe("large audiences", () => {
  it("counts and pages 20,000 registrations deterministically without repeating or skipping anyone", () => {
    const rows = Array.from({ length: 20_000 }, (_, index) => row({
      registrationId: `r${String(index).padStart(6, "0")}`,
      contact: { name: `P${index}`, email: `p${index % 15_000}@example.test` },
      totalCents: 1000,
      netPaidCents: index % 3 === 0 ? 0 : 1000,
    }));
    const result = run(rows, {});
    expect(result.counts.recipientCount).toBe(15_000);
    expect(result.counts.messageTargetCount).toBe(20_000);

    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    for (;;) {
      const page = pageAudienceList(result.recipients, (recipient) => recipient.email, { limit: 200, after });
      seen.push(...page.items.map((recipient) => recipient.email));
      pages += 1;
      if (!page.nextCursor) break;
      after = page.nextCursor;
    }
    expect(pages).toBe(75);
    expect(seen).toEqual(result.recipients.map((recipient) => recipient.email));
    expect(new Set(seen).size).toBe(15_000);
    expect(run([...rows].reverse(), {}).fingerprint).toBe(result.fingerprint);
  });
});
