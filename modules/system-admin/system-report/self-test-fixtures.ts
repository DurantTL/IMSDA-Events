/**
 * The fixed examples behind the System report's "Built-in self-tests" (#1381). Plain data only: every input is written
 * out here, every expected answer is written down by hand, and nothing is read from the database, the network or the
 * clock. The same file is imported by `self-tests.ts` (which runs the real functions on it on the deployed server) and
 * by `tests/system-report-self-tests-1381.test.ts` (which proves the real functions still give these answers), so an
 * example cannot drift from the code.
 *
 * Every date is an explicit instant with an offset, or a calendar date with an explicit IANA zone, so the answers must
 * be the same on any server. An intended change to a rule updates the expected answer here in the same change.
 * Synthetic data only: made-up names, church and club names, and no real person.
 */

export type SelfTestKey =
  | "lodging-quote"
  | "meal-price"
  | "invoice-figures"
  | "ledger-split"
  | "badge-csv"
  | "roster-export"
  | "ics-parsing"
  | "scheduled-email";

export type FixtureCase<I = unknown, E = unknown> = {
  id: string;
  /** What this example shows, in plain words. */
  label: string;
  input: I;
  expected: E;
};

/* ---------- 1. Lodging price quote: `quoteStay` ---------- */

const LODGING_RATES = {
  DORM_ROOM: { amountCents: 6000, basis: "PER_UNIT_NIGHT", minimumNights: null },
  TENT: { amountCents: 1500, basis: "PER_PERSON_NIGHT", minimumNights: 2 },
  RV_SITE: { amountCents: 3500, basis: "PER_UNIT_PER_EVENT", minimumNights: null },
  CONFERENCE_CENTER_ROOM: { amountCents: 2000, basis: "PER_PERSON_PER_EVENT", minimumNights: null },
};

export const LODGING_QUOTE_FIXTURES: readonly FixtureCase[] = [
  { id: "dorm-per-room-night", label: "A room charged per room per night", input: { rates: LODGING_RATES, category: "DORM_ROOM", nights: 3, partySize: 4, units: 2 }, expected: { kind: "CHARGE", totalCents: 36_000, nights: 3, basis: "PER_UNIT_NIGHT", amountCents: 6000 } },
  { id: "tent-power-shares-tent-rate", label: "A tent with power with no rate of its own uses the tent rate", input: { rates: LODGING_RATES, category: "TENT_WITH_POWER", nights: 3, partySize: 4 }, expected: { kind: "CHARGE", totalCents: 18_000, nights: 3, basis: "PER_PERSON_NIGHT", amountCents: 1500 } },
  { id: "tent-below-minimum", label: "A stay shorter than the minimum nights", input: { rates: LODGING_RATES, category: "TENT", nights: 1, partySize: 2 }, expected: { kind: "BELOW_MINIMUM_NIGHTS", totalCents: null, minimumNights: 2, nights: 1 } },
  { id: "rv-flat-per-site", label: "A flat rate per site does not grow with the nights", input: { rates: LODGING_RATES, category: "RV_SITE", nights: 5, partySize: 3 }, expected: { kind: "CHARGE", totalCents: 3500, nights: 5, basis: "PER_UNIT_PER_EVENT", amountCents: 3500 } },
  { id: "room-flat-per-person", label: "A flat rate per person does not grow with the nights", input: { rates: LODGING_RATES, category: "CONFERENCE_CENTER_ROOM", nights: 4, partySize: 3 }, expected: { kind: "CHARGE", totalCents: 6000, nights: 4, basis: "PER_PERSON_PER_EVENT", amountCents: 2000 } },
  { id: "no-rate-included", label: "No rate means lodging is included", input: { rates: {}, category: "DORM_ROOM", nights: 2, partySize: 2 }, expected: { kind: "INCLUDED", totalCents: 0 } },
];

/* ---------- 2. Meal price: `resolveMealPrice` ---------- */

