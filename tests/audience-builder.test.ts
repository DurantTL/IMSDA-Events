import { describe, expect, it } from "vitest";
import {
  AUDIENCE_QUERY_VERSION,
  AudienceFilterNotAvailableError,
  assertQueryAvailable,
  audienceQueryHash,
  audienceSearchQuery,
  describeAvailableFilters,
  normalizeAudienceQuery,
  type AudienceCapabilities,
  type AudienceDomain,
} from "@/modules/communications/audience-query";
import {
  AudienceAccumulator,
  buildSearchReasons,
  pageAudienceList,
  type AudienceEvaluationContext,
  type AudienceRegistrationRow,
  type AudienceSuppressionCode,
} from "@/modules/communications/audience-resolve";
import {
  availableOperationsFilters,
  emptySearchCatalog,
  parseOperationsSearchParams,
  resolveOperationsSearch,
  type SearchCatalog,
  type SearchViewer,
} from "@/modules/registrations/operations-search-domain";

const baseContext: AudienceEvaluationContext = {
  isOrganizationBilled: false,
  tagNames: new Map([["tag-vip", "VIP"]]),
  attendeeTypeLabels: new Map([["YOUTH", "Youth"]]),
  selection: { attendeeTypes: [], tagIds: [] },
  searchReasons: [],
};

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
    hasResponses: true,
    tagIds: [] as string[],
    ...extra,
  };
}

function run(
  rows: AudienceRegistrationRow[],
  input: unknown,
  suppressions = new Map<string, AudienceSuppressionCode>(),
  context: Partial<AudienceEvaluationContext> = {},
) {
  const query = normalizeAudienceQuery(input);
  const search = audienceSearchQuery(query);
  const accumulator = new AudienceAccumulator(query, {
    ...baseContext,
    selection: { attendeeTypes: search.attendeeType, tagIds: search.tag },
    ...context,
  }, "evt");
  for (const item of rows) accumulator.consider(item);
  return accumulator.finalize(suppressions);
}

const caps = (permissions: string[], domains: AudienceDomain[] = ["REGISTRATION"]): AudienceCapabilities => ({
  permissions: new Set(permissions),
  domains: new Set(domains),
});

const catalog: SearchCatalog = {
  ...emptySearchCatalog(),
  attendeeTypes: [{ code: "ADULT", label: "Adult" }, { code: "YOUTH", label: "Youth" }],
  tags: [{ id: "tag-vip", name: "VIP", isActive: true }],
};
const viewer = (permissions: SearchViewer["permissions"]): SearchViewer => ({ eventId: "evt", permissions });

