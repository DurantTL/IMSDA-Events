import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { campMeetingMeals } from "./support/camp-meeting-seeds";
import { mealDefinitionsFromTemplate, mealPriceCount, shiftMealDefinitions, templateMealsSchema } from "@/modules/meals/clone-domain";
import {
  applyMealPricesToDefinition,
  cancellationEntries,
  diffFormTickets,
  mealOrderInputSchema,
  mealPlanInputSchema,
  mealPriceDrift,
  mealPriceInputSchema,
  mealServiceInputSchema,
  mealTicketBinding,
  mealTicketCsvHeader,
  mealTicketCsvRow,
  mealTicketId,
  scannerMealDay,
  scannerPrice,
  scannerTicketCsvHeader,
  scannerTicketCsvRows,
  type ScannerTicket,
  mealTicketFields,
  mealTypeCoverage,
  quantityChangeEntries,
  resolveMealPrice,
  serviceCoverage,
  ticketQuantitiesFromAnswers,
  type PlanShape,
  type PriceRow,
  type ServiceShape,
} from "@/modules/meals/domain";
import { getFormTemplate } from "@/modules/forms/definition";
import { toCsv } from "@/modules/reporting/csv";

vi.mock("server-only", () => ({}));

const ticketPlan: PlanShape = { id: "plan-tickets", payer: "ATTENDEE", includesAllServices: true, defaultEntitlement: "PAID", isActive: true };
const conferencePlan: PlanShape = { id: "plan-conf", payer: "CONFERENCE", includesAllServices: true, defaultEntitlement: "INCLUDED", isActive: true };
const prices: PriceRow[] = [
  { id: "p1", mealType: "BREAKFAST", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 700 },
  { id: "p2", mealType: "BREAKFAST", ageGroup: "CHILD", attendeeTypeId: null, amountCents: 600 },
  { id: "p3", mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 800 },
  { id: "p4", mealType: "LUNCH", ageGroup: "CHILD", attendeeTypeId: null, amountCents: 700 },
  { id: "p5", mealType: "SUPPER", ageGroup: null, attendeeTypeId: "type-staff", amountCents: 0 },
  { id: "p6", mealType: "SUPPER", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 800 },
];

describe("meal pricing (#210)", () => {
  it("prices adult and child meals separately", () => {
    const adult = resolveMealPrice({ plan: ticketPlan, coverage: "PAID", prices, mealType: "BREAKFAST", ageGroup: "ADULT", attendeeTypeId: null });
    const child = resolveMealPrice({ plan: ticketPlan, coverage: "PAID", prices, mealType: "BREAKFAST", ageGroup: "CHILD", attendeeTypeId: null });
    expect(adult).toMatchObject({ unitPriceCents: 700, rule: "AGE_GROUP", priceRowId: "p1" });
    expect(child).toMatchObject({ unitPriceCents: 600, rule: "AGE_GROUP", priceRowId: "p2" });
  });

  it("lets an attendee type's price win, and $0 makes that role complimentary", () => {
    const staff = resolveMealPrice({ plan: ticketPlan, coverage: "PAID", prices, mealType: "SUPPER", ageGroup: "ADULT", attendeeTypeId: "type-staff" });
    const guest = resolveMealPrice({ plan: ticketPlan, coverage: "PAID", prices, mealType: "SUPPER", ageGroup: "ADULT", attendeeTypeId: "type-guest" });
    expect(staff).toMatchObject({ unitPriceCents: 0, rule: "ATTENDEE_TYPE" });
    expect(guest).toMatchObject({ unitPriceCents: 800, rule: "AGE_GROUP" });
  });

  it("charges nothing for an included meal and never guesses a missing price", () => {
    expect(resolveMealPrice({ plan: ticketPlan, coverage: "INCLUDED", prices, mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null })).toMatchObject({ unitPriceCents: 0, rule: "INCLUDED" });
    expect(resolveMealPrice({ plan: ticketPlan, coverage: "PAID", prices, mealType: "SUPPER", ageGroup: "CHILD", attendeeTypeId: null })).toBeNull();
  });

  it("never charges the attendee under a conference-paid plan and keeps the rate the conference is billed", () => {
    const resolved = resolveMealPrice({ plan: conferencePlan, coverage: "INCLUDED", prices, mealType: "BREAKFAST", ageGroup: "ADULT", attendeeTypeId: null });
    expect(resolved).toMatchObject({ unitPriceCents: 0, conferenceRateCents: 700, rule: "CONFERENCE_PAID" });
    expect(resolveMealPrice({ plan: conferencePlan, coverage: "INCLUDED", prices: [], mealType: "BREAKFAST", ageGroup: "ADULT", attendeeTypeId: null })).toMatchObject({ unitPriceCents: 0, conferenceRateCents: 0 });
  });
});

