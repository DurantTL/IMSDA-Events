import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CLUB_OPTIONAL_FEATURE_KEYS, canSwitchClubFeatures, clubOptionalFeatureDefinitions } from "@/modules/club-features/domain";
import {
  LETTERS_PER_CLUB_MAX,
  LETTER_BODY_MAX,
  LETTER_PLACEHOLDERS,
  LETTER_TITLE_MAX,
  PRINT_PEOPLE_MAX,
  canAddLetter,
  canManageClubLetters,
  fillInLetter,
  formatLetterDate,
  parsePrintPersonIds,
  placeholderProblem,
  unknownPlaceholders,
} from "@/modules/club-letters/domain";
import { parseClubLetterCreate, parseClubLetterUpdate } from "@/modules/club-letters/schemas";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** Fill-in letters and certificates (#1708): the pure rules. Synthetic data only. */

const now = new Date("2026-11-12T12:00:00.000Z");
const fill = { firstName: "Ann", lastName: "Example", clubName: "Test Pathfinders", clubYear: "2026-27", date: now };
const message = (run: () => unknown) => { try { run(); } catch (error) { return (error as ZodError).issues[0]?.message; } return null; };

describe("the optional feature", () => {
  it("is a typed key, off until a director or deputy switches it on", () => {
    expect(CLUB_OPTIONAL_FEATURE_KEYS).toContain("fill-in-letters");
    const definition = clubOptionalFeatureDefinitions["fill-in-letters"];
    expect(definition.title).toBe("Fill-in letters and certificates");
    expect(definition.description).toContain("Nothing is emailed");
    expect(canSwitchClubFeatures(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canSwitchClubFeatures(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canSwitchClubFeatures(clubCapabilities("REGISTRAR"))).toBe(false);
  });

  it("is managed by the director and deputy only", () => {
    expect(canManageClubLetters(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canManageClubLetters(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canManageClubLetters(clubCapabilities("REGISTRAR"))).toBe(false);
    expect(canManageClubLetters(clubCapabilities("REPORTER"))).toBe(false);
  });
});

describe("filling in", () => {
  it("replaces every placeholder, each as many times as it appears", () => {
    const text = fillInLetter("Dear {first_name} {last_name} ({full_name}), {club_name}, {club_year}, {date}. Again {first_name}.", fill);
    expect(text).toBe("Dear Ann Example (Ann Example), Test Pathfinders, 2026–27, November 12, 2026. Again Ann.");
  });

  it("keeps line breaks and fills in once, so a name holding braces is printed as typed", () => {
    const text = fillInLetter("{first_name}\n\n{last_name}", { ...fill, firstName: "{last_name}", lastName: "Sample" });
    expect(text).toBe("{last_name}\n\nSample");
  });

  it("leaves HTML as plain text and a missing name part without a stray space", () => {
    expect(fillInLetter("<b>{full_name}</b>", { ...fill, firstName: "", lastName: "Solo" })).toBe("<b>Solo</b>");
  });

  it("prints the date in long US form", () => {
    expect(formatLetterDate(new Date("2026-03-05T18:00:00.000Z"))).toBe("March 5, 2026");
  });

  it("offers exactly the six placeholders and nothing about health, contacts or birth dates", () => {
    expect(LETTER_PLACEHOLDERS.map((item) => item.key)).toEqual(["first_name", "last_name", "full_name", "club_name", "club_year", "date"]);
    expect(JSON.stringify(LETTER_PLACEHOLDERS)).not.toMatch(/birth|health|email|phone|contact|address/i);
  });
});

describe("placeholder checks", () => {
  it("names every unknown placeholder once", () => {
    expect(unknownPlaceholders("{first_name} {birth_date} {Birth_Date} {birth_date} { first_name }")).toEqual(["birth_date", "Birth_Date", " first_name "]);
    expect(unknownPlaceholders("No braces, a lone { here,\nand a lone } there.")).toEqual([]);
  });

  it("says which placeholder is wrong", () => {
    expect(placeholderProblem("Hi {first_name}")).toBeNull();
    expect(placeholderProblem("Hi {nickname}")).toContain("{nickname} is not a placeholder");
    expect(placeholderProblem("{a} {b}")).toContain("{a}, {b} are not placeholders");
  });
});

describe("saving rules", () => {
  const good = { kind: "LETTER", title: "Welcome", body: "Dear {first_name}," };

  it("accepts a letter and a certificate and keeps the body's line breaks", () => {
    expect(parseClubLetterCreate({ ...good, body: "Line one\n\nLine two {full_name}" }).body).toBe("Line one\n\nLine two {full_name}");
    expect(parseClubLetterUpdate({ ...good, kind: "CERTIFICATE" }).kind).toBe("CERTIFICATE");
  });

  it("limits the title to 1 to 120 characters and one line", () => {
    expect(message(() => parseClubLetterCreate({ ...good, title: "   " }))).toBe("Enter a title.");
    expect(() => parseClubLetterCreate({ ...good, title: "x".repeat(LETTER_TITLE_MAX) })).not.toThrow();
    expect(message(() => parseClubLetterCreate({ ...good, title: "x".repeat(LETTER_TITLE_MAX + 1) }))).toContain("at most 120");
    expect(message(() => parseClubLetterCreate({ ...good, title: "a\nb" }))).toContain("line breaks");
  });

  it("limits the body to 1 to 10,000 characters", () => {
    expect(message(() => parseClubLetterCreate({ ...good, body: "  \n " }))).toBe("Enter the text of the letter.");
    expect(() => parseClubLetterCreate({ ...good, body: "x".repeat(LETTER_BODY_MAX) })).not.toThrow();
    expect(message(() => parseClubLetterCreate({ ...good, body: "x".repeat(LETTER_BODY_MAX + 1) }))).toContain("at most 10,000");
  });

  it("rejects an unknown placeholder, naming it", () => {
    expect(message(() => parseClubLetterCreate({ ...good, body: "Born {birth_date}" }))).toContain("{birth_date}");
  });

  it("rejects an unknown kind and extra fields", () => {
    expect(message(() => parseClubLetterCreate({ ...good, kind: "EMAIL" }))).toBe("Choose Letter or Certificate.");
    expect(() => parseClubLetterCreate({ ...good, recipients: ["a@example.test"] })).toThrow(ZodError);
  });

  it("allows 50 templates a club and no more", () => {
    expect(canAddLetter(LETTERS_PER_CLUB_MAX - 1)).toBe(true);
    expect(canAddLetter(LETTERS_PER_CLUB_MAX)).toBe(false);
  });
});

describe("the print request", () => {
  it("reads a comma list, drops blanks and repeats, and keeps at most 200", () => {
    expect(parsePrintPersonIds("a, b,,a ,c")).toEqual(["a", "b", "c"]);
    expect(parsePrintPersonIds(["a,b", "c"])).toEqual(["a", "b", "c"]);
    expect(parsePrintPersonIds(undefined)).toEqual([]);
    expect(parsePrintPersonIds("x".repeat(65))).toEqual([]);
    expect(parsePrintPersonIds(Array.from({ length: 300 }, (_, i) => `p${i}`).join(","))).toHaveLength(PRINT_PEOPLE_MAX);
  });
});
