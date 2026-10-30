import { describe, expect, it } from "vitest";
import { isEmail, isLooseEmail, validateEmail } from "@/lib/field-validation";
import { clampPage, pageCountFor, parseLeadingPageParam, parsePageParam } from "@/lib/pagination";
import { containsAnyOf, everyTermMatches, insensitiveContains, searchTerms } from "@/lib/server-search";
import { firstParam } from "@/lib/search-params";
import { pagePeople } from "@/modules/system-admin/people-directory-model";
import { organizationSearchWhere, searchTerms as organizationSearchTerms } from "@/modules/organizations/search";

describe("firstParam", () => {
  it("returns a string, the first of a list, or undefined", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam([])).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam("")).toBe("");
    expect(firstParam(5 as unknown)).toBe(5);
  });
});

describe("page counting and clamping", () => {
  it("pagePeople matches the previous trunc-and-clamp for every requested page", () => {
    const items = Array.from({ length: 53 }, (_, i) => i);
    const before = (requested: number, size = 25) => {
      const pageCount = Math.max(1, Math.ceil(items.length / size));
      const wanted = Number.isFinite(requested) ? Math.trunc(requested) : 1;
      return Math.min(pageCount, Math.max(1, wanted));
    };
    for (const requested of [0, 1, 2, 3, 4, 999, -1, -0.5, 1.9, 2.5, Number.NaN, Infinity, -Infinity, 1e20]) {
      expect(pagePeople(items, requested).page).toBe(before(requested));
    }
    expect(pagePeople([], 5)).toMatchObject({ items: [], page: 1, pageCount: 1, total: 0 });
    expect(pagePeople(items, 3).items).toHaveLength(3);
    expect(pageCountFor(0, 10)).toBe(1);
    expect(pageCountFor(11, 10)).toBe(2);
    expect(clampPage(3, 5, 10)).toBe(1);
  });

  it("parseLeadingPageParam reproduces the organization list parser exactly", () => {
    const before = (value: string | undefined) => {
      const page = Number.parseInt(value ?? "", 10);
      return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
    };
    const inputs = [undefined, "", "abc", "-4", "0", "7", "12abc", " 7", "+5", "2.5", "1e3", "0x10", "99999", "99999999999999999999", "-0", "  ", "٣"];
    for (const input of inputs) expect(parseLeadingPageParam(input)).toBe(before(input));
    expect(parseLeadingPageParam("12abc")).toBe(12);
    expect(parseLeadingPageParam("99999")).toBe(10_000);
  });

  it("parsePageParam (strict) is unchanged", () => {
    expect(parsePageParam("12abc")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("999999999")).toBe(100_000);
  });
});

describe("email checks", () => {
  const samples = ["a@b.co", "a@b.c", "a@b", "a b@c.com", " a@b.com ", "", "a@@b.com", "x@y.z", "a+tag@example.org", "a@b.c.d", "ünï@example.com", `${"a".repeat(150)}@example.com`, "a@-b.com", "a@b..com"];
  it("isEmail is exactly validateEmail(...).ok", () => {
    for (const sample of samples) expect(isEmail(sample)).toBe(validateEmail(sample).ok);
  });
  it("isLooseEmail is exactly the previous regex plus length check", () => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const sample of samples) {
      expect(isLooseEmail(sample)).toBe(regex.test(sample));
      expect(isLooseEmail(sample, 254)).toBe(sample.length <= 254 && regex.test(sample));
    }
    expect(isLooseEmail(`${"a".repeat(250)}@b.co`, 254)).toBe(false);
    expect(isLooseEmail("a@b.c")).toBe(true);
  });
});

describe("server search helpers", () => {
  it("contains helpers build the previous Prisma shapes", () => {
    expect(insensitiveContains("x")).toEqual({ contains: "x", mode: "insensitive" });
    expect(containsAnyOf(["email", "name"], "ab")).toEqual({
      OR: [{ email: { contains: "ab", mode: "insensitive" } }, { name: { contains: "ab", mode: "insensitive" } }],
    });
    expect(containsAnyOf(["email", "displayName"], "ab")).toEqual({
      OR: [{ email: { contains: "ab", mode: "insensitive" } }, { displayName: { contains: "ab", mode: "insensitive" } }],
    });
    expect(everyTermMatches(["a", "b"], (t) => ({ name: insensitiveContains(t) }))).toEqual({
      AND: [{ name: { contains: "a", mode: "insensitive" } }, { name: { contains: "b", mode: "insensitive" } }],
    });
  });

  it("billing picker terms match the previous split", () => {
    const before = (query: string) => query.normalize("NFKC").trim().split(/\s+/).filter(Boolean).slice(0, 5).map((term) => term.slice(0, 80));
    for (const query of ["", "  ", "Albia  church", "a b c d e f g", "x".repeat(200), "Ａlbia　school", " one "]) {
      expect(searchTerms(query, { maxTerms: 5, maxTermLength: 80 })).toEqual(before(query));
    }
  });

  it("organization terms and filter match the previous builder", () => {
    const cleanOld = (query: string) => query.slice(0, 80).normalize("NFKC").trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const query of ["", "a b c d e f g h", "  Albia   IA ", `${"x".repeat(79)} yz`, "Ａlbia　school"]) {
      expect(organizationSearchTerms(query)).toEqual(cleanOld(query));
    }
    expect(organizationSearchWhere("   ")).toBeNull();
    const contains = { contains: "Albia", mode: "insensitive" };
    expect(organizationSearchWhere("Albia")).toEqual({
      AND: [
        {
          OR: [
            { name: contains },
            { city: contains },
            { state: { equals: "Albia", mode: "insensitive" } },
            { orgCode: contains },
            { eadventistId: contains },
            { externalIdentities: { some: { externalId: contains } } },
            { district: contains },
            { parentOrganization: { is: { name: contains } } },
            { affiliatedOrganization: { is: { name: contains } } },
          ],
        },
      ],
    });
  });
});