describe("plan coverage", () => {
  const active: ServiceShape = { id: "s1", mealType: "LUNCH", ticketing: "TICKETED", status: "ACTIVE" };
  const cancelled: ServiceShape = { id: "s2", mealType: "LUNCH", ticketing: "TICKETED", status: "CANCELLED" };
  const donation: ServiceShape = { id: "s3", mealType: "LUNCH", ticketing: "DONATION_ONLY", status: "ACTIVE" };

  it("covers an active ticketed service, and never a cancelled or donation-only one", () => {
    expect(serviceCoverage(ticketPlan, [], active)).toBe("PAID");
    expect(serviceCoverage(ticketPlan, [], cancelled)).toBeNull();
    expect(serviceCoverage(ticketPlan, [], donation)).toBeNull();
    expect(serviceCoverage({ ...ticketPlan, isActive: false }, [], active)).toBeNull();
  });

  it("lets a plan-service row override the default, and forces a conference plan to include", () => {
    const listed = { ...ticketPlan, includesAllServices: false };
    expect(serviceCoverage(listed, [], active)).toBeNull();
    expect(serviceCoverage(listed, [{ serviceId: "s1", entitlement: "INCLUDED" }], active)).toBe("INCLUDED");
    expect(serviceCoverage(conferencePlan, [{ serviceId: "s1", entitlement: "PAID" }], active)).toBe("INCLUDED");
  });

  it("covers a meal type when any active ticketed service of the type is covered", () => {
    expect(mealTypeCoverage(ticketPlan, [], [cancelled, donation], "LUNCH")).toBeNull();
    expect(mealTypeCoverage(ticketPlan, [], [cancelled, active], "LUNCH")).toBe("PAID");
    expect(mealTypeCoverage(ticketPlan, [], [active], "SUPPER")).toBeNull();
  });
});

describe("meal ledger entries", () => {
  it("credits at the price charged and charges extra meals at the selection's own price", () => {
    const before = { quantity: 3, unitPriceCents: 700, payer: "ATTENDEE" as const };
    expect(quantityChangeEntries(before, 1)).toEqual([{ kind: "CREDIT", quantity: 2, unitPriceCents: 700, amountCents: -1400 }]);
    expect(quantityChangeEntries(before, 4)).toEqual([{ kind: "CHARGE", quantity: 1, unitPriceCents: 700, amountCents: 700 }]);
    expect(quantityChangeEntries(before, 3)).toEqual([]);
    expect(cancellationEntries(before)).toEqual([{ kind: "CREDIT", quantity: 3, unitPriceCents: 700, amountCents: -2100 }]);
  });

  it("writes nothing for a complimentary or conference-paid selection", () => {
    expect(cancellationEntries({ quantity: 2, unitPriceCents: 0, payer: "ATTENDEE" })).toEqual([]);
    expect(quantityChangeEntries({ quantity: 1, unitPriceCents: 0, payer: "CONFERENCE" }, 5)).toEqual([]);
    expect(cancellationEntries({ quantity: 1, unitPriceCents: 0, payer: "CONFERENCE" })).toEqual([]);
  });
});