const MEAL_PRICES = [
  { id: "price-lunch-adult", mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 1200 },
  { id: "price-lunch-child", mealType: "LUNCH", ageGroup: "CHILD", attendeeTypeId: null, amountCents: 700 },
  { id: "price-lunch-staff", mealType: "LUNCH", ageGroup: null, attendeeTypeId: "type-staff", amountCents: 0 },
  { id: "price-supper-adult", mealType: "SUPPER", ageGroup: "ADULT", attendeeTypeId: null, amountCents: 1500 },
];
const ATTENDEE_PLAN = { id: "plan-attendee", payer: "ATTENDEE", includesAllServices: true, defaultEntitlement: "PAID", isActive: true };
const CONFERENCE_PLAN = { id: "plan-conference", payer: "CONFERENCE", includesAllServices: true, defaultEntitlement: "INCLUDED", isActive: true };

export const MEAL_PRICE_FIXTURES: readonly FixtureCase[] = [
  { id: "adult-lunch", label: "An adult lunch uses the adult price", input: { plan: ATTENDEE_PLAN, coverage: "PAID", prices: MEAL_PRICES, mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null }, expected: { unitPriceCents: 1200, conferenceRateCents: 0, rule: "AGE_GROUP", priceRowId: "price-lunch-adult" } },
  { id: "child-lunch", label: "A child lunch uses the child price", input: { plan: ATTENDEE_PLAN, coverage: "PAID", prices: MEAL_PRICES, mealType: "LUNCH", ageGroup: "CHILD", attendeeTypeId: null }, expected: { unitPriceCents: 700, conferenceRateCents: 0, rule: "AGE_GROUP", priceRowId: "price-lunch-child" } },
  { id: "attendee-type-beats-age", label: "An attendee type's own price beats the age price", input: { plan: ATTENDEE_PLAN, coverage: "PAID", prices: MEAL_PRICES, mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: "type-staff" }, expected: { unitPriceCents: 0, conferenceRateCents: 0, rule: "ATTENDEE_TYPE", priceRowId: "price-lunch-staff" } },
  { id: "included-is-free", label: "An included meal is free whatever the prices say", input: { plan: ATTENDEE_PLAN, coverage: "INCLUDED", prices: MEAL_PRICES, mealType: "LUNCH", ageGroup: "ADULT", attendeeTypeId: null }, expected: { unitPriceCents: 0, conferenceRateCents: 0, rule: "INCLUDED", priceRowId: "price-lunch-adult" } },
  { id: "conference-pays", label: "A conference-paid meal is never charged to the attendee", input: { plan: CONFERENCE_PLAN, coverage: "INCLUDED", prices: MEAL_PRICES, mealType: "SUPPER", ageGroup: "ADULT", attendeeTypeId: null }, expected: { unitPriceCents: 0, conferenceRateCents: 1500, rule: "CONFERENCE_PAID", priceRowId: "price-supper-adult" } },
  { id: "paid-without-price-refused", label: "A paid meal with no price is refused, never guessed", input: { plan: ATTENDEE_PLAN, coverage: "PAID", prices: MEAL_PRICES, mealType: "BREAKFAST", ageGroup: "ADULT", attendeeTypeId: null }, expected: null },
];

/* ---------- 3. Invoice figures: `buildInvoiceFigures` (people go through `reconcileEvent` first) ---------- */

const invoicePerson = (id: string, checkedIn: boolean, chargeCents: number) => ({
  attendeeId: id, name: `Person ${id}`, checkedIn, correction: null, addedAfterSubmission: false, substituted: false, chargeCents, lateRate: false, adjustmentCents: 0,
});

const invoiceGroup = (people: ReturnType<typeof invoicePerson>[], credits: Array<{ key: string; label: string; units: number; cents: number }> = []) => ({
  key: "church-one", title: "Church One", partyKind: "ORGANIZATION", partyId: "church-1", partyName: "Church One", clubId: null,
  registrations: [{
    registrationId: "reg-1", confirmationCode: "C-reg-1", status: "CONFIRMED", label: "Synthetic Club", clubId: "club-synthetic", locationId: null, locationName: null,
    estimatedCents: people.length * 2500, people, registrationCharges: [], credits, promo: null, review: null, registrationAdjustmentCents: 0, hasPriceLines: true,
  }],
});

