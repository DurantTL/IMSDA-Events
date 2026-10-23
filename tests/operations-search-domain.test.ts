import { describe, expect, it } from "vitest";
import type { EventPermission } from "@/modules/access/permissions";
import {
  FILTER_KEYS,
  availableOperationsFilters,
  buildRegistrationWhere,
  describeSearchOrder,
  emptyOperationsSearchQuery,
  emptySearchCatalog,
  escapeLikePattern,
  parseOperationsSearchParams,
  pickSearchParams,
  registrationOrderBy,
  resolveOperationsSearch,
  serializeOperationsSearchQuery,
  type SearchCatalog,
  type SearchQuestion,
  type SearchViewer,
} from "@/modules/registrations/operations-search-domain";

const viewer = (...permissions: EventPermission[]): SearchViewer => ({ eventId: "event-a", permissions });
const admin = viewer("VIEW_EVENT", "MANAGE_REGISTRATION", "MANAGE_FINANCE", "MANAGE_CHECK_IN", "VIEW_SENSITIVE_DATA");

const meal: SearchQuestion = {
  versionIds: ["version-1", "version-2"],
  id: "ATTENDEE:meal",
  key: "meal",
  label: "Dinner choice",
  scope: "ATTENDEE",
  multi: false,
  choices: [{ value: "vegan", label: "Plant based" }, { value: "plain", label: "Plain" }],
  sensitive: false,
};

function catalog(overrides: Partial<SearchCatalog> = {}): SearchCatalog {
  return {
    waitlistEnabled: true,
    deferredBilling: false,
    attendeeTypes: [{ code: "ADULT", label: "Adult" }],
    locations: [],
    organizations: [{ id: "org-1", name: "Eagle Club" }],
    tags: [{ id: "tag-vip", name: "VIP", isActive: true }],
    questions: [meal],
    ...overrides,
  };
}

const parse = (qs: string) => parseOperationsSearchParams(new URLSearchParams(qs));

describe("query parsing and serialization", () => {
  it("reads an empty URL as the default query with no issues", () => {
    const { query, issues } = parse("");
    expect(issues).toEqual([]);
    expect(query).toEqual(emptyOperationsSearchQuery());
    expect(serializeOperationsSearchQuery(query)).toBe("");
  });

  it("serializes equal searches to one canonical string whatever the input order", () => {
    const a = parse("status=CONFIRMED,SUBMITTED&q=Jane%20%20Smith&tag=b,a&answer=ATTENDEE:meal=vegan&sort=name");
    const b = parse("sort=name&answer=ATTENDEE:meal=vegan&tag=a,b&status=SUBMITTED&status=CONFIRMED&q=Jane+Smith");
    expect(serializeOperationsSearchQuery(a.query)).toBe(serializeOperationsSearchQuery(b.query));
    expect(serializeOperationsSearchQuery(a.query)).toBe("q=Jane+Smith&status=SUBMITTED%2CCONFIRMED&tag=a%2Cb&answer=ATTENDEE%3Ameal%3Dvegan&sort=name");
  });

  it("round-trips through the URL, including a value with commas and equals signs", () => {
    const { query } = parse("answer=ATTENDEE:meal=Chicken, no sauce=ok&answer=REGISTRATION:transport=bus&sort=total.asc&page=3&size=25&checkIn=ALL&payment=PAID,REFUNDED");
    const again = parse(serializeOperationsSearchQuery(query));
    expect(again.issues).toEqual([]);
    expect(again.query).toEqual(query);
    expect(query.answers).toEqual([
      { question: "ATTENDEE:meal", values: ["Chicken, no sauce=ok"] },
      { question: "REGISTRATION:transport", values: ["bus"] },
    ]);
  });

  it("keeps the default direction implicit and an overridden one explicit", () => {
    expect(serializeOperationsSearchQuery(parse("sort=submitted.asc").query)).toBe("sort=submitted.asc");
    expect(serializeOperationsSearchQuery(parse("sort=submitted.desc").query)).toBe("");
    expect(serializeOperationsSearchQuery(parse("sort=name.asc").query)).toBe("sort=name");
    expect(parse("sort=name").query.direction).toBe("asc");
    expect(parse("sort=total").query.direction).toBe("desc");
  });

  it("reports malformed values and drops them instead of guessing", () => {
    const { query, issues } = parse("status=BOGUS&sort=password&page=0&size=1000&checkIn=SOME&answer=nope&tag=has%20space&payment=FREE");
    expect(issues.map((issue) => `${issue.filter}:${issue.code}`).sort()).toEqual([
      "answer:invalid-value", "checkIn:invalid-value", "page:invalid-value", "payment:invalid-value",
      "size:invalid-value", "sort:invalid-value", "status:invalid-value", "tag:invalid-value",
    ]);
    expect(query).toEqual(emptyOperationsSearchQuery());
  });

  it("bounds text length and word count", () => {
    expect(parse(`q=${"a".repeat(101)}`).issues).toHaveLength(1);
    expect(parse("q=a b c d e f g").issues).toHaveLength(1);
    expect(parse("q=a b c d e f").issues).toEqual([]);
  });

  it("only reads the parameters the search owns", () => {
    const picked = pickSearchParams({ event: "event-a", q: "x", notes: "ZEBRA", consent: "yes", health: "peanut", membership: "member", eventId: "event-b", status: ["CONFIRMED"] });
    expect([...picked.keys()].sort()).toEqual(["q", "status"]);
  });

  it("has no filter key for notes, consent, health data or event membership", () => {
    const keys = FILTER_KEYS.join(" ").toLowerCase();
    for (const word of ["note", "consent", "health", "medical", "member", "insur", "allerg"]) expect(keys).not.toContain(word);
  });
});