describe("staff configuration input", () => {
  const service = { name: "Wednesday breakfast", mealType: "BREAKFAST", serviceDate: "2026-10-14", startTime: "07:30", endTime: "08:30" };

  it("validates a service's date, serving window and capacity", () => {
    expect(mealServiceInputSchema.safeParse(service).success).toBe(true);
    expect(mealServiceInputSchema.safeParse({ ...service, serviceDate: "2026-02-30" }).success).toBe(false);
    expect(mealServiceInputSchema.safeParse({ ...service, endTime: "07:00" }).success).toBe(false);
    expect(mealServiceInputSchema.safeParse({ ...service, capacity: 0 }).success).toBe(false);
    expect(mealServiceInputSchema.safeParse({ ...service, extra: 1 }).success).toBe(false);
  });

  it("keeps a conference plan included and the ticket plan attendee-paid", () => {
    expect(mealPlanInputSchema.safeParse({ code: "conference-paid", name: "Conference", payer: "CONFERENCE", defaultEntitlement: "PAID" }).success).toBe(false);
    expect(mealPlanInputSchema.safeParse({ code: "conference-paid", name: "Conference", payer: "CONFERENCE", defaultEntitlement: "INCLUDED" }).success).toBe(true);
    expect(mealPlanInputSchema.safeParse({ code: "x", name: "X", payer: "CONFERENCE", defaultEntitlement: "INCLUDED", isDefaultTicketPlan: true }).success).toBe(false);
  });

  it("prices an age group or an attendee type, never both and never negative", () => {
    expect(mealPriceInputSchema.safeParse({ mealType: "LUNCH", ageGroup: "ADULT", amountCents: 800 }).success).toBe(true);
    expect(mealPriceInputSchema.safeParse({ mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: "t", amountCents: 800 }).success).toBe(false);
    expect(mealPriceInputSchema.safeParse({ mealType: "LUNCH", amountCents: 800 }).success).toBe(false);
    expect(mealPriceInputSchema.safeParse({ mealType: "LUNCH", ageGroup: "CHILD", amountCents: -1 }).success).toBe(false);
  });

  it("allows only configured non-medical dietary categories on an order", () => {
    const order = { mealType: "LUNCH", serviceId: "s1", ageGroup: "ADULT", quantity: 1, clientRequestId: "request-0001" };
    expect(mealOrderInputSchema.safeParse({ ...order, dietaryCategories: ["VEGAN", "GLUTEN_FREE"] }).success).toBe(true);
    expect(mealOrderInputSchema.safeParse({ ...order, dietaryCategories: ["peanut allergy, carries an EpiPen"] }).success).toBe(false);
    expect(mealOrderInputSchema.safeParse({ ...order, allergies: "none" }).success).toBe(false);
  });

  it("makes a walk-up order a single service with no attendee", () => {
    const walkUp = { registrationId: null, mealType: "LUNCH", ageGroup: "ADULT", quantity: 2, clientRequestId: "request-0002" };
    expect(mealOrderInputSchema.safeParse({ ...walkUp, serviceId: null }).success).toBe(false);
    expect(mealOrderInputSchema.safeParse({ ...walkUp, serviceId: "s1" }).success).toBe(true);
    expect(mealOrderInputSchema.safeParse({ ...walkUp, serviceId: "s1", registrationAttendeeId: "a1" }).success).toBe(false);
  });
});