export const INVOICE_FIGURES_FIXTURES: readonly FixtureCase[] = [
  {
    id: "two-attended-one-no-show",
    label: "Two people attended and one did not: only the two are billed",
    input: { group: invoiceGroup([invoicePerson("a1", true, 2500), invoicePerson("a2", true, 2500), invoicePerson("a3", false, 2500)]) },
    expected: { groupTitle: "Church One", organizationName: "Church One", registeredCount: 3, billableCount: 2, amountDueCents: 5000, lineAmountsCents: [5000], fingerprintLength: 64, fingerprintRepeats: true },
  },
  {
    id: "nobody-attended",
    label: "Nobody attended: the invoice is for nothing",
    input: { group: invoiceGroup([invoicePerson("b1", false, 2500)]) },
    expected: { groupTitle: "Church One", organizationName: "Church One", registeredCount: 1, billableCount: 0, amountDueCents: 0, lineAmountsCents: [0], fingerprintLength: 64, fingerprintRepeats: true },
  },
  {
    id: "group-gone",
    label: "A group that no longer exists is an invoice for nothing",
    input: { group: null },
    expected: { groupTitle: "Church One", organizationName: "Church One", registeredCount: 0, billableCount: 0, amountDueCents: 0, lineAmountsCents: [], fingerprintLength: 64, fingerprintRepeats: true },
  },
];

/* ---------- 4. Ledger split: `splitSubmissionTotal` ---------- */

export const LEDGER_SPLIT_FIXTURES: readonly FixtureCase[] = [
  { id: "with-discount", label: "A discounted total splits into a charge and a discount that add back to it", input: { totalCents: 9000, appliedDiscountCents: 1000 }, expected: { chargeCents: 10_000, discountCents: -1000 } },
  { id: "no-discount", label: "No discount is a plain charge", input: { totalCents: 4500, appliedDiscountCents: 0 }, expected: { chargeCents: 4500, discountCents: 0 } },
  { id: "free-registration", label: "A free registration splits to zero", input: { totalCents: 0, appliedDiscountCents: 0 }, expected: { chargeCents: 0, discountCents: 0 } },
  { id: "negative-total-floored", label: "A negative total is never stored", input: { totalCents: -500, appliedDiscountCents: 250 }, expected: { chargeCents: 250, discountCents: -250 } },
  { id: "fractions-rounded", label: "Stray fractions of a cent are rounded away", input: { totalCents: 1999.6, appliedDiscountCents: 0.4 }, expected: { chargeCents: 2000, discountCents: 0 } },
];

/* ---------- 5. Badge CSV: `buildBadgeCsvRows` ---------- */

const badgeField = (key: string, label: string, type: string, scope: "ATTENDEE" | "REGISTRATION", extra: Record<string, unknown> = {}) => ({
  id: `field_${key}`, key, label, helpText: "", type, scope, required: false,
  options: type === "SELECT" ? ["Option A", "Option B"] : [], ...extra,
});

const BADGE_FORM = {
  title: "Synthetic Form", description: "", confirmationMessage: "Thanks",
  sections: [{ id: "sec_one", title: "Section", description: "", fields: [badgeField("church_role", "Church role", "TEXT", "ATTENDEE"), badgeField("ministry_area", "Ministry area", "SELECT", "REGISTRATION")] }],
};

const badgeRegistration = (code: string, attendees: Array<{ id: string; first: string; last: string; role?: string }>, ministry: string) => ({
  id: `id-${code}`,
  confirmationCode: code,
  attendees: attendees.map((attendee) => ({
    id: attendee.id, attendeeType: "Adult", firstName: attendee.first, lastName: attendee.last,
    responses: attendee.role ? { church_role: attendee.role } : {}, passToken: "synthetic-pass-token",
  })),
  publicSubmission: { definition: BADGE_FORM, responses: { ministry_area: ministry } },
});

