import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

const zone = "America/Chicago";
// Either side of both 2026 US daylight-saving changes, plus a plain winter and summer instant.
const instants = [
  "2026-03-08T07:59:59Z",
  "2026-03-08T08:00:00Z",
  "2026-07-04T17:30:00Z",
  "2026-11-01T06:59:59Z",
  "2026-11-01T07:00:00Z",
  "2026-12-31T23:30:00Z",
  "2027-01-01T05:59:00Z",
];
// A string, an ISO string and a Date input for every instant.
const inputs: Array<Date | string> = [...instants, ...instants.map((iso) => new Date(iso))];

const short = { month: "short", day: "numeric", year: "numeric" } as const;
const medium = { dateStyle: "medium" } as const;
const mediumShort = { dateStyle: "medium", timeStyle: "short" } as const;

describe("last six date formatter copies (#1373)", () => {
  it.each([
    ["admin/forms, club-forms, area forms, club report review (short month/day/year)", short],
    ["waitlists joined (dateStyle medium)", medium],
  ])("matches toLocaleDateString for %s", (_name, options) => {
    for (const input of inputs) {
      expect(formatInConferenceTime(input, options)).toBe(new Date(input).toLocaleDateString("en-US", { ...options, timeZone: zone }));
    }
  });

  it("matches toLocaleString for background checks (dateStyle medium, timeStyle short)", () => {
    for (const input of inputs) {
      expect(formatInConferenceTime(input, mediumShort)).toBe(new Date(input).toLocaleString("en-US", { ...mediumShort, timeZone: zone }));
    }
  });

  const files = [
    "app/(workspace)/admin/forms/page.tsx",
    "app/(workspace)/more/club-forms/page.tsx",
    "app/(public)/account/(portal)/area/[organizationId]/forms/page.tsx",
    "app/(public)/account/(portal)/waitlists/page.tsx",
    "app/(workspace)/admin/clubs/reports/[organizationId]/[month]/page.tsx",
    "app/(workspace)/admin/organizations/background-checks/page.tsx",
  ];

  it.each(files)("%s uses the shared formatter, not an inline zone", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("America/Chicago");
    expect(source).toContain("formatInConferenceTime");
    expect(source).toContain('from "@/modules/calendar/conference-format"');
  });
});