describe("registration form tickets", () => {
  const form = getFormTemplate("camp_meeting_export")!;

  it("binds the six Camp Meeting ticket fields by their long-standing keys", () => {
    expect(mealTicketFields(form.definition).map((field) => field.key)).toEqual([
      "breakfast_adult_qty", "breakfast_child_qty", "lunch_adult_qty", "lunch_child_qty", "supper_adult_qty", "supper_child_qty",
    ]);
    expect(mealTicketBinding("lunch_child_qty")).toEqual({ mealType: "LUNCH", ageGroup: "CHILD" });
    expect(mealTicketBinding("dietary_restrictions")).toBeNull();
  });

  it("agrees with the template's own prices, so existing totals do not move", () => {
    const planPrices = new Map(campMeetingMeals.plans[0]!.prices.map((price) => [`${price.mealType}:${price.ageGroup}`, price.amountCents]));
    expect(mealPriceDrift(form.definition, planPrices)).toEqual([]);
    expect(applyMealPricesToDefinition(form.definition, planPrices)).toEqual(form.definition);
  });

  it("takes a changed plan price into the field and its label, and reports a stale draft", () => {
    const changed = new Map([["BREAKFAST:ADULT", 750]]);
    expect(mealPriceDrift(form.definition, changed)).toEqual(["breakfast_adult_qty"]);
    const priced = applyMealPricesToDefinition(form.definition, changed);
    const field = priced.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "breakfast_adult_qty")!;
    expect(field.priceCents).toBe(750);
    expect(field.label).toBe("Adult breakfast tickets — $7.50 each");
    expect(mealPriceDrift(priced, changed)).toEqual([]);
  });

  it("leaves a form alone when the event has no ticket plan", () => {
    expect(applyMealPricesToDefinition(form.definition, new Map())).toEqual(form.definition);
  });

  it("reads quantities from the answers and ignores blanks and nonsense", () => {
    expect(ticketQuantitiesFromAnswers({ breakfast_adult_qty: "2", lunch_child_qty: 1.9, supper_adult_qty: -3, supper_child_qty: "x" })).toEqual([
      { mealType: "BREAKFAST", ageGroup: "ADULT", quantity: 2, fieldKey: "breakfast_adult_qty" },
      { mealType: "LUNCH", ageGroup: "CHILD", quantity: 1, fieldKey: "lunch_child_qty" },
    ]);
  });

  it("diffs tickets against the answers: create, change, cancel", () => {
    const desired = ticketQuantitiesFromAnswers({ breakfast_adult_qty: 3, lunch_adult_qty: 1 });
    const existing = [
      { id: "sel-b", mealType: "BREAKFAST" as const, ageGroup: "ADULT" as const, quantity: 2 },
      { id: "sel-s", mealType: "SUPPER" as const, ageGroup: "ADULT" as const, quantity: 1 },
    ];
    expect(diffFormTickets(desired, existing)).toEqual([
      { action: "SET_QUANTITY", selectionId: "sel-b", quantity: 3 },
      { action: "CREATE", mealType: "LUNCH", ageGroup: "ADULT", quantity: 1, fieldKey: "lunch_adult_qty" },
      { action: "CANCEL", selectionId: "sel-s" },
    ]);
    expect(diffFormTickets(desired, [{ id: "x", mealType: "BREAKFAST", ageGroup: "ADULT", quantity: 3 }, { id: "y", mealType: "LUNCH", ageGroup: "ADULT", quantity: 1 }])).toEqual([]);
  });
});

describe("Camp Meeting 2026 meal definitions", () => {
  const definitions = mealDefinitionsFromTemplate(campMeetingMeals, "2026-10-13");

  it("parses as a template payload", () => {
    expect(templateMealsSchema.safeParse(campMeetingMeals).success).toBe(true);
  });

  it("matches the 2026 schedule: breakfast Wed-Sat, lunch Wed-Fri, Saturday lunch donation-only, supper Tue-Sat", () => {
    const days = (mealType: string, ticketing: string) => definitions.services.filter((service) => service.mealType === mealType && service.ticketing === ticketing).map((service) => service.serviceDate);
    expect(days("BREAKFAST", "TICKETED")).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(days("LUNCH", "TICKETED")).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(days("LUNCH", "DONATION_ONLY")).toEqual(["2026-10-17"]);
    expect(days("SUPPER", "TICKETED")).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
  });

  it("carries the 2026 prices: $7/$6 breakfast, $8/$7 lunch, $8/$7 supper", () => {
    const tickets = definitions.plans.find((plan) => plan.isDefaultTicketPlan)!;
    const price = (mealType: string, ageGroup: string) => tickets.prices.find((row) => row.mealType === mealType && row.ageGroup === ageGroup)!.amountCents;
    expect([price("BREAKFAST", "ADULT"), price("BREAKFAST", "CHILD"), price("LUNCH", "ADULT"), price("LUNCH", "CHILD"), price("SUPPER", "ADULT"), price("SUPPER", "CHILD")]).toEqual([700, 600, 800, 700, 800, 700]);
  });

  it("has a conference-paid plan that includes every meal and never charges the attendee", () => {
    const conference = definitions.plans.find((plan) => plan.payer === "CONFERENCE")!;
    expect(conference).toMatchObject({ defaultEntitlement: "INCLUDED", includesAllServices: true, isDefaultTicketPlan: false });
  });

  it("matches the prices the existing Camp Meeting form template charges", () => {
    const form = getFormTemplate("camp_meeting_export")!;
    const tickets = definitions.plans.find((plan) => plan.isDefaultTicketPlan)!;
    for (const field of mealTicketFields(form.definition)) {
      const binding = mealTicketBinding(field.key)!;
      expect(field.priceCents, field.key).toBe(tickets.prices.find((row) => row.mealType === binding.mealType && row.ageGroup === binding.ageGroup)!.amountCents);
    }
  });
});

