import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findScannerLookupMatches,
  looksLikeConfirmationCode,
  scannerLookupListLimit,
} from "@/modules/checkin/domain";

const person = (id: string, firstName: string, lastName: string, confirmationCode: string, checkedIn = false) => ({
  id, firstName, lastName, attendeeType: "ATTENDEE", checkedIn, confirmationCode,
});
const arrivals = [
  person("a1", "Sam", "Rivera", "WR26-1001"),
  person("a2", "Samantha", "Okafor", "WR26-1002", true),
  person("a3", "Pat", "Rivera", "WR26-1001"),
  person("a4", "Lee", "Nguyen", "WR26-1003"),
];

describe("scanner manual lookup (#889)", () => {
  it("finds a name with the same search the workspace uses", () => {
    const result = findScannerLookupMatches(arrivals, "lee ng");
    expect(result.confirmationCodes).toEqual(["WR26-1003"]);
    expect(result.people.map((entry) => entry.id)).toEqual(["a4"]);
  });

  it("finds a confirmation code", () => {
    expect(findScannerLookupMatches(arrivals, "wr26-1002").confirmationCodes).toEqual(["WR26-1002"]);
  });

  it("lists every registration a shared first name matches", () => {
    const result = findScannerLookupMatches(arrivals, "sam");
    expect(result.confirmationCodes).toEqual(["WR26-1001", "WR26-1002"]);
    expect(result.people.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(result.truncated).toBe(false);
  });

  it("returns one registration when a party shares a last name", () => {
    expect(findScannerLookupMatches(arrivals, "rivera").confirmationCodes).toEqual(["WR26-1001"]);
  });

  it("matches nothing for an empty or unknown query", () => {
    expect(findScannerLookupMatches(arrivals, "  ").people).toEqual([]);
    expect(findScannerLookupMatches(arrivals, "zzz").confirmationCodes).toEqual([]);
  });

  it("matches a club by name and caps a long list", () => {
    const many = Array.from({ length: scannerLookupListLimit + 3 }, (_, index) => person(`c${index}`, "Kid", `N${index}`, "WR26-2000"));
    const result = findScannerLookupMatches(many, "glen", { "WR26-2000": { organizationName: "Glenview Pathfinders" } });
    expect(result.confirmationCodes).toEqual(["WR26-2000"]);
    expect(result.people).toHaveLength(scannerLookupListLimit);
    expect(result.truncated).toBe(true);
  });

  it("exposes only fields the check-in desk already shows", () => {
    const richer = { ...person("a9", "Ada", "Stone", "WR26-3000"), email: "ada@example.test", balanceCents: 500 };
    const [first] = findScannerLookupMatches([richer], "ada").people;
    expect(Object.keys(first).sort()).toEqual(["attendeeType", "checkedIn", "confirmationCode", "firstName", "id", "lastName"]);
  });
});

describe("scanner exact code and no-match rules (#889)", () => {
  it("opens an exact code directly even when it prefixes another code", () => {
    const list = [person("p1", "Ann", "Lake", "WL-12"), person("p2", "Bo", "Dunn", "WL-123")];
    expect(findScannerLookupMatches(list, "wl-12").confirmationCodes).toEqual(["WL-12"]);
    expect(findScannerLookupMatches(list, "WL-1").confirmationCodes).toEqual(["WL-12", "WL-123"]);
  });

  it("tells a code from a name the way the workspace search does", () => {
    expect(looksLikeConfirmationCode("WR26-1001")).toBe(true);
    expect(looksLikeConfirmationCode("Rivera")).toBe(false);
  });
});

describe("scanner wiring (#889)", () => {
  const source = readFileSync(path.join(process.cwd(), "components/check-in-scanner.tsx"), "utf8");

  it("only asks the server for a code-like query when the desk list has no match", () => {
    expect(source).toContain("!looksLikeConfirmationCode(query)");
    expect(source).toContain("No one on this desk's list matches that name.");
  });

  it("keeps the pick list until a lookup succeeds and focuses its heading", () => {
    const resolve = source.slice(source.indexOf("async function resolveLookup"), source.indexOf("async function handleScannedText"));
    expect(resolve.match(/setCandidates\(null\)/g)).toHaveLength(1);
    expect(resolve.indexOf("setCandidates(null)")).toBeGreaterThan(resolve.indexOf("throw new Error"));
    expect(source).toContain("candidatesHeadingRef.current?.focus()");
  });

  const scanner = readFileSync(path.join(process.cwd(), "components/check-in-scanner.tsx"), "utf8");
  const workspace = readFileSync(path.join(process.cwd(), "components/check-in-workspace.tsx"), "utf8");

  it("opens a picked person through the same server lookup a scan uses, not a new search path", () => {
    expect(scanner).toContain('resolveLookup("confirmation", person.confirmationCode)');
    expect(scanner).toContain("/attendee-passes/resolve");
    expect(scanner.match(/fetch\(/g)?.length).toBe(1);
  });

  it("searches the desk's own projected arrivals and keeps the camera button", () => {
    expect(workspace).toContain("arrivals={arrivals}");
    expect(scanner).toContain("Start camera");
  });
});
