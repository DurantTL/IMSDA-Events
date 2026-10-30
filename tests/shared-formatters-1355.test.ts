import { describe, expect, it } from "vitest";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { createAttendeeRosterCsvTemplate } from "@/modules/forms/attendee-roster-csv";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { formatCents, formatCentsPlain } from "@/modules/payments/format-cents";
import { csvCell } from "@/modules/reporting/csv";

describe("formatCents (#1355)", () => {
  const cases: Array<[number, string, string]> = [
    // cents, default (Intl), plain (no thousands separator)
    [0, "$0.00", "$0.00"],
    [5, "$0.05", "$0.05"],
    [99, "$0.99", "$0.99"],
    [100000, "$1,000.00", "$1000.00"],
    [123456, "$1,234.56", "$1234.56"],
    [-500, "-$5.00", "-$5.00"],
    [-123456, "-$1,234.56", "-$1234.56"],
  ];

  it.each(cases)("prints %i cents as the default and plain forms", (cents, grouped, plain) => {
    expect(formatCents(cents)).toBe(grouped);
    expect(formatCents(cents, { grouping: false })).toBe(plain);
    expect(formatCentsPlain(cents)).toBe(plain);
  });

  it("keeps the two families' difference for negative zero", () => {
    expect(formatCents(-0)).toBe("-$0.00");
    expect(formatCents(-0, { grouping: false })).toBe("$0.00");
  });

  it("matches each removed copy exactly", () => {
    const intl = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
    const locale = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    const oldPlain = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
    for (const cents of [0, -0, 1, 5, 99, 100, 99999, 100000, 123456, 1234567, -1, -500, -100000, -123456]) {
      expect(formatCents(cents)).toBe(intl(cents));
      expect(formatCents(cents)).toBe(locale(cents));
      expect(formatCents(cents, { grouping: false })).toBe(oldPlain(cents));
    }
  });
});

describe("formatInConferenceTime (#1355)", () => {
  const zone = "America/Chicago";
  // Either side of both 2026 US daylight-saving changes, plus a plain winter and summer instant.
  const instants = [
    "2026-03-08T07:59:59Z", // 1:59 AM CST, one second before the spring-forward
    "2026-03-08T08:00:00Z", // 3:00 AM CDT
    "2026-07-04T17:30:00Z",
    "2026-11-01T06:59:59Z", // 1:59 AM CDT, before the fall-back
    "2026-11-01T07:00:00Z", // 1:00 AM CST
    "2026-12-31T23:30:00Z", // 5:30 PM CST on Dec 31
    "2027-01-01T05:59:00Z", // Dec 31, 11:59 PM CST
  ];

  it("matches toLocaleDateString with no date fields (numeric year, month, day)", () => {
    for (const iso of instants) {
      expect(formatInConferenceTime(iso)).toBe(new Date(iso).toLocaleDateString("en-US", { timeZone: zone }));
    }
    expect(formatInConferenceTime("2027-01-01T05:59:00Z")).toBe("12/31/2026");
  });

  it("matches toLocaleDateString with long and short month presets", () => {
    for (const iso of instants) {
      expect(formatInConferenceTime(iso, { month: "long", day: "numeric", year: "numeric" }))
        .toBe(new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: zone }));
      expect(formatInConferenceTime(iso, { month: "short", day: "numeric", year: "numeric" }))
        .toBe(new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }));
      expect(formatInConferenceTime(iso, { year: "numeric", month: "short", day: "numeric" }))
        .toBe(new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: zone }));
      expect(formatInConferenceTime(iso, { dateStyle: "long" }))
        .toBe(new Date(iso).toLocaleDateString("en-US", { dateStyle: "long", timeZone: zone }));
    }
    expect(formatInConferenceTime("2027-01-01T05:59:00Z", { month: "long", day: "numeric", year: "numeric" })).toBe("December 31, 2026");
  });

  it("matches toLocaleString and DateTimeFormat with dateStyle and timeStyle", () => {
    for (const iso of instants) {
      for (const options of [
        { dateStyle: "long", timeStyle: "short" },
        { dateStyle: "medium", timeStyle: "short" },
        { dateStyle: "full", timeStyle: "short" },
      ] as const) {
        expect(formatInConferenceTime(iso, options)).toBe(new Date(iso).toLocaleString("en-US", { ...options, timeZone: zone }));
        expect(formatInConferenceTime(new Date(iso), options)).toBe(new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).format(new Date(iso)));
      }
      expect(formatInConferenceTime(iso, { dateStyle: "medium" }))
        .toBe(new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: zone }).format(new Date(iso)));
    }
  });

  it("matches toLocaleTimeString with explicit time fields and a zone name, across the DST change", () => {
    const options = { hour: "numeric", minute: "2-digit", timeZoneName: "short" } as const;
    for (const iso of instants) {
      expect(formatInConferenceTime(new Date(iso), options)).toBe(new Date(iso).toLocaleTimeString("en-US", { ...options, timeZone: zone }));
      expect(formatInConferenceTime(iso, { hour: "numeric", minute: "2-digit" }))
        .toBe(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)));
    }
    expect(formatInConferenceTime("2026-03-08T07:59:59Z", options)).toMatch(/^1:59\sAM CST$/);
    expect(formatInConferenceTime("2026-03-08T08:00:00Z", options)).toMatch(/^3:00\sAM CDT$/);
    expect(formatInConferenceTime("2026-11-01T07:00:00Z", options)).toMatch(/^1:00\sAM CST$/);
  });

  it("accepts a Date, an ISO string or a timestamp", () => {
    const iso = "2026-07-04T17:30:00Z";
    expect(formatInConferenceTime(new Date(iso))).toBe(formatInConferenceTime(iso));
    expect(formatInConferenceTime(Date.parse(iso))).toBe(formatInConferenceTime(iso));
  });

  it("prints Invalid Date for an invalid value, like toLocale*String, instead of throwing", () => {
    expect(new Date("nope").toLocaleDateString("en-US", { timeZone: zone })).toBe("Invalid Date");
    expect(formatInConferenceTime("nope")).toBe("Invalid Date");
    expect(formatInConferenceTime(new Date(Number.NaN), { dateStyle: "long", timeStyle: "short" })).toBe("Invalid Date");
  });

  it("always uses the conference zone, whatever options say about other fields", () => {
    expect(formatInConferenceTime("2026-07-04T03:30:00Z", { month: "long", day: "numeric" })).toBe("July 3");
  });
});

describe("attendee roster CSV template (#1355)", () => {
  function template(keys: string[]) {
    return createAttendeeRosterCsvTemplate({
      sections: [{ fields: keys.map((key) => ({ key, scope: "ATTENDEE", type: "TEXT" })) }],
    } as unknown as RegistrationFormDefinition);
  }

  it("leaves ordinary keys unchanged, with the template's own line ending", () => {
    expect(template(["first_name", "last_name", "shirt_size"])).toBe("first_name,last_name,shirt_size\n");
  });

  it("guards a cell that starts with =, +, - or @, and only that", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      expect(csvCell(`${lead}cmd`, { minimalQuoting: true })).toBe(`'${lead}cmd`);
    }
    expect(csvCell("plain", { minimalQuoting: true })).toBe("plain");
    expect(csvCell("a,b", { minimalQuoting: true })).toBe('"a,b"');
    expect(template(["=sum", "@x", "a_b"])).toBe("'=sum,'@x,a_b\n");
  });
});