describe("clone and template safety", () => {
  it("moves every service date by the same number of days and keeps prices", () => {
    const definitions = mealDefinitionsFromTemplate(campMeetingMeals, "2026-10-13");
    const shifted = shiftMealDefinitions(definitions, 365);
    expect(shifted.services[0]!.serviceDate).toBe("2027-10-14");
    expect(shifted.plans[0]!.prices).toEqual(definitions.plans[0]!.prices);
    expect(mealPriceCount(shifted)).toBe(12);
    expect(Object.keys(shifted)).toEqual(["services", "plans"]);
  });

  it("rejects a template that lists a service it does not have, or repeats one", () => {
    const base = { services: [{ name: "Lunch", mealType: "LUNCH", dayOffset: 1, startTime: "12:00" }], plans: [] };
    expect(templateMealsSchema.safeParse(base).success).toBe(true);
    expect(templateMealsSchema.safeParse({ ...base, services: [...base.services, ...base.services] }).success).toBe(false);
    expect(templateMealsSchema.safeParse({ ...base, plans: [{ code: "p", name: "P", services: [{ serviceName: "Dinner", dayOffset: 1, entitlement: "PAID" }] }] }).success).toBe(false);
  });

  it("reads only definition tables when a clone loads meals (never a selection, order, ledger entry or history)", async () => {
    const touched: string[] = [];
    const table = (name: string) => ({ findMany: vi.fn(async () => { touched.push(name); return []; }) });
    const db = new Proxy({} as Record<string, unknown>, {
      get: (_target, property: string) => {
        if (/^eventMeal(Service|Plan)$/.test(property)) return table(property);
        throw new Error(`a clone read ${property}`);
      },
    });
    const { loadMealDefinitions } = await import("@/modules/meals/clone-repository");
    await loadMealDefinitions(db as never, "event-1");
    expect(touched.sort()).toEqual(["eventMealPlan", "eventMealService"]);
  });
});