describe("audience query contract", () => {
  it("is audience-query/2 and normalizes to one canonical form and a stable hash", () => {
    const a = normalizeAudienceQuery({ roles: ["ATTENDEE", "REGISTRATION_CONTACT"], search: "tag=b,a,a&status=CONFIRMED,SUBMITTED" });
    const b = normalizeAudienceQuery({ search: "status=SUBMITTED,CONFIRMED&tag=a,b", roles: ["REGISTRATION_CONTACT", "ATTENDEE"] });
    expect(a).toEqual(b);
    expect(a.search).toBe("status=SUBMITTED%2CCONFIRMED&tag=a%2Cb");
    expect(audienceQueryHash(a)).toBe(audienceQueryHash(b));
    expect(audienceQueryHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(AUDIENCE_QUERY_VERSION).toBe("audience-query/2");
  });

  it("carries the operations search in its canonical URL-safe form, which reads back to the same search", () => {
    const query = normalizeAudienceQuery({ search: "payment=PARTIAL,UNPAID&checkIn=NONE&answer=ATTENDEE:meal=vegan" });
    expect(parseOperationsSearchParams(new URLSearchParams(query.search)).issues).toEqual([]);
    expect(normalizeAudienceQuery({ search: query.search }).search).toBe(query.search);
    expect(audienceSearchQuery(query).payment).toEqual(["UNPAID", "PARTIAL"]);
  });

  it("defaults the lifecycle to submitted and confirmed, and ignores sort and paging", () => {
    expect(audienceSearchQuery(normalizeAudienceQuery({})).status).toEqual(["SUBMITTED", "CONFIRMED"]);
    const sorted = normalizeAudienceQuery({ search: "sort=name&page=7&size=10&status=CANCELLED" });
    expect(sorted.search).toBe("status=CANCELLED");
    expect(audienceSearchQuery(sorted).status).toEqual(["CANCELLED"]);
  });

  it("rejects unknown keys, so a protected field can never be a filter", () => {
    for (const key of ["noteContains", "medicalFlag", "consentEvidence", "screeningStatus", "privateEventMembers", "allergies", "tagIds", "balanceStates"]) {
      expect(() => normalizeAudienceQuery({ [key]: ["x"] })).toThrow();
    }
  });

  it("refuses a draft audience and a malformed search with the one fixed answer", () => {
    for (const search of ["status=DRAFT", "status=CONFIRMED,DRAFT", "payment=MAYBE", "answer=nonsense", "checkIn=SOME", "tag=bad%20id"]) {
      expect(() => normalizeAudienceQuery({ search }), search).toThrow(AudienceFilterNotAvailableError);
    }
    // An unknown parameter is not a filter and changes nothing.
    expect(normalizeAudienceQuery({ search: "notAFilter=1" }).search).toBe("status=SUBMITTED%2CCONFIRMED");
  });

  it("an attendee's health or sensitive answer has no way into the search string", () => {
    // The search owns its filter keys: there is none for notes, consent, health or membership.
    for (const search of ["note=x", "health=x", "consent=x", "membership=x", "allergy=peanut"]) {
      expect(normalizeAudienceQuery({ search }).search).toBe("status=SUBMITTED%2CCONFIRMED");
    }
  });

  it("refuses a role whose domain the event lacks, and readiness without its permission, with one fixed message", () => {
    const group = normalizeAudienceQuery({ roles: ["GROUP_LEADER"] });
    expect(() => assertQueryAvailable(group, caps([]))).toThrow(AudienceFilterNotAvailableError);
    expect(() => assertQueryAvailable(group, caps([], ["REGISTRATION", "GROUPS"]))).not.toThrow();
    const readiness = normalizeAudienceQuery({ readinessStates: ["ATTENDEE_RESPONSES_INCOMPLETE"] });
    let failure: unknown;
    try {
      assertQueryAvailable(readiness, caps(["MANAGE_COMMUNICATIONS"]));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AudienceFilterNotAvailableError);
    expect((failure as Error).message).not.toMatch(/readiness|responses|incomplete/i);
    expect(() => assertQueryAvailable(readiness, caps(["MANAGE_REGISTRATION"]))).not.toThrow();
  });

  it("a search filter the viewer may not use is refused by the operations search, identically to one the event lacks", () => {
    const comms = viewer(["VIEW_EVENT", "MANAGE_COMMUNICATIONS"]);
    const refusals = ["tag=tag-vip", "payment=UNPAID", "checkIn=ANY", "organization=org-1", "q=pat", "answer=ATTENDEE:meal=vegan"].map((search) => {
      const query = audienceSearchQuery(normalizeAudienceQuery({ search }));
      return resolveOperationsSearch(query, comms, catalog);
    });
    for (const resolved of refusals) {
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.issues.map((issue) => issue.code)).toEqual(["unavailable"]);
    }
    const lifecycle = resolveOperationsSearch(audienceSearchQuery(normalizeAudienceQuery({ search: "attendeeType=YOUTH" })), comms, catalog);
    expect(lifecycle.ok).toBe(true);
  });

  it("offers only the filters the operations search offers this viewer, never DRAFT, and no value of a forbidden one", () => {
    const comms = viewer(["VIEW_EVENT", "MANAGE_COMMUNICATIONS"]);
    const limited = describeAvailableFilters(comms, catalog, caps(["VIEW_EVENT", "MANAGE_COMMUNICATIONS"]));
    expect(limited.search).toEqual(availableOperationsFilters(comms, catalog).map((filter) => (
      filter.key === "status" ? { ...filter, options: filter.options.filter((option) => option.value !== "DRAFT") } : filter
    )));
    expect(limited.search.map((filter) => filter.key)).not.toContain("tag");
    expect(JSON.stringify(limited)).not.toContain("VIP");
    expect(JSON.stringify(limited)).not.toContain("DRAFT");
    expect(limited.roles.map((role) => role.role)).toEqual(["REGISTRATION_CONTACT", "ATTENDEE"]);
    expect(limited.readiness).toEqual([]);
    const adminPermissions = ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION", "MANAGE_FINANCE", "MANAGE_CHECK_IN"] as const;
    const full = describeAvailableFilters(viewer(adminPermissions), catalog, caps([...adminPermissions], ["REGISTRATION", "GROUPS", "ORGANIZATIONS"]));
    expect(full.search.map((filter) => filter.key)).toContain("tag");
    expect(full.roles).toHaveLength(4);
    expect(full.readiness).toHaveLength(1);
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

  it("says which search rule qualified each recipient, in the viewer's own words", () => {
    const search = audienceSearchQuery(normalizeAudienceQuery({ search: "payment=UNPAID,PARTIAL&checkIn=NONE&tag=tag-vip&attendeeType=YOUTH" }));
    const reasons = buildSearchReasons(search, { ...catalog, tags: [{ id: "tag-vip", name: "VIP", isActive: true }] });
    expect(reasons.map((reason) => `${reason.dimension}:${reason.value}`)).toEqual(["payment:UNPAID,PARTIAL", "checkIn:NONE"]);
    const result = run(
      [row({ registrationId: "r1", tagIds: ["tag-vip"], attendees: [attendee("a1", { attendeeType: "YOUTH" })] })],
      { search: "payment=UNPAID,PARTIAL&checkIn=NONE&tag=tag-vip&attendeeType=YOUTH" },
      undefined,
      { searchReasons: reasons },
    );
    expect(result.recipients[0]!.reasons.map((reason) => `${reason.dimension}:${reason.value}`)).toEqual([
      "attendeeType:YOUTH", "checkIn:NONE", "payment:UNPAID,PARTIAL", "roles:REGISTRATION_CONTACT", "status:CONFIRMED", "tag:tag-vip",
    ]);
    expect(result.recipients[0]!.reasons.find((reason) => reason.dimension === "tag")!.label).toBe("Tag VIP");
  });

  it("with the attendee role, only attendees of the searched type, or tagged, are written to", () => {
    const rows = [row({
      registrationId: "r1",
      attendees: [attendee("adult", { attendeeType: "ADULT" }), attendee("youth", { attendeeType: "YOUTH" })],
    })];
    const youth = run(rows, { roles: ["ATTENDEE"], search: "attendeeType=YOUTH" });
    expect(youth.recipients.map((recipient) => recipient.email)).toEqual(["youth@example.test"]);
    const tagged = run([row({
      registrationId: "r2",
      attendees: [attendee("t1", { tagIds: ["tag-vip"] }), attendee("t2")],
    })], { roles: ["ATTENDEE"], search: "tag=tag-vip" });
    // The tag is on one attendee, so the registration matched; only that attendee qualifies.
    expect(tagged.recipients.map((recipient) => recipient.email)).toEqual(["t1@example.test"]);
    const registrationTag = run([row({ registrationId: "r3", tagIds: ["tag-vip"], attendees: [attendee("t3"), attendee("t4")] })], { roles: ["ATTENDEE"], search: "tag=tag-vip" });
    expect(registrationTag.counts.recipientCount).toBe(2);
  });

  it("readiness is only the normalized status, never what a response says", () => {
    const rows = [
      row({ registrationId: "r1", hasPublicSubmission: true, attendees: [attendee("a1", { hasResponses: false })] }),
      row({ registrationId: "r2", hasPublicSubmission: true, attendees: [attendee("a2", { hasResponses: true })] }),
    ];
    const result = run(rows, { readinessStates: ["ATTENDEE_RESPONSES_INCOMPLETE"] });
    expect(result.recipients.map((recipient) => recipient.registrations[0]!.registrationId)).toEqual(["r1"]);
    expect(result.recipients[0]!.reasons.map((reason) => reason.dimension)).toContain("readiness");
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

  it("a registration's balance is its own, and zero on an organization-billed event", () => {
    const query = normalizeAudienceQuery({});
    const billed = new AudienceAccumulator(query, { ...baseContext, isOrganizationBilled: true }, "evt");
    billed.consider(row({ registrationId: "r1", totalCents: 5000, netPaidCents: 0 }));
    expect(billed.finalize().counts.totalBalanceCents).toBe(0);
    expect(run([row({ registrationId: "r1", totalCents: 5000, netPaidCents: 0 })], {}).counts.totalBalanceCents).toBe(5000);
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