/** Last names in the fixture sort by the server's own text rules: with full ICU, "Åberg" sorts with the A names. */
const BADGE_REGISTRATIONS = [
  badgeRegistration("REG-BBBB2222", [{ id: "a2", first: "Zed", last: "Zimmer", role: "Usher" }], "Option B"),
  badgeRegistration("REG-AAAA1111", [{ id: "a1", first: "Amy", last: "Adams", role: "Greeter" }, { id: "a3", first: "=Evil", last: "Formula" }, { id: "a4", first: "Åsa", last: "Åberg", role: "Deacon" }], "Option A"),
];

export const BADGE_CSV_FIXTURES: readonly FixtureCase[] = [
  {
    id: "no-position",
    label: "Badge rows with no Position chosen, in badge order",
    input: { registrations: BADGE_REGISTRATIONS, positionField: null, showAttendeeType: true },
    expected: [
      ["ID", "Name", "Position", "Attendee type"],
      ["REG-AAAA1111", "Åsa Åberg", "", "Adult"],
      ["REG-AAAA1111", "Amy Adams", "", "Adult"],
      ["REG-AAAA1111", "=Evil Formula", "", "Adult"],
      ["REG-BBBB2222", "Zed Zimmer", "", "Adult"],
    ],
  },
  {
    id: "position-and-hidden-type",
    label: "A chosen Position fills in, and a hidden attendee type stays an empty column",
    input: { registrations: BADGE_REGISTRATIONS, positionField: "church_role", showAttendeeType: false },
    expected: [
      ["ID", "Name", "Position", "Attendee type"],
      ["REG-AAAA1111", "Åsa Åberg", "Deacon", ""],
      ["REG-AAAA1111", "Amy Adams", "Greeter", ""],
      ["REG-AAAA1111", "=Evil Formula", "", ""],
      ["REG-BBBB2222", "Zed Zimmer", "Usher", ""],
    ],
  },
  {
    id: "registration-level-position",
    label: "A registration-wide Position shows the option label for everyone on it",
    input: { registrations: BADGE_REGISTRATIONS, positionField: "ministry_area", showAttendeeType: true },
    expected: [
      ["ID", "Name", "Position", "Attendee type"],
      ["REG-AAAA1111", "Åsa Åberg", "Option A", "Adult"],
      ["REG-AAAA1111", "Amy Adams", "Option A", "Adult"],
      ["REG-AAAA1111", "=Evil Formula", "Option A", "Adult"],
      ["REG-BBBB2222", "Zed Zimmer", "Option B", "Adult"],
    ],
  },
];

/* ---------- 6. Roster export: `buildRosterExportTable`, then the CSV text ---------- */

const rosterMember = (overrides: Record<string, unknown>) => ({
  id: "member-1", firstName: "Ana", lastName: "Reyes", attendeeType: "YOUTH", role: "Pathfinder", classLevel: "EXPLORER", gender: "FEMALE",
  status: "ACTIVE", source: "DIRECTOR", age: 12, reportedAge: null, birthDateNeeded: false, updatedAt: "2026-09-01T00:00:00.000Z", ...overrides,
});