describe("what a viewer may search", () => {
  const everything = parse(
    `q=Jane&status=CONFIRMED&attendeeType=ADULT&source=CLUB&waitlist=WAITING&payment=PAID&checkIn=ANY&tag=tag-vip&answer=ATTENDEE:meal=vegan`,
  ).query;

  it("runs every filter for a viewer holding every domain", () => {
    expect(resolveOperationsSearch(everything, admin, catalog()).ok).toBe(true);
  });

  it("refuses a viewer without VIEW_EVENT whatever they ask", () => {
    const result = resolveOperationsSearch(emptyOperationsSearchQuery(), viewer(), catalog());
    expect(result.ok).toBe(false);
  });

  it.each([
    ["q", "q=Jane", viewer("VIEW_EVENT", "MANAGE_FINANCE")],
    ["organization", "organization=org-1", viewer("VIEW_EVENT", "MANAGE_REGISTRATION")],
    ["payment", "payment=PAID", viewer("VIEW_EVENT", "MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA")],
    ["checkIn", "checkIn=ANY", viewer("VIEW_EVENT", "VIEW_SENSITIVE_DATA")],
    ["tag", "tag=tag-vip", viewer("VIEW_EVENT", "MANAGE_CHECK_IN")],
    ["answer", "answer=ATTENDEE:meal=vegan", viewer("VIEW_EVENT", "MANAGE_REGISTRATION")],
  ])("refuses %s without its permission", (key, qs, who) => {
    const result = resolveOperationsSearch(parse(qs).query, who, catalog());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([expect.objectContaining({ filter: key, code: "unavailable" })]);
  });

  it("reports a forbidden filter exactly like one the event does not have", () => {
    const forbidden = resolveOperationsSearch(parse("payment=PAID").query, viewer("VIEW_EVENT", "MANAGE_REGISTRATION"), catalog());
    const missing = resolveOperationsSearch(parse("waitlist=WAITING").query, admin, catalog({ waitlistEnabled: false }));
    expect(forbidden.ok || missing.ok).toBe(false);
    if (!forbidden.ok && !missing.ok) {
      expect(forbidden.issues[0]?.code).toBe(missing.issues[0]?.code);
      expect(forbidden.issues[0]?.message).toBe(missing.issues[0]?.message);
    }
  });

  it("does not tell a restricted form question from a stale one", () => {
    // A sensitive question is never in the catalog, so it reads exactly as a removed one.
    const sensitive = resolveOperationsSearch(parse("answer=ATTENDEE:food_allergies=peanut").query, admin, catalog());
    const stale = resolveOperationsSearch(parse("answer=ATTENDEE:retired_field=x").query, admin, catalog());
    expect(sensitive).toEqual(stale);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.issues).toEqual([expect.objectContaining({ filter: "answer", code: "field-unavailable" })]);
  });

  it("matches an answer by key and stored value, not by label", () => {
    expect(resolveOperationsSearch(parse("answer=ATTENDEE:meal=vegan").query, admin, catalog()).ok).toBe(true);
    const byLabel = resolveOperationsSearch(parse("answer=ATTENDEE:meal=Plant based").query, admin, catalog());
    expect(byLabel.ok).toBe(false);
    if (!byLabel.ok) expect(byLabel.issues[0]).toMatchObject({ filter: "answer", code: "value-not-offered" });
  });

  it("reports ids and codes the event no longer has", () => {
    const result = resolveOperationsSearch(parse("tag=gone&attendeeType=GONE&location=nowhere").query, admin, catalog({ locations: [{ id: "loc-1", name: "North" }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.filter).sort()).toEqual(["attendeeType", "location", "tag"]);
  });

  it("describes the order the search ran in, and none for a search that did not run", () => {
    const order = (qs: string, who: SearchViewer = admin) => {
      const parsed = parse(qs);
      const resolved = resolveOperationsSearch(parsed.query, who, catalog());
      return describeSearchOrder({ ok: resolved.ok && parsed.issues.length === 0, query: parsed.query });
    };
    expect(order("q=smith")).toBe("Sorted by submitted date, newest first.");
    expect(order("sort=name")).toBe("Sorted by last name, A to Z.");
    expect(order("sort=name.desc")).toBe("Sorted by last name, Z to A.");
    expect(order("sort=submitted.asc")).toBe("Sorted by submitted date, oldest first.");
    expect(order("sort=total")).toBe("Sorted by total, highest first.");
    expect(order("sort=total.asc")).toBe("Sorted by total, lowest first.");
    expect(order("sort=code")).toBe("Sorted by confirmation code, A to Z.");
    expect(order("sort=created.asc")).toBe("Sorted by created date, oldest first.");
    // Denied or invalid: the search did not run, so no field is named.
    expect(order("sort=name", viewer("VIEW_EVENT", "MANAGE_FINANCE"))).toBeNull();
    expect(order("sort=total", viewer("VIEW_EVENT", "VIEW_SENSITIVE_DATA"))).toBeNull();
    expect(order("sort=password")).toBeNull();
    // A rejected service result names no field, whatever its query says.
    expect(describeSearchOrder({ ok: false, query: { sort: "name", direction: "asc" } })).toBeNull();
  });

  it("needs the identity domain to sort by name and the payment domain to sort by total", () => {
    const sortBy = (qs: string, who: SearchViewer) => resolveOperationsSearch(parse(qs).query, who, catalog());
    const noIdentity = sortBy("sort=name", viewer("VIEW_EVENT", "MANAGE_FINANCE"));
    expect(noIdentity.ok).toBe(false);
    if (!noIdentity.ok) expect(noIdentity.issues).toEqual([expect.objectContaining({ filter: "sort", code: "unavailable" })]);
    const noFinance = sortBy("sort=total", viewer("VIEW_EVENT", "VIEW_SENSITIVE_DATA"));
    expect(noFinance.ok).toBe(false);
    if (!noFinance.ok) expect(noFinance.issues).toEqual([expect.objectContaining({ filter: "sort", code: "unavailable" })]);
    expect(sortBy("sort=name", viewer("VIEW_EVENT", "VIEW_SENSITIVE_DATA")).ok).toBe(true);
    expect(sortBy("sort=total", viewer("VIEW_EVENT", "MANAGE_FINANCE")).ok).toBe(true);
    expect(sortBy("sort=code", viewer("VIEW_EVENT")).ok).toBe(true);
    // The same refusal as a forbidden filter.
    const forbiddenFilter = sortBy("payment=PAID", viewer("VIEW_EVENT"));
    if (!noFinance.ok && !forbiddenFilter.ok) expect(noFinance.issues[0].message).toBe(forbiddenFilter.issues[0].message);
  });

  it("offers an organization filter only with identity access, and validates the id", () => {
    expect(availableOperationsFilters(admin, catalog()).map((filter) => filter.key)).toContain("organization");
    expect(availableOperationsFilters(viewer("VIEW_EVENT"), catalog()).map((filter) => filter.key)).not.toContain("organization");
    expect(resolveOperationsSearch(parse("organization=org-1").query, admin, catalog()).ok).toBe(true);
    const stale = resolveOperationsSearch(parse("organization=org-gone").query, admin, catalog());
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.issues).toEqual([expect.objectContaining({ filter: "organization", code: "stale-reference" })]);
    const hidden = resolveOperationsSearch(parse("organization=org-1").query, viewer("VIEW_EVENT", "MANAGE_REGISTRATION"), catalog());
    expect(hidden.ok).toBe(false);
  });

  it("offers no balance states on a church-billed event", () => {
    const filters = availableOperationsFilters(admin, catalog({ deferredBilling: true }));
    expect(filters.find((filter) => filter.key === "payment")).toMatchObject({ options: [{ value: "REFUNDED" }] });
    const result = resolveOperationsSearch(parse("payment=PAID").query, admin, catalog({ deferredBilling: true }));
    expect(result.ok).toBe(false);
  });

  it("offers only the domains that exist and that the viewer holds", () => {
    const keys = (who: SearchViewer, c: SearchCatalog) => availableOperationsFilters(who, c).map((filter) => filter.key);
    expect(keys(admin, catalog())).toEqual(["q", "status", "attendeeType", "organization", "source", "waitlist", "payment", "checkIn", "tag", "answer"]);
    expect(keys(viewer("VIEW_EVENT"), catalog())).toEqual(["status", "attendeeType", "source", "waitlist"]);
    expect(keys(admin, emptySearchCatalog())).toEqual(["q", "status", "source", "payment", "checkIn"]);
    expect(keys(viewer(), catalog())).toEqual([]);
  });
});