describe("meal ticket CSV", () => {
  it("has the café columns and defuses spreadsheet formulas", () => {
    const row = mealTicketCsvRow({
      confirmationCode: "CM-1234", attendeeName: "=HYPERLINK(\"x\")", attendeeType: "Staff", ageGroup: "ADULT", mealType: "SUPPER", serviceDate: "2026-10-13",
      serviceName: "Tuesday supper", quantity: 1, payer: "CONFERENCE", source: "PLAN_ASSIGNMENT", selectionId: "sel-1",
    });
    expect(mealTicketCsvHeader).toEqual(["Confirmation code", "Attendee", "Attendee type", "Age group", "Meal", "Service date", "Service", "Quantity", "Payer", "Source", "Ticket id"]);
    expect(row).toEqual(["CM-1234", "=HYPERLINK(\"x\")", "Staff", "Adult", "Supper", "2026-10-13", "Tuesday supper", "1", "Conference", "PLAN_ASSIGNMENT", "sel-1"]);
    expect(toCsv([[...mealTicketCsvHeader], row])).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe("café scanner CSV (#916)", () => {
  const ticket = (over: Partial<ScannerTicket> = {}): ScannerTicket => ({
    number: 1234, confirmationCode: "CM99-0001", guestName: "Test Guest", mealType: "LUNCH", serviceDate: "2099-06-17", ageGroup: "ADULT", unitPriceCents: 800, payer: "ATTENDEE", ...over,
  });

  it("has exactly the scanner's columns, in order", () => {
    expect(scannerTicketCsvHeader.join(",")).toBe("ticket_id,reg_id,guest_name,meal_type,meal_day,meal_date,ticket_type,price,redeemed,redeemed_at,redeemed_by,notes");
  });

  it("writes one scanner row per ticket with MT- ids, lowercase meal, day, date, type and price", () => {
    const [row] = scannerTicketCsvRows([ticket()]);
    expect(row).toEqual(["MT-01234", "CM99-0001", "Test Guest", "lunch", "wed", "2099-06-17", "adult", "8", "no", "", "", ""]);
    expect(row).toHaveLength(scannerTicketCsvHeader.length);
    expect(mealTicketId(7)).toBe("MT-00007");
    expect(mealTicketId(123456)).toBe("MT-123456");
    expect(mealTicketId(99999)).toBe("MT-99999");
  });

  it("prices: whole dollars, decimals when cents remain, zero when the conference pays", () => {
    expect(scannerPrice(700, "ATTENDEE")).toBe("7");
    expect(scannerPrice(750, "ATTENDEE")).toBe("7.50");
    expect(scannerPrice(0, "ATTENDEE")).toBe("0");
    expect(scannerPrice(800, "CONFERENCE")).toBe("0");
    expect(scannerTicketCsvRows([ticket({ ageGroup: "CHILD", unitPriceCents: 600 })])[0]!.slice(6, 8)).toEqual(["child", "6"]);
  });

  it("takes the day and date from the event-local calendar date, not an instant", () => {
    expect(scannerMealDay("2099-06-16")).toBe("tue");
    expect(scannerMealDay("2099-06-20")).toBe("sat");
    expect(scannerMealDay("")).toBe("");
    // A late supper is the next day in UTC; the stored service date (event time) still decides the day.
    expect(scannerTicketCsvRows([ticket({ mealType: "SUPPER", serviceDate: "2099-06-16" })])[0]!.slice(4, 6)).toEqual(["tue", "2099-06-16"]);
    expect(scannerTicketCsvRows([ticket({ serviceDate: "" })])[0]!.slice(4, 6)).toEqual(["", ""]);
  });

  it("sorts by meal date, meal, registration, then guest (undated tickets last)", () => {
    const rows = scannerTicketCsvRows([
      ticket({ number: 1, serviceDate: "", mealType: "BREAKFAST" }),
      ticket({ number: 2, serviceDate: "2099-06-17", mealType: "SUPPER" }),
      ticket({ number: 3, serviceDate: "2099-06-17", mealType: "BREAKFAST", confirmationCode: "CM99-0002", guestName: "B Guest" }),
      ticket({ number: 4, serviceDate: "2099-06-17", mealType: "BREAKFAST", confirmationCode: "CM99-0002", guestName: "A Guest" }),
      ticket({ number: 5, serviceDate: "2099-06-16", mealType: "SUPPER" }),
    ]);
    expect(rows.map((row) => row[0])).toEqual(["MT-00005", "MT-00004", "MT-00003", "MT-00002", "MT-00001"]);
  });

  const scannerCsv = (tickets: ScannerTicket[]) => toCsv([[...scannerTicketCsvHeader], ...scannerTicketCsvRows(tickets)], { minimalQuoting: true });

  it("writes an unquoted header and rows, CRLF lines, no byte-order mark", () => {
    const csv = scannerCsv([ticket()]);
    expect(csv.startsWith("ticket_id,reg_id,guest_name,meal_type,meal_day,meal_date,ticket_type,price,redeemed,redeemed_at,redeemed_by,notes\r\n")).toBe(true);
    expect(csv).toBe("ticket_id,reg_id,guest_name,meal_type,meal_day,meal_date,ticket_type,price,redeemed,redeemed_at,redeemed_by,notes\r\nMT-01234,CM99-0001,Test Guest,lunch,wed,2099-06-17,adult,8,no,,,\r\n");
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("quotes a name with a comma, and is byte-identical when written twice", () => {
    const tickets = [ticket({ guestName: "Guest, Test" })];
    expect(scannerCsv(tickets)).toContain(',"Guest, Test",');
    expect(scannerCsv(tickets)).toBe(scannerCsv(tickets));
  });

  it("defuses spreadsheet formulas in the guest name", () => {
    const csv = scannerCsv([ticket({ guestName: "=HYPERLINK(\"x\")" })]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(scannerCsv([ticket({ guestName: "+1" })])).toContain(",'+1,");
  });

  it("defuses leading -, @, tab and CR with minimal quoting", () => {
    expect(scannerCsv([ticket({ guestName: "-5 Test" })])).toContain(",'-5 Test,");
    expect(scannerCsv([ticket({ guestName: "@home" })])).toContain(",'@home,");
    expect(scannerCsv([ticket({ guestName: "\tTab" })])).toContain(",'\tTab,");
    // A leading CR is prefixed, and the CR then forces quoting.
    expect(scannerCsv([ticket({ guestName: "\rCarriage" })])).toContain(`,"'\rCarriage",`);
  });

  it("leaves the default writer quoting every cell", () => {
    expect(toCsv([["a", "b"]])).toBe('"a","b"\r\n');
  });
});

describe("meal ticket number migration (#916)", () => {
  const sql = readFileSync("prisma/migrations/20261021110000_meal_ticket_numbers/migration.sql", "utf8");

  it("is additive, unique per event, and backfills deterministically", () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
    expect(sql).toContain(`CREATE UNIQUE INDEX "EventMealTicket_eventId_number_key" ON "EventMealTicket"("eventId", "number")`);
    expect(sql).toContain(`ORDER BY s."createdAt", s."id", u.unit`);
  });

  it("numbers from a sequence started past the backfill, with no event-wide counter", () => {
    expect(sql).toContain(`CREATE SEQUENCE "EventMealTicket_number_seq"`);
    expect(sql).toContain(`setval('"EventMealTicket_number_seq"'`);
    expect(sql).not.toContain("mealTicketSeq");
  });
});

describe("meal migration", () => {
  const sql = readFileSync("prisma/migrations/20261018110000_meal_services_plans_selections/migration.sql", "utf8");

  it("is additive: no drop, no rewrite of existing data", () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
    expect(sql).not.toMatch(/^(UPDATE|DELETE\s+FROM|TRUNCATE)\b/m);
    expect(sql).toContain(`ALTER TYPE "RegistrationAdjustmentKind" ADD VALUE 'MEAL'`);
  });

  it("makes the ledger and the histories append-only and refuses cross-event rows", () => {
    for (const name of ["EventMealLedgerEntry", "EventMealSelectionChange", "EventMealServiceChange"]) {
      expect(sql).toContain(`CREATE TRIGGER "${name}_append_only" BEFORE UPDATE OR DELETE ON "${name}"`);
    }
    expect(sql).toContain(`CREATE TRIGGER "EventMealSelection_no_delete" BEFORE DELETE`);
    expect(sql).toContain(`current_setting('imsda.event_deletion', true) = 'on'`);
    expect(sql).toContain(`CREATE TRIGGER "EventMealSelection_same_event"`);
  });

  it("stores no protected medical detail: dietary categories are a list of configured codes", () => {
    expect(sql).not.toMatch(/allerg|medical|accommodat/i);
  });
});

describe("event template payload (#210)", () => {
  it("carries meal definitions as day offsets, and no starter template ships prices on its own", async () => {
    const { eventTemplatePayloadSchema } = await import("@/modules/event-templates/domain");
    const { starterEventTemplates, starterPayload } = await import("@/modules/event-templates/starters");
    expect(eventTemplatePayloadSchema.safeParse({ audience: "GENERAL", meals: campMeetingMeals }).success).toBe(true);
    expect(eventTemplatePayloadSchema.safeParse({ audience: "GENERAL", meals: { services: [{ name: "Lunch", mealType: "LUNCH", dayOffset: 1, startTime: "25:00" }], plans: [] } }).success).toBe(false);
    // Pricing is a human decision: a person adds the Camp Meeting meals on the Meals screen, never a starter.
    expect(starterEventTemplates.every((starter) => starterPayload(starter).meals === undefined)).toBe(true);
  });
});