export const ROSTER_EXPORT_FIXTURES: readonly FixtureCase[] = [
  {
    id: "chosen-columns-in-order",
    label: "Chosen columns, in the chosen order, under the chosen headers",
    input: {
      members: [rosterMember({}), rosterMember({ id: "member-2", firstName: "=Cal", lastName: "Okafor", age: null, reportedAge: 10, gender: "MALE", classLevel: "MASTER_GUIDE", role: "Staff, lead" }), rosterMember({ id: "member-3", firstName: "Dee", lastName: "Lund", age: null, gender: null, classLevel: null, role: "" })],
      columns: [{ key: "lastName", header: "Last" }, { key: "firstName", header: "First" }, { key: "age", header: "Age" }, { key: "gender", header: "Gender" }, { key: "classLevel", header: "Class" }, { key: "role", header: "Role" }],
      birthDates: null,
      guardians: null,
    },
    expected: {
      headers: ["Last", "First", "Age", "Gender", "Class", "Role"],
      rows: [["Reyes", "Ana", "12", "Female", "Explorer", "Pathfinder"], ["Okafor", "=Cal", "10", "Male", "Master Guide", "Staff, lead"], ["Lund", "Dee", "", "", "", ""]],
      csv: "\"Last\",\"First\",\"Age\",\"Gender\",\"Class\",\"Role\"\r\n\"Reyes\",\"Ana\",\"12\",\"Female\",\"Explorer\",\"Pathfinder\"\r\n\"Okafor\",\"'=Cal\",\"10\",\"Male\",\"Master Guide\",\"Staff, lead\"\r\n\"Lund\",\"Dee\",\"\",\"\",\"\",\"\"\r\n",
    },
  },
  {
    id: "birth-dates-and-guardians-only-when-supplied",
    label: "Birth dates and emergency contacts appear only when they are supplied",
    input: {
      members: [rosterMember({})],
      columns: [{ key: "birthDate", header: "Birth date" }, { key: "guardian1Name", header: "Contact" }, { key: "guardian1Phone", header: "Phone" }, { key: "guardian2Name", header: "Second contact" }],
      birthDates: { "member-1": "2014-05-06" },
      guardians: { "member-1": [{ position: 1, name: "Pat Reyes", relationship: "Parent", email: "pat@example.test", phone: "(515) 555-0100" }] },
    },
    expected: {
      headers: ["Birth date", "Contact", "Phone", "Second contact"],
      rows: [["2014-05-06", "Pat Reyes", "(515) 555-0100", ""]],
      csv: "\"Birth date\",\"Contact\",\"Phone\",\"Second contact\"\r\n\"2014-05-06\",\"Pat Reyes\",\"(515) 555-0100\",\"\"\r\n",
    },
  },
];

/* ---------- 7. ICS parsing: `parseIcsFeed` (the conference zone is America/Chicago) ---------- */

const ICS = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//Self Test//EN", ...events.map((event) => `BEGIN:VEVENT\r\n${event}\r\nEND:VEVENT`), "END:VCALENDAR"].join("\r\n");