describe("the predicate and the order", () => {
  it("scopes every query to the event before anything else", () => {
    const where = buildRegistrationWhere(parse("q=Jane&status=CONFIRMED").query, { eventId: "event-a", questions: [], paymentRegistrationIds: null });
    expect(where.eventId).toBe("event-a");
    expect(buildRegistrationWhere(emptyOperationsSearchQuery(), { eventId: "event-a", questions: [], paymentRegistrationIds: null })).toEqual({ eventId: "event-a" });
  });

  it("never reads notes, consent, health data or membership", () => {
    const query = parse("q=ZEBRA&status=CONFIRMED&attendeeType=ADULT&source=STAFF&waitlist=WAITING&checkIn=ALL&tag=t&organization=o&location=l&answer=ATTENDEE:meal=vegan").query;
    const where = JSON.stringify(buildRegistrationWhere(query, { eventId: "event-a", questions: [meal], paymentRegistrationIds: ["r1"] }));
    for (const forbidden of ["notes", "StaffNote", "revisions", "body", "consent", "health", "Health", "membership", "memberships", "restricted"]) {
      expect(where).not.toContain(forbidden);
    }
  });

  it("requires every word to match one person", () => {
    const where = buildRegistrationWhere(parse("q=Jane+Smith").query, { eventId: "event-a", questions: [], paymentRegistrationIds: null });
    const text = JSON.stringify(where);
    // One attendee clause carries both words, so the words cannot be split across two people.
    expect(text.match(/"attendees":\{"some":\{"AND":\[/g)).toHaveLength(1);
    expect(text.match(/Jane/g)!.length).toBeGreaterThan(0);
    expect(text.match(/Smith/g)!.length).toBeGreaterThan(0);
  });

  it("reads an answer only on registrations submitted through a version that offers the question as a choice", () => {
    const where = JSON.stringify(buildRegistrationWhere(parse("answer=ATTENDEE:meal=vegan&answer=REGISTRATION:transport=bus").query, {
      eventId: "event-a",
      questions: [{ ...meal, versionIds: ["version-2"] }, { ...meal, id: "REGISTRATION:transport", key: "transport", scope: "REGISTRATION", versionIds: ["version-1"] }],
      paymentRegistrationIds: null,
      answerRegistrationIds: new Map([["REGISTRATION:transport", ["r-amended"]]]),
    }));
    expect(where).toContain('"formVersionId":{"in":["version-2"]}');
    // A registration-wide answer is the id list SQL resolved from the latest amendment, else the submission.
    expect(where).toContain('"id":{"in":["r-amended"]}');
    expect(where).not.toContain('"responses"');
  });

  it("adds the registrations whose attendee answers live only on the submission", () => {
    const where = buildRegistrationWhere(parse("answer=ATTENDEE:meal=vegan").query, {
      eventId: "event-a", questions: [meal], paymentRegistrationIds: null, answerRegistrationIds: new Map([["ATTENDEE:meal", ["r-old"]]]),
    });
    expect(JSON.stringify(where)).toContain('"id":{"in":["r-old"]}');
  });

  it("fails closed for an answer whose question is unknown", () => {
    const where = buildRegistrationWhere(parse("answer=ATTENDEE:meal=vegan").query, { eventId: "event-a", questions: [], paymentRegistrationIds: null });
    expect(where.AND).toEqual([{ id: { in: [] } }]);
  });

  it("escapes pattern characters in typed text", () => {
    expect(escapeLikePattern("50%_off\\")).toBe("50\\%\\_off\\\\");
    const where = JSON.stringify(buildRegistrationWhere(parse("q=%25").query, { eventId: "event-a", questions: [], paymentRegistrationIds: null }));
    expect(where).toContain('"contains":"\\\\%"');
  });

  it("always ends the order with the id, in the sort direction, so ties never page unstably", () => {
    for (const sort of ["submitted", "created", "code", "name", "total"] as const) {
      for (const direction of ["asc", "desc"] as const) {
        const order = registrationOrderBy({ sort, direction });
        expect(order.at(-1)).toEqual({ id: direction });
        expect(order.at(-2)).toEqual({ createdAt: direction });
      }
    }
    expect(registrationOrderBy({ sort: "submitted", direction: "desc" })[0]).toEqual({ submittedAt: { sort: "desc", nulls: "last" } });
  });
});