export const ICS_PARSING_FIXTURES: readonly FixtureCase[] = [
  {
    id: "zone-and-label",
    label: "A time in a named zone becomes the conference's day and a time label with its zone",
    input: { text: ICS("UID:zoned@synthetic.test\r\nDTSTART;TZID=America/Chicago:20261015T190000\r\nDTEND;TZID=America/Chicago:20261015T210000\r\nSUMMARY:Evening meeting") },
    expected: { warnings: 0, entries: [{ uid: "zoned@synthetic.test", title: "Evening meeting", startsOn: "2026-10-15", endsOn: "2026-10-15", timeLabel: "7:00 PM – 9:00 PM CDT", status: "SCHEDULED", repeatRule: null }] },
  },
  {
    id: "utc-near-midnight",
    label: "A UTC time just after midnight is still the previous evening in Chicago",
    input: { text: ICS("UID:late@synthetic.test\r\nDTSTART:20261016T030000Z\r\nDTEND:20261016T040000Z\r\nSUMMARY:Late") },
    expected: { warnings: 0, entries: [{ uid: "late@synthetic.test", title: "Late", startsOn: "2026-10-15", endsOn: "2026-10-15", timeLabel: "10:00 PM – 11:00 PM CDT", status: "SCHEDULED", repeatRule: null }] },
  },
  {
    id: "clocks-go-back",
    label: "On the day the clocks go back, a morning time carries the standard-time label",
    input: { text: ICS("UID:fallback@synthetic.test\r\nDTSTART;TZID=America/Chicago:20261101T090000\r\nDTEND;TZID=America/Chicago:20261101T100000\r\nSUMMARY:Fall back") },
    expected: { warnings: 0, entries: [{ uid: "fallback@synthetic.test", title: "Fall back", startsOn: "2026-11-01", endsOn: "2026-11-01", timeLabel: "9:00 AM – 10:00 AM CST", status: "SCHEDULED", repeatRule: null }] },
  },
  {
    id: "other-zone-after-midnight",
    label: "A time in another zone just after its local midnight starts on the conference's previous day and runs across its midnight",
    input: { text: ICS("UID:east@synthetic.test\r\nDTSTART;TZID=America/New_York:20261005T003000\r\nDTEND;TZID=America/New_York:20261005T013000\r\nSUMMARY:Early east") },
    expected: { warnings: 0, entries: [{ uid: "east@synthetic.test", title: "Early east", startsOn: "2026-10-04", endsOn: "2026-10-05", timeLabel: "", status: "SCHEDULED", repeatRule: null }] },
  },
  {
    id: "all-day-and-cancelled",
    label: "An all-day item keeps its dates, and a cancelled one says so",
    input: { text: ICS("UID:allday@synthetic.test\r\nDTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261012\r\nSUMMARY:Synthetic Camporee", "UID:cancelled@synthetic.test\r\nDTSTART;VALUE=DATE:20261105\r\nSTATUS:CANCELLED\r\nSUMMARY:Called off") },
    expected: {
      warnings: 0,
      entries: [
        { uid: "allday@synthetic.test", title: "Synthetic Camporee", startsOn: "2026-10-09", endsOn: "2026-10-11", timeLabel: "", status: "SCHEDULED", repeatRule: null },
        { uid: "cancelled@synthetic.test", title: "Called off", startsOn: "2026-11-05", endsOn: "2026-11-05", timeLabel: "", status: "CANCELLED", repeatRule: null },
      ],
    },
  },
  {
    id: "not-a-calendar",
    label: "Text that is not a calendar is refused",
    input: { text: "<html>sign in</html>" },
    expected: { refused: true },
  },
];

/* ---------- 8. Scheduled email: `projectSchedule` (event zone America/Chicago; the DST change is 2027-03-14 and 2027-11-07) ---------- */

const CHICAGO_EVENT = { timezone: "America/Chicago", startsAt: "2027-03-15T14:00:00Z", registrationClosesOn: "2027-03-14", paymentDueOn: "2027-03-20" };

export const SCHEDULED_EMAIL_FIXTURES: readonly FixtureCase[] = [
  {
    id: "spring-gap",
    label: "A send time that does not exist when the clocks skip forward moves to just after the change",
    input: { rule: { trigger: "ONE_TIME", localDate: "2027-03-14", localTime: "02:30" }, event: CHICAGO_EVENT },
    expected: { sendAt: "2027-03-14T08:30:00.000Z", anchorAt: null, localDate: "2027-03-14", localTime: "03:30", dstBehavior: "GAP_SHIFTED", sendAtLabel: "Sun, Mar 14, 2027, 3:30 AM CDT" },
  },
  {
    id: "autumn-repeat",
    label: "A send time that happens twice when the clocks go back uses the first one",
    input: { rule: { trigger: "ONE_TIME", localDate: "2027-11-07", localTime: "01:30" }, event: CHICAGO_EVENT },
    expected: { sendAt: "2027-11-07T06:30:00.000Z", anchorAt: null, localDate: "2027-11-07", localTime: "01:30", dstBehavior: "AMBIGUOUS_FIRST", sendAtLabel: "Sun, Nov 7, 2027, 1:30 AM CDT" },
  },
  {
    id: "days-before-event-across-change",
    label: "Seven days before the event counts calendar days, so 9:00 stays 9:00 across the clock change",
    input: { rule: { trigger: "BEFORE_EVENT_START", daysBefore: 7, localTime: "09:00" }, event: CHICAGO_EVENT },
    expected: { sendAt: "2027-03-08T15:00:00.000Z", anchorAt: "2027-03-15T14:00:00.000Z", localDate: "2027-03-08", localTime: "09:00", dstBehavior: "NONE", sendAtLabel: "Mon, Mar 8, 2027, 9:00 AM CST" },
  },
  {
    id: "event-starts-before-local-midnight",
    label: "An event that starts late in the evening counts from its own local day, not the UTC day",
    input: { rule: { trigger: "BEFORE_EVENT_START", daysBefore: 1, localTime: "09:00" }, event: { ...CHICAGO_EVENT, startsAt: "2027-03-15T03:30:00Z" } },
    expected: { sendAt: "2027-03-13T15:00:00.000Z", anchorAt: "2027-03-15T03:30:00.000Z", localDate: "2027-03-13", localTime: "09:00", dstBehavior: "NONE", sendAtLabel: "Sat, Mar 13, 2027, 9:00 AM CST" },
  },
  {
    id: "days-before-registration-close",
    label: "Counting back from the day registration closes",
    input: { rule: { trigger: "BEFORE_REGISTRATION_CLOSE", daysBefore: 2, localTime: "08:00" }, event: CHICAGO_EVENT },
    expected: { sendAt: "2027-03-12T14:00:00.000Z", anchorAt: "2027-03-15T05:00:00.000Z", localDate: "2027-03-12", localTime: "08:00", dstBehavior: "NONE", sendAtLabel: "Fri, Mar 12, 2027, 8:00 AM CST" },
  },
  {
    id: "days-before-payment-due",
    label: "Counting back from the day payment is due",
    input: { rule: { trigger: "BEFORE_PAYMENT_DUE", daysBefore: 3, localTime: "10:00" }, event: CHICAGO_EVENT },
    expected: { sendAt: "2027-03-17T15:00:00.000Z", anchorAt: "2027-03-21T05:00:00.000Z", localDate: "2027-03-17", localTime: "10:00", dstBehavior: "NONE", sendAtLabel: "Wed, Mar 17, 2027, 10:00 AM CDT" },
  },
  {
    id: "after-the-event-starts-refused",
    label: "A send time after the event starts is refused",
    input: { rule: { trigger: "BEFORE_EVENT_START", daysBefore: 0, localTime: "23:00" }, event: CHICAGO_EVENT },
    expected: { refused: true },
  },
];

export type SelfTestFixtureSet = {
  key: SelfTestKey;
  /** The row's name on the report. */
  name: string;
  /** What the row checks, in one sentence. */
  description: string;
  cases: readonly FixtureCase[];
};

const description = (what: string) => `Runs the real ${what} on a fixed example and compares it with the known answer. No registration or other record is used.`;

/** Declared order is the order of the rows. */
export const SELF_TEST_FIXTURES: readonly SelfTestFixtureSet[] = [
  { key: "lodging-quote", name: "Lodging price quote", description: description("lodging price calculation"), cases: LODGING_QUOTE_FIXTURES },
  { key: "meal-price", name: "Meal price", description: description("meal price lookup"), cases: MEAL_PRICE_FIXTURES },
  { key: "invoice-figures", name: "Invoice figures", description: description("invoice calculation"), cases: INVOICE_FIGURES_FIXTURES },
  { key: "ledger-split", name: "Ledger charge and discount split", description: description("split of a registration total into a charge and a discount"), cases: LEDGER_SPLIT_FIXTURES },
  { key: "badge-csv", name: "Badge CSV", description: description("badge file builder"), cases: BADGE_CSV_FIXTURES },
  { key: "roster-export", name: "Club roster export", description: description("club roster export"), cases: ROSTER_EXPORT_FIXTURES },
  { key: "ics-parsing", name: "Calendar feed reading", description: description("calendar feed reader, in the conference time zone,"), cases: ICS_PARSING_FIXTURES },
  { key: "scheduled-email", name: "Scheduled email send time", description: description("scheduled email time calculation, across clock changes,"), cases: SCHEDULED_EMAIL_FIXTURES },
];
